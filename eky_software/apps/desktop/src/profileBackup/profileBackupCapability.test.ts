import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  createProfileBackupCapability,
} from './profileBackupCapability.js';
import {
  createManualRecoveryPointIpcChannel,
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
  legacyProfileRestoreIpcChannels,
} from './portableProfileBackupTypes.js';

describe('profile backup capability', () => {
  it('lets main own paths and passwords without renderer arguments', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        createProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toBe('created');
    expect(fixture.selectBackupTarget).toHaveBeenCalledWith(
      'Eky-varmuuskopio-2026-08-04.ekybackup',
    );
    expect(fixture.requestPassword).toHaveBeenCalledWith('create');
    expect(fixture.create).toHaveBeenCalledWith({
      destinationPath: 'C:\\Backups\\Eky.ekybackup',
      password: 'Synthetic backup password 2026!',
    });

    expect(() =>
      fixture.invoke(
        createProfileBackupIpcChannel,
        fixture.trustedEvent,
        'C:\\Renderer-controlled.ekybackup',
      ),
    ).toThrow('PROFILE_BACKUP_CAPABILITY_FORBIDDEN');
  });

  it('returns only a safe status and a safe inspection summary', async () => {
    const fixture = createFixture();

    expect(
      fixture.invoke(
        getProfileBackupStatusIpcChannel,
        fixture.trustedEvent,
      ),
    ).toEqual({
      portableBackup: {
        latestSuccessfulPortableBackupAt: null,
        operationState: 'idle',
      },
      recoveryPoints: {
        availability: 'available',
        budgetState: 'withinBudget',
        latestValidatedGoodAt: null,
        nextAutomaticCheckAt: null,
        operationState: 'idle',
        pointCount: 0,
      },
    });
    await expect(
      fixture.invoke(
        inspectProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual({
      status: 'inspected',
      summary: inspectionSummary,
    });
    expect(fixture.selectBackupSource).toHaveBeenCalledWith();
    expect(fixture.requestPassword).toHaveBeenCalledWith('enter');
    expect(fixture.inspect).toHaveBeenCalledWith({
      containerPath: 'C:\\Backups\\Eky.ekybackup',
      password: 'Synthetic backup password 2026!',
    });
  });

  it('handles main-owned cancellation without starting an operation', async () => {
    const fixture = createFixture({
      sourcePath: null,
      targetPath: null,
    });

    await expect(
      fixture.invoke(
        createProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toBe('cancelled');
    await expect(
      fixture.invoke(
        inspectProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.inspect).not.toHaveBeenCalled();
  });

  it('keeps successful backup and inspection authoritative when logging fails', async () => {
    const fixture = createFixture({
      operationalLoggerThrows: true,
    });

    await expect(
      fixture.invoke(
        createProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toBe('created');
    await expect(
      fixture.invoke(
        inspectProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual({
      status: 'inspected',
      summary: inspectionSummary,
    });
  });

  it('preserves the backup error and releases the operation lock when failure logging also fails', async () => {
    const fixture = createFixture({
      createFails: true,
      operationalLoggerThrows: true,
    });

    await expect(
      fixture.invoke(
        createProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).rejects.toThrow('PROFILE_BACKUP_CREATE_FAILED');
    expect(fixture.showSafeError).toHaveBeenCalledWith('create');

    await expect(
      fixture.invoke(
        inspectProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual({
      status: 'inspected',
      summary: inspectionSummary,
    });
  });

  it('preserves the inspection error when its failure log cannot be written', async () => {
    const fixture = createFixture({
      inspectFails: true,
      operationalLoggerThrows: true,
    });

    await expect(
      fixture.invoke(
        inspectProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).rejects.toThrow('PROFILE_BACKUP_INSPECTION_FAILED');
    expect(fixture.showSafeError).toHaveBeenCalledWith('inspect');
  });

  it('creates a recovery point without returning its internal artifact identity', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        createManualRecoveryPointIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toMatchObject({
      recoveryPoints: {
        availability: 'available',
        pointCount: 0,
      },
    });
    expect(fixture.createManualRecoveryPoint).toHaveBeenCalledWith();
  });

  it('uses the shared maintenance authority only for mutating backup operations', async () => {
    const fixture = createFixture();

    await fixture.invoke(
      inspectProfileBackupIpcChannel,
      fixture.trustedEvent,
    );
    await fixture.invoke(
      createProfileBackupIpcChannel,
      fixture.trustedEvent,
    );
    await fixture.invoke(
      createManualRecoveryPointIpcChannel,
      fixture.trustedEvent,
    );

    expect(fixture.maintenancePurposes).toEqual(['backup', 'backup']);
    expect(fixture.maintenanceReleaseCount).toBe(2);
  });

  it('fails closed before opening a dialog when shared maintenance is busy', async () => {
    const fixture = createFixture({ maintenanceBusy: true });

    await expect(
      fixture.invoke(
        createProfileBackupIpcChannel,
        fixture.trustedEvent,
      ),
    ).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');

    expect(fixture.selectBackupTarget).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it('rejects another renderer and removes every handler on dispose', async () => {
    const fixture = createFixture();

    for (const channel of legacyProfileRestoreIpcChannels) {
      expect(fixture.handlers.has(channel)).toBe(false);
    }
    expect(() =>
      fixture.invoke(
        getProfileBackupStatusIpcChannel,
        {
          sender: {},
          senderFrame: fixture.mainFrame,
        } as unknown as IpcMainInvokeEvent,
      ),
    ).toThrow('PROFILE_BACKUP_CAPABILITY_FORBIDDEN');

    fixture.capability.dispose();
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      createProfileBackupIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      inspectProfileBackupIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      getProfileBackupStatusIpcChannel,
    );
    for (const channel of legacyProfileRestoreIpcChannels) {
      expect(fixture.removeHandler).toHaveBeenCalledWith(channel);
    }
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      createManualRecoveryPointIpcChannel,
    );
  });
});

const inspectionSummary = {
  appVersion: '0.1.0-alpha.1',
  compatibilityStatus: 'compatible' as const,
  createdAt: '2026-08-04T12:00:00.000Z',
  databaseHealth: 'healthy' as const,
  documentCount: 2,
  formatVersion: 1 as const,
  profileMatchStatus: 'same' as const,
  totalBusinessByteSize: 2_048,
};

function createFixture(options: {
  createFails?: boolean;
  inspectFails?: boolean;
  maintenanceBusy?: boolean;
  operationalLoggerThrows?: boolean;
  sourcePath?: string | null;
  targetPath?: string | null;
} = {}) {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const mainFrame = {};
  const webContents = { mainFrame };
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });
  const create = vi.fn(async () => {
    if (options.createFails === true) {
      throw new Error('SYNTHETIC_PRIVATE_BACKUP_FAILURE');
    }
    return inspectionSummary;
  });
  const inspect = vi.fn(async () => {
    if (options.inspectFails === true) {
      throw new Error('SYNTHETIC_PRIVATE_INSPECTION_FAILURE');
    }
    return inspectionSummary;
  });
  const requestPassword = vi.fn(
    async () => 'Synthetic backup password 2026!',
  );
  const selectBackupSource = vi.fn(
    async () =>
      options.sourcePath === undefined
        ? 'C:\\Backups\\Eky.ekybackup'
        : options.sourcePath,
  );
  const selectBackupTarget = vi.fn(
    async () =>
      options.targetPath === undefined
        ? 'C:\\Backups\\Eky.ekybackup'
        : options.targetPath,
  );
  const createManualRecoveryPoint = vi.fn(async () => ({
    artifactId: 'not-exposed',
  }));
  const operationalWrite = vi.fn(() => {
    if (options.operationalLoggerThrows === true) {
      throw new Error('SYNTHETIC_LOG_WRITE_FAILURE');
    }
  });
  const maintenancePurposes: string[] = [];
  let maintenanceReleaseCount = 0;
  const showSafeError = vi.fn();
  const capability = createProfileBackupCapability({
    backupService: {
      create,
      getStatus: () => ({ operationState: 'idle' }),
      inspect,
    },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler as never);
      },
      removeHandler,
    },
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as never,
    maintenanceLease:
      options.maintenanceBusy === true
        ? {
            async acquire() {
              throw new Error('WORKSPACE_MAINTENANCE_BUSY');
            },
          }
        : {
            async acquire(purpose) {
              maintenancePurposes.push(purpose);
              return {
                async release() {
                  maintenanceReleaseCount += 1;
                },
              };
            },
          },
    now: () => new Date('2026-08-04T12:00:00.000Z'),
    operationalIdentity: {
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'development',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    operationalLogger: { write: operationalWrite },
    passwordWindow: {
      dispose: vi.fn(),
      requestPassword,
    },
    recoveryPointService: {
      createManual: createManualRecoveryPoint as never,
      getStatus: () => ({
        availability: 'available',
        budgetState: 'withinBudget',
        operationState: 'idle',
        pointCount: 0,
      }),
    },
    selectBackupSource,
    selectBackupTarget,
    showSafeError,
  });

  return {
    capability,
    create,
    createManualRecoveryPoint,
    handlers,
    inspect,
    invoke(channel: string, event: IpcMainInvokeEvent, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    mainFrame,
    maintenancePurposes,
    get maintenanceReleaseCount() {
      return maintenanceReleaseCount;
    },
    removeHandler,
    requestPassword,
    selectBackupSource,
    selectBackupTarget,
    showSafeError,
    trustedEvent: {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}
