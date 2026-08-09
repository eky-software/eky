import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ProfileSnapshotBrokerClient,
} from './profileSnapshotBrokerClient.js';
import { profileSnapshotBrokerProtocolVersion } from './profileSnapshotBrokerProtocol.js';
import { startProfileSnapshotBrokerBackend } from './profileSnapshotBrokerBackend.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

describe('profile snapshot broker boundary', () => {
  it('waits for broker readiness before sending the immediate first status request', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const status = client.getStatus();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance: new FakeProfileMaintenance(),
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });

    await expect(status).resolves.toBe('normal');

    client.close();
    backend.close();
  });

  it('rejects requests when the transport closes before readiness', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    transports.backend.close();

    await expect(client.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    client.close();
  });

  it('rejects an unknown ready protocol version without sending a request', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    transports.backend.send({
      protocolVersion: profileSnapshotBrokerProtocolVersion + 1,
      type: 'profileSnapshotBrokerReady',
    });

    await expect(client.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    client.close();
  });

  it('rejects pending requests immediately when the broker transport closes', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance: {
        begin: () => new Promise<void>(() => undefined),
        end: (operationId) => maintenance.end(operationId),
        forceEnd: () => maintenance.forceEnd(),
        getStatus: () => maintenance.getStatus(),
      },
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    await client.waitUntilReady();
    const pending = client.beginMaintenance(randomUUID());

    transports.backend.close();

    await expect(pending).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    client.close();
    backend.close();
  });

  it('rejects malformed and wrong-type responses without leaving requests pending', async () => {
    const malformedTransports = createTransportPair();
    const malformedClient = new ProfileSnapshotBrokerClient(
      malformedTransports.main,
      1_000,
    );
    installDirectResponder(malformedTransports.backend, (requestId) => ({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: { type: 'unexpected' },
    }));

    await expect(malformedClient.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    malformedClient.close();

    const wrongTypeTransports = createTransportPair();
    const wrongTypeClient = new ProfileSnapshotBrokerClient(
      wrongTypeTransports.main,
      1_000,
    );
    installDirectResponder(wrongTypeTransports.backend, (requestId) => ({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: {
        artifactCount: 0,
        artifactTotalByteSize: 0,
        databaseHealth: 'healthy',
        type: 'activeProfileValidation',
      },
    }));

    await expect(wrongTypeClient.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    wrongTypeClient.close();
  });

  it('starts cleanly again after the previous broker is closed', async () => {
    for (let index = 0; index < 2; index += 1) {
      const transports = createTransportPair();
      const backend = startProfileSnapshotBrokerBackend({
        maintenance: new FakeProfileMaintenance(),
        snapshot: createFakeSnapshotService(),
        transport: transports.backend,
      });
      const client = new ProfileSnapshotBrokerClient(
        transports.main,
        1_000,
      );

      await expect(client.getStatus()).resolves.toBe('normal');

      client.close();
      backend.close();
    }
  });

  it('starts and ends one maintenance operation through the private protocol', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await expect(client.getStatus()).resolves.toBe('normal');
    await expect(client.beginMaintenance(operationId)).resolves.toBe('busy');
    expect(maintenance.status).toBe('busy');
    await expect(client.endMaintenance(operationId)).resolves.toBe('normal');
    expect(maintenance.status).toBe('normal');

    client.close();
    backend.close();
  });

  it('maps busy and mismatched operations to bounded errors', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const firstOperationId = randomUUID();

    await client.beginMaintenance(firstOperationId);
    await expect(
      client.beginMaintenance(randomUUID()),
    ).rejects.toMatchObject({
      code: 'PROFILE_MAINTENANCE_BUSY',
    });
    await expect(
      client.endMaintenance(randomUUID()),
    ).rejects.toMatchObject({
      code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH',
    });

    client.close();
    backend.close();
  });

  it('forces maintenance back to normal when the broker closes', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    await client.beginMaintenance(randomUUID());
    backend.close();

    expect(maintenance.status).toBe('normal');
    client.close();
  });

  it('returns only bounded metadata for a consistent profile snapshot', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const snapshot = createFakeSnapshotService();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot,
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(client.createProfileSnapshot(operationId)).resolves.toEqual({
      artifactCatalog: {
        artifactCount: 1,
        artifactTotalByteSize: 2_048,
        catalogByteSize: 512,
        logicalPath: 'snapshot-catalog-v1.json',
        sha256: 'b'.repeat(64),
      },
      database: {
        databaseByteSize: 8_192,
        logicalPath: 'profile.sqlite',
        sha256: 'a'.repeat(64),
        totalPages: 2,
      },
      type: 'profileSnapshot',
    });
    expect(snapshot.operationIds).toEqual([operationId]);
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('maps snapshot failures without exposing backend details', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        async createProfileSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_DATABASE_FAILED');
        },
        async prepareProfileRestoreActivation() {
          return {
            artifactCount: 0,
            artifactTotalByteSize: 0,
          };
        },
        async validateActiveProfile() {
          return createFakeActiveValidation();
        },
        async validateProfileSnapshot() {
          return createFakeValidation();
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('maps allowlisted errors from dynamically loaded backend realms', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        async createProfileSnapshot() {
          throw Object.freeze({
            message: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
            name: 'Error',
          });
        },
        async prepareProfileRestoreActivation() {
          return {
            artifactCount: 0,
            artifactTotalByteSize: 0,
          };
        },
        async validateActiveProfile() {
          return createFakeActiveValidation();
        },
        async validateProfileSnapshot() {
          return createFakeValidation();
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('separates unknown backend failures from broker availability', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        async createProfileSnapshot() {
          throw new Error('D:\\private\\unexpected-backend-detail');
        },
        async prepareProfileRestoreActivation() {
          return {
            artifactCount: 0,
            artifactTotalByteSize: 0,
          };
        },
        async validateActiveProfile() {
          return createFakeActiveValidation();
        },
        async validateProfileSnapshot() {
          return createFakeValidation();
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED',
      message: 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('classifies staging failures without exposing filesystem details', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        async createProfileSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
        },
        async prepareProfileRestoreActivation() {
          return {
            artifactCount: 0,
            artifactTotalByteSize: 0,
          };
        },
        async validateActiveProfile() {
          return createFakeActiveValidation();
        },
        async validateProfileSnapshot() {
          return createFakeValidation();
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_STAGING_FAILED',
      message: 'PROFILE_SNAPSHOT_STAGING_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('maps artifact failures without exposing storage details', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        async createProfileSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_FAILED');
        },
        async prepareProfileRestoreActivation() {
          return {
            artifactCount: 0,
            artifactTotalByteSize: 0,
          };
        },
        async validateActiveProfile() {
          return createFakeActiveValidation();
        },
        async validateProfileSnapshot() {
          return createFakeValidation();
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_ARTIFACTS_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('returns bounded validation metadata without profile identifiers leaking to the renderer boundary', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await expect(
      client.validateProfileSnapshot(operationId),
    ).resolves.toEqual({
      ...createFakeValidation(),
      type: 'profileSnapshotValidation',
    });

    client.close();
    backend.close();
  });

  it('validates the active profile without exposing document identities or paths', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    await expect(client.validateActiveProfile()).resolves.toEqual({
      ...createFakeActiveValidation(),
      type: 'activeProfileValidation',
    });

    client.close();
    backend.close();
  });

  it('prepares restore artifacts without exposing backend paths', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const snapshot = createFakeSnapshotService();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot,
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await expect(
      client.prepareProfileRestoreActivation(operationId),
    ).resolves.toEqual({
      artifactCount: 1,
      artifactTotalByteSize: 2_048,
      type: 'profileRestoreActivationPrepared',
    });
    expect(JSON.stringify(snapshot)).not.toContain('storage');

    client.close();
    backend.close();
  });
});

function createFakeSnapshotService(): {
  createProfileSnapshot(input: {
    operationId: string;
    signal: AbortSignal;
  }): Promise<{
    artifactCatalog: {
      artifactCount: number;
      artifactTotalByteSize: number;
      catalogByteSize: number;
      logicalPath: 'snapshot-catalog-v1.json';
      sha256: string;
    };
    database: {
      databaseByteSize: number;
      logicalPath: 'profile.sqlite';
      sha256: string;
      totalPages: number;
    };
  }>;
  prepareProfileRestoreActivation(operationId: string): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
  }>;
  validateActiveProfile(): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
  }>;
  validateProfileSnapshot(operationId: string): Promise<{
    activeProfileIsEmpty: boolean;
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
    migrationChainIdentity: string;
    profileId: string;
    profileMatchesActive: boolean;
  }>;
  operationIds: string[];
} {
  const operationIds: string[] = [];

  return {
    async createProfileSnapshot({ operationId, signal }) {
      expect(signal.aborted).toBe(false);
      operationIds.push(operationId);
      return {
        artifactCatalog: {
          artifactCount: 1,
          artifactTotalByteSize: 2_048,
          catalogByteSize: 512,
          logicalPath: 'snapshot-catalog-v1.json',
          sha256: 'b'.repeat(64),
        },
        database: {
          databaseByteSize: 8_192,
          logicalPath: 'profile.sqlite',
          sha256: 'a'.repeat(64),
          totalPages: 2,
        },
      };
    },
    async validateProfileSnapshot(operationId) {
      operationIds.push(operationId);
      return createFakeValidation();
    },
    async validateActiveProfile() {
      return createFakeActiveValidation();
    },
    async prepareProfileRestoreActivation(operationId) {
      operationIds.push(operationId);
      return {
        artifactCount: 1,
        artifactTotalByteSize: 2_048,
      };
    },
    operationIds,
  };
}

function createFakeActiveValidation() {
  return {
    artifactCount: 1,
    artifactTotalByteSize: 2_048,
    databaseHealth: 'healthy' as const,
  };
}

function createFakeValidation() {
  return {
    activeProfileIsEmpty: false,
    artifactCount: 1,
    artifactTotalByteSize: 2_048,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity: 'c'.repeat(64),
    profileId: 'd'.repeat(64),
    profileMatchesActive: true,
  };
}

class FakeProfileMaintenance {
  status: 'busy' | 'normal' = 'normal';
  private operationId: string | undefined;

  async begin(operationId: string): Promise<void> {
    if (this.status === 'busy') {
      const error = new Error('busy');
      error.name = 'ProfileMaintenanceBusyError';
      throw error;
    }
    this.operationId = operationId;
    this.status = 'busy';
  }

  end(operationId: string): void {
    if (this.operationId !== operationId) {
      const error = new Error('mismatch');
      error.name = 'ProfileMaintenanceOperationMismatchError';
      throw error;
    }
    this.operationId = undefined;
    this.status = 'normal';
  }

  forceEnd(): void {
    this.operationId = undefined;
    this.status = 'normal';
  }

  getStatus(): 'busy' | 'normal' {
    return this.status;
  }
}

function createTransportPair(): {
  backend: ProfileSnapshotBrokerTransport;
  main: ProfileSnapshotBrokerTransport;
} {
  const main = createTransportState();
  const backend = createTransportState();

  const createTransport = (
    own: TransportState,
    peer: TransportState,
  ): ProfileSnapshotBrokerTransport => ({
    close() {
      if (own.closed) {
        return;
      }
      own.closed = true;
      own.listeners.clear();
      queueMicrotask(() => {
        for (const listener of peer.closeListeners) {
          listener();
        }
      });
    },
    send(value) {
      if (own.closed || peer.closed) {
        throw new Error('closed');
      }
      queueMicrotask(() => {
        if (peer.closed) {
          return;
        }
        for (const listener of peer.listeners) {
          listener(value);
        }
      });
    },
    subscribe(listener) {
      own.listeners.add(listener);
      return () => own.listeners.delete(listener);
    },
    subscribeClose(listener) {
      own.closeListeners.add(listener);
      return () => own.closeListeners.delete(listener);
    },
  });

  return {
    backend: createTransport(backend, main),
    main: createTransport(main, backend),
  };
}

interface TransportState {
  closeListeners: Set<() => void>;
  closed: boolean;
  listeners: Set<(value: unknown) => void>;
}

function createTransportState(): TransportState {
  return {
    closeListeners: new Set(),
    closed: false,
    listeners: new Set(),
  };
}

function installDirectResponder(
  backend: ProfileSnapshotBrokerTransport,
  createResponse: (requestId: string) => unknown,
): void {
  backend.subscribe((value) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      'requestId' in value &&
      typeof value.requestId === 'string'
    ) {
      backend.send(createResponse(value.requestId));
    }
  });
  backend.send({
    protocolVersion: profileSnapshotBrokerProtocolVersion,
    type: 'profileSnapshotBrokerReady',
  });
}
