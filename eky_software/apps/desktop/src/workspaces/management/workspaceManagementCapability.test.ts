import { describe, expect, it, vi } from 'vitest';

import { WorkspaceManagementError } from './workspaceManagementError.js';
import { createWorkspaceManagementCapability } from './workspaceManagementCapability.js';
import {
  createEmptyWorkspaceIpcChannel,
  getWorkspaceManagementStatusIpcChannel,
  importWorkspaceBackupAsNewIpcChannel,
  renameWorkspaceIpcChannel,
  switchWorkspaceIpcChannel,
  workspaceManagementIpcChannels,
} from './workspaceManagementCapabilityProtocol.js';

const activeWorkspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const status = Object.freeze({
  activeWorkspaceId,
  formatVersion: 1 as const,
  operationState: 'idle' as const,
  workspaces: Object.freeze([
    Object.freeze({
      availability: 'ready' as const,
      isActive: true,
      workspaceId: activeWorkspaceId,
      workspaceLabel: 'Oma yritys Oy',
    }),
    Object.freeze({
      availability: 'ready' as const,
      isActive: false,
      workspaceId: otherWorkspaceId,
      workspaceLabel: 'Toinen yritys',
    }),
  ]),
});

describe('workspace management capability', () => {
  it('returns only the validated safe status to the trusted main frame', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        getWorkspaceManagementStatusIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(status);
    expect(JSON.stringify(status)).not.toMatch(
      /path|companyId|profileId|lineage|session|journal|operationId/i,
    );

    await expect(
      fixture.invoke(getWorkspaceManagementStatusIpcChannel, {
        sender: {},
        senderFrame: fixture.mainFrame,
      }),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    await expect(
      fixture.invoke(getWorkspaceManagementStatusIpcChannel, {
        sender: fixture.webContents,
        senderFrame: {},
      }),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
  });

  it('accepts only exact create and rename payloads', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(createEmptyWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceLabel: 'Uusi yritys',
      }),
    ).resolves.toEqual({ formatVersion: 1, status: 'relaunching' });
    expect(fixture.createEmpty).toHaveBeenCalledWith('Uusi yritys');

    await expect(
      fixture.invoke(renameWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceId: otherWorkspaceId,
        workspaceLabel: 'Uusi nimi',
      }),
    ).resolves.toEqual({ formatVersion: 1, status: 'completed' });
    expect(fixture.rename).toHaveBeenCalledWith(
      otherWorkspaceId,
      'Uusi nimi',
    );

    await expect(
      fixture.invoke(createEmptyWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceLabel: 'Uusi yritys',
        path: 'C:\\renderer-controlled',
      }),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    await expect(
      fixture.invoke(createEmptyWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceLabel: '  virheellinen  ',
      }),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    await expect(
      fixture.invoke(
        renameWorkspaceIpcChannel,
        fixture.trustedEvent,
        { workspaceId: otherWorkspaceId, workspaceLabel: 'Nimi' },
        'extra',
      ),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
  });

  it('keeps backup path and password main-owned across cancel and success', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        importWorkspaceBackupAsNewIpcChannel,
        fixture.trustedEvent,
        { workspaceLabel: 'Tuotu yritys' },
      ),
    ).resolves.toEqual({ formatVersion: 1, status: 'relaunching' });
    expect(fixture.selectBackupSource).toHaveBeenCalledWith();
    expect(fixture.requestPassword).toHaveBeenCalledWith('enter');
    expect(fixture.importBackupAsNew).toHaveBeenCalledWith({
      containerPath: 'C:\\Backups\\company.ekybackup',
      password: 'private-password',
      workspaceLabel: 'Tuotu yritys',
    });

    const pickerCancelled = createFixture({ backupPath: null });
    await expect(
      pickerCancelled.invoke(
        importWorkspaceBackupAsNewIpcChannel,
        pickerCancelled.trustedEvent,
        { workspaceLabel: 'Tuotu yritys' },
      ),
    ).resolves.toEqual({ formatVersion: 1, status: 'cancelled' });
    expect(pickerCancelled.requestPassword).not.toHaveBeenCalled();
    expect(pickerCancelled.importBackupAsNew).not.toHaveBeenCalled();
    await expect(
      pickerCancelled.invoke(
        createEmptyWorkspaceIpcChannel,
        pickerCancelled.trustedEvent,
        { workspaceLabel: 'Peruutuksen jälkeen' },
      ),
    ).resolves.toEqual({ formatVersion: 1, status: 'relaunching' });

    const passwordCancelled = createFixture({ password: null });
    await expect(
      passwordCancelled.invoke(
        importWorkspaceBackupAsNewIpcChannel,
        passwordCancelled.trustedEvent,
        { workspaceLabel: 'Tuotu yritys' },
      ),
    ).resolves.toEqual({ formatVersion: 1, status: 'cancelled' });
    expect(passwordCancelled.importBackupAsNew).not.toHaveBeenCalled();
    await expect(
      passwordCancelled.invoke(
        renameWorkspaceIpcChannel,
        passwordCancelled.trustedEvent,
        {
          workspaceId: otherWorkspaceId,
          workspaceLabel: 'Peruutuksen jälkeen',
        },
      ),
    ).resolves.toEqual({ formatVersion: 1, status: 'completed' });
  });

  it('rejects a parallel mutation before opening another native dialog', async () => {
    const backupSelection = createDeferred<string | null>();
    const fixture = createFixture({
      selectBackupSource: () => backupSelection.promise,
    });

    const firstImport = fixture.invoke(
      importWorkspaceBackupAsNewIpcChannel,
      fixture.trustedEvent,
      { workspaceLabel: 'Ensimmäinen tuonti' },
    );
    await Promise.resolve();

    await expect(
      fixture.invoke(
        importWorkspaceBackupAsNewIpcChannel,
        fixture.trustedEvent,
        { workspaceLabel: 'Toinen tuonti' },
      ),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_BUSY');
    expect(fixture.selectBackupSource).toHaveBeenCalledTimes(1);
    expect(fixture.requestPassword).not.toHaveBeenCalled();
    await expect(
      fixture.invoke(
        getWorkspaceManagementStatusIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(status);

    backupSelection.resolve('C:\\Backups\\company.ekybackup');
    await expect(firstImport).resolves.toEqual({
      formatVersion: 1,
      status: 'relaunching',
    });
  });

  it('releases the mutation guard after a service failure', async () => {
    let callCount = 0;
    const fixture = createFixture({
      async createEmpty() {
        callCount += 1;
        if (callCount === 1) throw new Error('private failure');
        return undefined;
      },
    });

    await expect(
      fixture.invoke(
        createEmptyWorkspaceIpcChannel,
        fixture.trustedEvent,
        { workspaceLabel: 'Epäonnistuva yritys' },
      ),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
    await expect(
      fixture.invoke(
        createEmptyWorkspaceIpcChannel,
        fixture.trustedEvent,
        { workspaceLabel: 'Seuraava yritys' },
      ),
    ).resolves.toEqual({ formatVersion: 1, status: 'relaunching' });
  });

  it('switches only by validated workspace id and treats active as a no-op', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(switchWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceId: otherWorkspaceId,
      }),
    ).resolves.toEqual({ formatVersion: 1, status: 'relaunching' });
    expect(fixture.switchTo).toHaveBeenCalledWith(otherWorkspaceId);

    await expect(
      fixture.invoke(switchWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceId: activeWorkspaceId,
      }),
    ).resolves.toEqual({ formatVersion: 1, status: 'completed' });
    expect(fixture.switchTo).toHaveBeenCalledOnce();

    await expect(
      fixture.invoke(switchWorkspaceIpcChannel, fixture.trustedEvent, {
        workspaceId: 'not-an-id',
      }),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');

    await expect(
      fixture.invoke(getWorkspaceManagementStatusIpcChannel, fixture.trustedEvent, {}),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
  });

  it('rejects invalid output, maps failures safely and removes every handler', async () => {
    const invalidOutput = createFixture({
      getStatus: async () => ({ ...status, databasePath: 'C:\\private' }),
    });
    await expect(
      invalidOutput.invoke(
        getWorkspaceManagementStatusIpcChannel,
        invalidOutput.trustedEvent,
      ),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');

    const safeFailure = createFixture({
      createEmpty: async () => {
        throw new WorkspaceManagementError(
          'WORKSPACE_MANAGEMENT_CREATE_FAILED',
          'create',
        );
      },
    });
    await expect(
      safeFailure.invoke(
        createEmptyWorkspaceIpcChannel,
        safeFailure.trustedEvent,
        { workspaceLabel: 'Uusi yritys' },
      ),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CREATE_FAILED');

    const rawFailure = createFixture({
      createEmpty: async () => {
        throw new Error('C:\\private\\workspace.sqlite');
      },
    });
    await expect(
      rawFailure.invoke(
        createEmptyWorkspaceIpcChannel,
        rawFailure.trustedEvent,
        { workspaceLabel: 'Uusi yritys' },
      ),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
    expect(rawFailure.showSafeError).toHaveBeenCalledOnce();

    const safeImport = createFixture();
    const importResult = await safeImport.invoke(
      importWorkspaceBackupAsNewIpcChannel,
      safeImport.trustedEvent,
      { workspaceLabel: 'Tuotu yritys' },
    );
    expect(JSON.stringify(importResult)).not.toMatch(
      /path|password|companyId|profileId|lineage|session|journal|operationId/i,
    );

    rawFailure.capability.dispose();
    for (const channel of workspaceManagementIpcChannels) {
      expect(rawFailure.removeHandler).toHaveBeenCalledWith(channel);
    }
  });

  it('disposes terminally while allowing the current mutation to settle', async () => {
    const creation = createDeferred<unknown>();
    const fixture = createFixture({
      createEmpty: async () => creation.promise,
    });
    const cachedStatusHandler = fixture.getHandler(
      getWorkspaceManagementStatusIpcChannel,
    );
    const currentMutation = fixture.invoke(
      createEmptyWorkspaceIpcChannel,
      fixture.trustedEvent,
      { workspaceLabel: 'Käynnissä oleva yritys' },
    );
    await Promise.resolve();

    fixture.capability.dispose();
    fixture.capability.dispose();
    creation.resolve(undefined);

    await expect(currentMutation).resolves.toEqual({
      formatVersion: 1,
      status: 'relaunching',
    });
    await expect(cachedStatusHandler(fixture.trustedEvent)).rejects.toThrow(
      'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN',
    );
    for (const channel of workspaceManagementIpcChannels) {
      expect(fixture.removeHandler).toHaveBeenCalledWith(channel);
    }
  });
});

function createFixture(
  options: {
    backupPath?: string | null;
    createEmpty?: (label: unknown) => Promise<unknown>;
    getStatus?: () => Promise<unknown>;
    password?: string | null;
    selectBackupSource?: () => Promise<string | null>;
  } = {},
) {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >();
  const handle = vi.fn(
    (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => handlers.set(channel, handler),
  );
  const removeHandler = vi.fn((channel: string) => handlers.delete(channel));
  const mainFrame = {};
  const webContents = { mainFrame };
  const createEmpty = vi.fn(
    options.createEmpty ??
      (async (workspaceLabel) => ({ workspaceId: otherWorkspaceId, workspaceLabel })),
  );
  const getStatus = vi.fn(options.getStatus ?? (async () => status));
  const importBackupAsNew = vi.fn(async (input) => ({
    workspaceId: otherWorkspaceId,
    workspaceLabel: (input as { workspaceLabel: string }).workspaceLabel,
  }));
  const rename = vi.fn(async (_workspaceId, workspaceLabel) => ({
    changed: true,
    workspaceId: otherWorkspaceId,
    workspaceLabel,
  }));
  const switchTo = vi.fn(async () => undefined);
  const requestPassword = vi.fn(async () =>
    options.password === undefined ? 'private-password' : options.password,
  );
  const selectBackupSource = vi.fn(
    options.selectBackupSource ??
      (async () =>
        options.backupPath === undefined
          ? 'C:\\Backups\\company.ekybackup'
          : options.backupPath),
  );
  const showSafeError = vi.fn();
  const capability = createWorkspaceManagementCapability({
    ipcMain: { handle, removeHandler } as never,
    mainWindow: { isDestroyed: () => false, webContents } as never,
    passwordWindow: { requestPassword },
    selectBackupSource,
    service: {
      createEmpty,
      getStatus,
      importBackupAsNew,
      rename,
      switchTo,
    } as never,
    showSafeError,
  });

  return {
    capability,
    createEmpty,
    getStatus,
    getHandler(channel: string) {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error('Handler missing.');
      return handler;
    },
    importBackupAsNew,
    invoke(channel: string, event: unknown, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error('Handler missing.');
      return handler(event, ...args);
    },
    mainFrame,
    removeHandler,
    rename,
    requestPassword,
    selectBackupSource,
    showSafeError,
    switchTo,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
    webContents,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
