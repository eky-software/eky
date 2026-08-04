import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ProfileSnapshotBrokerClient,
} from './profileSnapshotBrokerClient.js';
import { startProfileSnapshotBrokerBackend } from './profileSnapshotBrokerBackend.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

describe('profile snapshot broker boundary', () => {
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

  it('returns only bounded metadata for a verified SQLite snapshot', async () => {
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
    await expect(client.createSqliteSnapshot(operationId)).resolves.toEqual({
      databaseByteSize: 8_192,
      logicalPath: 'profile.sqlite',
      sha256: 'a'.repeat(64),
      totalPages: 2,
      type: 'sqliteSnapshot',
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
        async createSqliteSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_DATABASE_FAILED');
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createSqliteSnapshot(operationId),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });
});

function createFakeSnapshotService(): {
  createSqliteSnapshot(input: {
    operationId: string;
    signal: AbortSignal;
  }): Promise<{
    databaseByteSize: number;
    logicalPath: 'profile.sqlite';
    sha256: string;
    totalPages: number;
  }>;
  operationIds: string[];
} {
  const operationIds: string[] = [];

  return {
    async createSqliteSnapshot({ operationId, signal }) {
      expect(signal.aborted).toBe(false);
      operationIds.push(operationId);
      return {
        databaseByteSize: 8_192,
        logicalPath: 'profile.sqlite',
        sha256: 'a'.repeat(64),
        totalPages: 2,
      };
    },
    operationIds,
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
  const mainListeners = new Set<(value: unknown) => void>();
  const backendListeners = new Set<(value: unknown) => void>();
  let closed = false;

  const createTransport = (
    ownListeners: Set<(value: unknown) => void>,
    peerListeners: Set<(value: unknown) => void>,
  ): ProfileSnapshotBrokerTransport => ({
    close() {
      closed = true;
      ownListeners.clear();
    },
    send(value) {
      if (closed) {
        throw new Error('closed');
      }
      queueMicrotask(() => {
        for (const listener of peerListeners) {
          listener(value);
        }
      });
    },
    subscribe(listener) {
      ownListeners.add(listener);
      return () => ownListeners.delete(listener);
    },
    subscribeClose() {
      return () => undefined;
    },
  });

  return {
    backend: createTransport(backendListeners, mainListeners),
    main: createTransport(mainListeners, backendListeners),
  };
}
