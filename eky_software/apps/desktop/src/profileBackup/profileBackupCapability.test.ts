import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  createProfileBackupCapability,
} from './profileBackupCapability.js';
import {
  activatePreparedProfileRestoreIpcChannel,
  createManualRecoveryPointIpcChannel,
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
  prepareProfileRestoreIpcChannel,
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
      restoreOperationState: 'idle',
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

  it('prepares and activates restore through two main-owned confirmations', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        prepareProfileRestoreIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual({
      status: 'inspected',
      summary: inspectionSummary,
    });
    expect(fixture.restoreInspect).toHaveBeenCalledWith({
      containerPath: 'C:\\Backups\\Restore.ekybackup',
      password: 'Synthetic backup password 2026!',
    });

    await expect(
      fixture.invoke(
        activatePreparedProfileRestoreIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toBe('relaunching');
    expect(fixture.confirmRestoreReplacement).toHaveBeenCalledWith(
      inspectionSummary,
    );
    expect(fixture.restoreStage).toHaveBeenCalledWith({
      inspectionId: '22222222-2222-4222-8222-222222222222',
      password: 'Synthetic backup password 2026!',
    });
    expect(fixture.confirmRestoreActivation).toHaveBeenCalledWith({
      operationId: '33333333-3333-4333-8333-333333333333',
      summary: inspectionSummary,
      targetDisposition: 'replaceActiveProfile',
    });
    expect(fixture.activateRestore).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('discards staged data when the exact second confirmation is cancelled', async () => {
    const fixture = createFixture({
      confirmRestoreActivation: false,
    });

    await fixture.invoke(
      prepareProfileRestoreIpcChannel,
      fixture.trustedEvent,
    );
    await expect(
      fixture.invoke(
        activatePreparedProfileRestoreIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toBe('cancelled');

    expect(fixture.discardPreparedRestore).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(fixture.activateRestore).not.toHaveBeenCalled();
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

  it('rejects another renderer and removes every handler on dispose', async () => {
    const fixture = createFixture();

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
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      prepareProfileRestoreIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      activatePreparedProfileRestoreIpcChannel,
    );
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
  confirmRestoreActivation?: boolean;
  confirmRestoreReplacement?: boolean;
  restoreSourcePath?: string | null;
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
  const create = vi.fn(async () => inspectionSummary);
  const inspect = vi.fn(async () => inspectionSummary);
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
  const selectRestoreSource = vi.fn(
    async () =>
      options.restoreSourcePath === undefined
        ? 'C:\\Backups\\Restore.ekybackup'
        : options.restoreSourcePath,
  );
  const confirmRestoreActivation = vi.fn(
    async () => options.confirmRestoreActivation ?? true,
  );
  const confirmRestoreReplacement = vi.fn(
    async () => options.confirmRestoreReplacement ?? true,
  );
  const createManualRecoveryPoint = vi.fn(async () => ({
    artifactId: 'not-exposed',
  }));
  const restoreInspect = vi.fn(async () => ({
    inspectionId: '22222222-2222-4222-8222-222222222222',
    summary: inspectionSummary,
  }));
  const restoreStage = vi.fn(async () => ({
    operationId: '33333333-3333-4333-8333-333333333333',
    summary: inspectionSummary,
    targetDisposition: 'replaceActiveProfile' as const,
  }));
  const discardPreparedRestore = vi.fn(async () => undefined);
  const activateRestore = vi.fn(async () => 'relaunching' as const);
  const capability = createProfileBackupCapability({
    backupService: {
      create,
      getStatus: () => ({ operationState: 'idle' }),
      inspect,
    },
    confirmRestoreActivation,
    confirmRestoreReplacement,
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
    now: () => new Date('2026-08-04T12:00:00.000Z'),
    operationalIdentity: {
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'development',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    operationalLogger: { write: vi.fn() },
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
    restoreActivationService: {
      activate: activateRestore,
    },
    restoreStagingService: {
      discardPreparedRestore,
      inspect: restoreInspect,
      stage: restoreStage,
    },
    selectBackupSource,
    selectBackupTarget,
    selectRestoreSource,
    showSafeError: vi.fn(),
  });

  return {
    activateRestore,
    capability,
    confirmRestoreActivation,
    confirmRestoreReplacement,
    create,
    createManualRecoveryPoint,
    discardPreparedRestore,
    inspect,
    invoke(channel: string, event: IpcMainInvokeEvent, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    mainFrame,
    removeHandler,
    requestPassword,
    restoreInspect,
    restoreStage,
    selectBackupSource,
    selectBackupTarget,
    selectRestoreSource,
    trustedEvent: {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}
