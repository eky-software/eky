import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ProfileSnapshotBrokerClient,
  ProfileSnapshotBrokerError,
} from './profileSnapshotBrokerClient.js';
import { startProfileSnapshotBrokerBackend } from './profileSnapshotBrokerBackend.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

describe('profile snapshot broker boundary', () => {
  it('starts and ends one maintenance operation through the private protocol', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
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
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const firstOperationId = randomUUID();

    await client.beginMaintenance(firstOperationId);
    await expect(
      client.beginMaintenance(randomUUID()),
    ).rejects.toMatchObject<Partial<ProfileSnapshotBrokerError>>({
      code: 'PROFILE_MAINTENANCE_BUSY',
    });
    await expect(
      client.endMaintenance(randomUUID()),
    ).rejects.toMatchObject<Partial<ProfileSnapshotBrokerError>>({
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
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    await client.beginMaintenance(randomUUID());
    backend.close();

    expect(maintenance.status).toBe('normal');
    client.close();
  });
});

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
