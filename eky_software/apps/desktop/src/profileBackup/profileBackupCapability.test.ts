import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import {
  createProfileBackupCapability,
} from './profileBackupCapability.js';
import { PortableProfileBackupCleanupError } from './portableProfileBackup.js';
import {
  createManualRecoveryPointIpcChannel,
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
  legacyProfileRestoreIpcChannels,
} from './portableProfileBackupTypes.js';

const backupFailureCases = [
  [createProfileBackupIpcChannel, 'create', 'PROFILE_BACKUP_CREATE_FAILED'],
  [inspectProfileBackupIpcChannel, 'inspect', 'PROFILE_BACKUP_INSPECTION_FAILED'],
] as const;

describe('profile backup capability', () => {
  it('reads the current label inside the backup lease for every native selection', async () => {
    let label = 'Synthetic Company A';
    const fixture = createFixture({
      targetPath: null,
      readActiveWorkspaceLabel: async () => {
        expect(fixture.maintenancePurposes.length).toBe(fixture.maintenanceReleaseCount + 1);
        return label;
      },
    });
    await fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent);
    label = 'Synthetic Company A Renamed';
    await fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent);
    expect(fixture.selectBackupTarget.mock.calls).toEqual([
      ['Eky-varmuuskopio-Synthetic Company A-2026-08-04.ekybackup'],
      ['Eky-varmuuskopio-Synthetic Company A Renamed-2026-08-04.ekybackup'],
    ]);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.readActiveWorkspaceLabel).toHaveBeenCalledTimes(2);
    expect(fixture.maintenanceReleaseCount).toBe(2);
    expect(JSON.stringify(fixture.operationalWrite.mock.calls)).not.toContain('Synthetic Company');
  });

  it('keeps a label lookup failure safe and does not select a destination', async () => {
    const original = new Error('Synthetic private registry detail');
    const fixture = createFixture({ readActiveWorkspaceLabel: async () => { throw original; } });
    await expect(fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent))
      .rejects.toMatchObject({ message: 'PROFILE_BACKUP_CREATE_FAILED', cause: original });
    expect(fixture.selectBackupTarget).not.toHaveBeenCalled();
    expect(fixture.requestPassword).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.maintenanceReleaseCount).toBe(1);
    expect(fixture.showSafeError).toHaveBeenCalledWith('create');
    expect(fixture.operationalWrite).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'backup.failed', errorCode: 'PROFILE_BACKUP_CREATE_FAILED', sideEffectState: 'none',
    }));
    expect(JSON.stringify(fixture.operationalWrite.mock.calls)).not.toContain(original.message);
  });

  it('does not open a dialog after disposal during the label lookup', async () => {
    let finish!: (label: string) => void;
    const lookup = new Promise<string>(resolve => { finish = resolve; });
    const fixture = createFixture({ readActiveWorkspaceLabel: () => lookup });
    const pending = fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent);
    await vi.waitFor(() => expect(fixture.readActiveWorkspaceLabel).toHaveBeenCalledTimes(1));
    fixture.capability.dispose();
    finish('Synthetic Company');
    await expect(pending).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    expect(fixture.selectBackupTarget).not.toHaveBeenCalled();
    expect(fixture.maintenanceReleaseCount).toBe(1);
  });

  it('does not read a label when maintenance is busy', async () => {
    const fixture = createFixture({ maintenanceBusy: true });
    await expect(fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent))
      .rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    expect(fixture.readActiveWorkspaceLabel).not.toHaveBeenCalled();
    expect(fixture.selectBackupTarget).not.toHaveBeenCalled();
  });

  it('does not report a label lookup failure after disposal', async () => {
    let fail!: (error: Error) => void;
    const lookup = new Promise<string>((_resolve, reject) => { fail = reject; });
    const fixture = createFixture({ readActiveWorkspaceLabel: () => lookup });
    const pending = fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent);
    await vi.waitFor(() => expect(fixture.readActiveWorkspaceLabel).toHaveBeenCalledTimes(1));
    fixture.capability.dispose();
    fail(new Error('Synthetic late private read failure'));
    await expect(pending).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    expect(fixture.selectBackupTarget).not.toHaveBeenCalled();
    expect(fixture.showSafeError).not.toHaveBeenCalled();
    expect(fixture.operationalWrite).not.toHaveBeenCalled();
    expect(fixture.maintenanceReleaseCount).toBe(1);
  });

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

  it('reports uncertain create cleanup as non-retryable without replacing or exposing its first cause', async () => {
    const fixture = createFixture();
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED', { cause: new Error('synthetic private detail') });
    fixture.create.mockRejectedValueOnce(new PortableProfileBackupCleanupError(original));
    const failure = await Promise.resolve(fixture.invoke(createProfileBackupIpcChannel, fixture.trustedEvent))
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: 'PROFILE_BACKUP_CREATE_FAILED' });
    expect((failure as Error).cause).toBeUndefined();
    const events = fixture.operationalWrite.mock.calls.map(([event]) => event)
      .filter(event => event.outcome === 'failure');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      errorCode: 'PROFILE_SCHEMA_UNSUPPORTED', eventName: 'backup.failed',
      retryable: false, sideEffectState: 'unknown',
    });
    expect(JSON.stringify(events)).not.toContain('synthetic private detail');
    expect(fixture.maintenanceReleaseCount).toBe(1);
  });

  it.each(backupFailureCases)('does not expose internal causes or private details over %s', async (channel, method, code) => {
    const fixture = createFixture();
    const privateDetail = 'synthetic private native detail';
    fixture[method].mockRejectedValueOnce(new Error(code, {
      cause: new AggregateError([
        new Error('PROFILE_SCHEMA_UNSUPPORTED'),
        new Error(privateDetail),
      ], privateDetail),
    }));

    const failure: unknown = await Promise.resolve(
      fixture.invoke(channel, fixture.trustedEvent),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(code);
    expect((failure as Error).cause).toBeUndefined();
    expect(String(failure)).not.toContain(privateDetail);
    expect(JSON.stringify(failure)).not.toContain(privateDetail);
  });

  describe.each(backupFailureCases)('safe failure observation for %s', (channel, method, code) => {
    it.each([
      'PROFILE_SCHEMA_UNSUPPORTED',
      'PROFILE_INSPECTION_LIMIT_EXCEEDED',
      'PROFILE_INSPECTION_TIMEOUT',
      'PROFILE_INSPECTION_PROTOCOL_INVALID',
      'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
    ])('logs the primary %s without exposing its error chain', async cause => {
      const fixture = createFixture();
      const privateDetail = 'synthetic private native detail';
      fixture[method].mockRejectedValueOnce(new Error(code, {
        cause: new AggregateError([
          new Error('synthetic wrapper', { cause: new Error(cause) }),
          new Error('PROFILE_INSPECTION_TIMEOUT'),
        ], privateDetail),
      }));

      await expect(fixture.invoke(channel, fixture.trustedEvent))
        .rejects.toThrow(code);

      const failures = fixture.operationalWrite.mock.calls
        .map(([event]) => event)
        .filter(event => event.outcome === 'failure');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        errorCode: cause,
        eventName: method === 'create' ? 'backup.failed' : 'backup.inspectionFailed',
        retryable: method === 'create',
        sideEffectState: method === 'create' ? 'unknown' : 'none',
        stage: 'portable',
      });
      expect(fixture.showSafeError).toHaveBeenCalledWith(method);
      const serialized = JSON.stringify(fixture.operationalWrite.mock.calls);
      expect(serialized).not.toContain(privateDetail);
      expect(serialized).not.toContain('Synthetic backup password');
      expect(serialized).not.toContain('Backups');
      expect(serialized).not.toContain('stack');
    });

    it.each(createUnprojectableFailures())('keeps %s generic instead of guessing a primary', async (_name, failure) => {
      const fixture = createFixture();
      fixture[method].mockRejectedValueOnce(failure);

      await expect(fixture.invoke(channel, fixture.trustedEvent))
        .rejects.toThrow(code);

      const failures = fixture.operationalWrite.mock.calls
        .map(([event]) => event)
        .filter(event => event.outcome === 'failure');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ errorCode: code });
    });
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

  it('uses the shared maintenance authority for each backup filesystem operation', async () => {
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

    expect(fixture.maintenancePurposes).toEqual(['backup', 'backup', 'backup']);
    expect(fixture.maintenanceReleaseCount).toBe(3);
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

  it('does not reopen a password prompt or backup work after disposal during native selection', async () => {
    const fixture = createFixture();
    let resolveSource!: (path: string) => void;
    fixture.selectBackupSource.mockReturnValueOnce(new Promise(resolve => { resolveSource = resolve; }));
    const task = fixture.invoke(inspectProfileBackupIpcChannel, fixture.trustedEvent) as Promise<unknown>;
    await Promise.resolve(); await Promise.resolve();
    fixture.capability.dispose();
    resolveSource('C:\\Backups\\Eky.ekybackup');
    await expect(task).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    expect(fixture.requestPassword).not.toHaveBeenCalled();
    expect(fixture.inspect).not.toHaveBeenCalled();
    expect(fixture.maintenanceReleaseCount).toBe(1);
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

function createUnprojectableFailures(): readonly (readonly [string, unknown])[] {
  const cyclic = new Error('PROFILE_SCHEMA_UNSUPPORTED');
  cyclic.cause = cyclic;
  let deep = new Error('PROFILE_SCHEMA_UNSUPPORTED');
  for (let index = 0; index < 10; index++) {
    deep = new Error('wrapper', { cause: deep });
  }
  const getter = new Error('PROFILE_SCHEMA_UNSUPPORTED');
  Object.defineProperty(getter, 'cause', {
    get() { throw new Error('synthetic private cause getter'); },
  });
  return [
    ['unknown native detail', new Error('synthetic private native detail')],
    ['known cleanup after an unknown primary', new Error('PROFILE_SCHEMA_UNSUPPORTED', {
      cause: new AggregateError([
        new Error('synthetic private primary'),
        new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
      ], 'PROFILE_INSPECTION_TIMEOUT'),
    })],
    ['a different operation code', new Error('MIGRATION_HISTORY_INVALID')],
    ['a private suffix', new Error('PROFILE_SCHEMA_UNSUPPORTED: synthetic private detail')],
    ['a non-Error value', { message: 'PROFILE_SCHEMA_UNSUPPORTED' }],
    ['a cycle', cyclic],
    ['an overlong chain', deep],
    ['a throwing getter', getter],
    ['an empty aggregate', new AggregateError([], 'PROFILE_SCHEMA_UNSUPPORTED')],
  ];
}

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
  readActiveWorkspaceLabel?: () => Promise<string | undefined>;
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
  const operationalWrite = vi.fn<(event: DesktopOperationalEvent) => void>(() => {
    if (options.operationalLoggerThrows === true) {
      throw new Error('SYNTHETIC_LOG_WRITE_FAILURE');
    }
  });
  const maintenancePurposes: string[] = [];
  let maintenanceReleaseCount = 0;
  const readActiveWorkspaceLabel = vi.fn(options.readActiveWorkspaceLabel ?? (async () => undefined));
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
    readActiveWorkspaceLabel,
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
    operationalWrite,
    removeHandler,
    requestPassword,
    readActiveWorkspaceLabel,
    selectBackupSource,
    selectBackupTarget,
    showSafeError,
    trustedEvent: {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}
