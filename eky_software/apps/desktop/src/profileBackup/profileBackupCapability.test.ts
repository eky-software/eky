import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  createProfileBackupCapability,
} from './profileBackupCapability.js';
import {
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
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
      operationState: 'idle',
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
    selectBackupSource,
    selectBackupTarget,
    showSafeError: vi.fn(),
  });

  return {
    capability,
    create,
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
    selectBackupSource,
    selectBackupTarget,
    trustedEvent: {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}
