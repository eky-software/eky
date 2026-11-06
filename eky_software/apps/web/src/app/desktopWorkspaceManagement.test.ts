import { describe, expect, it, vi } from 'vitest';

import type { EkyDesktopApi } from './desktopBridge.js';
import {
  getDesktopWorkspaceManagement,
  isWorkspaceLabelExistsError,
  readWorkspaceDeletionResult,
} from './desktopWorkspaceManagement.js';

const activeWorkspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const status = {
  activeWorkspaceId,
  formatVersion: 1,
  operationState: 'idle',
  workspaces: [
    {
      availability: 'ready',
      isActive: true,
      workspaceId: activeWorkspaceId,
      workspaceLabel: 'Oma yritys Oy',
    },
    {
      availability: 'recoveryRequired',
      isActive: false,
      workspaceId: otherWorkspaceId,
      workspaceLabel: 'Tarkistettava yritys',
    },
  ],
};

describe('desktop workspace management bridge', () => {
  it('is unavailable in the browser and through an incomplete bridge', () => {
    expect(
      getDesktopWorkspaceManagement({} as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();

    const desktop = createDesktopApi();
    desktop.renameWorkspace = undefined as never;
    expect(
      getDesktopWorkspaceManagement({ ekyDesktop: desktop }),
    ).toBeUndefined();
  });

  it('keeps the base capability available when replacement is not exposed', () => {
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi(),
    });

    expect(capability).toBeDefined();
    expect(capability?.replaceActiveFromBackup).toBeUndefined();
  });

  it('returns only the strict safe workspace status', async () => {
    const getWorkspaceManagementStatus = vi.fn(async () => status);
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({ getWorkspaceManagementStatus }),
    });

    await expect(capability?.getStatus()).resolves.toEqual(status);
    expect(JSON.stringify(await capability?.getStatus())).not.toMatch(
      /path|companyId|profileId|lineage|session|journal|operationId/i,
    );
  });

  it('passes only validated named inputs and validates every result', async () => {
    const createEmptyWorkspace = vi.fn(async () => ({
      formatVersion: 1,
      status: 'relaunching',
    }));
    const importWorkspaceBackupAsNew = vi.fn(async () => ({
      formatVersion: 1,
      status: 'cancelled',
    }));
    const renameWorkspace = vi.fn(async () => ({
      formatVersion: 1,
      status: 'completed',
    }));
    const switchWorkspace = vi.fn(async () => ({
      formatVersion: 1,
      status: 'completed',
    }));
    const replaceActiveWorkspaceFromBackup = vi.fn(async () => ({
      formatVersion: 1,
      status: 'relaunching',
    }));
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        createEmptyWorkspace,
        importWorkspaceBackupAsNew,
        renameWorkspace,
        replaceActiveWorkspaceFromBackup,
        switchWorkspace,
      }),
    });

    await expect(capability?.createEmpty('Uusi yritys')).resolves.toBe(
      'relaunching',
    );
    await expect(capability?.importBackupAsNew('Tuotu yritys')).resolves.toBe(
      'cancelled',
    );
    await expect(
      capability?.rename(otherWorkspaceId, 'Uusi nimi'),
    ).resolves.toBe('completed');
    await expect(capability?.switchTo(otherWorkspaceId)).resolves.toBe(
      'completed',
    );
    await expect(capability?.replaceActiveFromBackup?.()).resolves.toBe(
      'relaunching',
    );
    expect(createEmptyWorkspace).toHaveBeenCalledWith({
      workspaceLabel: 'Uusi yritys',
    });
    expect(importWorkspaceBackupAsNew).toHaveBeenCalledWith({
      workspaceLabel: 'Tuotu yritys',
    });
    expect(renameWorkspace).toHaveBeenCalledWith({
      workspaceId: otherWorkspaceId,
      workspaceLabel: 'Uusi nimi',
    });
    expect(switchWorkspace).toHaveBeenCalledWith({
      workspaceId: otherWorkspaceId,
    });
    expect(replaceActiveWorkspaceFromBackup).toHaveBeenCalledWith();
  });

  it('accepts every allowlisted completed or relaunching operation result', async () => {
    const completedCapability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        createEmptyWorkspace: vi.fn(async () => ({
          formatVersion: 1,
          status: 'completed',
        })),
        importWorkspaceBackupAsNew: vi.fn(async () => ({
          formatVersion: 1,
          status: 'completed',
        })),
        switchWorkspace: vi.fn(async () => ({
          formatVersion: 1,
          status: 'relaunching',
        })),
      }),
    });

    await expect(completedCapability?.createEmpty('Uusi yritys')).resolves.toBe(
      'completed',
    );
    await expect(
      completedCapability?.importBackupAsNew('Tuotu yritys'),
    ).resolves.toBe('completed');
    await expect(completedCapability?.switchTo(otherWorkspaceId)).resolves.toBe(
      'relaunching',
    );
  });

  it.each([
    { ...status, databasePath: 'C:\\private\\workspace.sqlite' },
    { ...status, operationState: 'unknown' },
    {
      ...status,
      workspaces: [status.workspaces[0], status.workspaces[0]],
    },
    {
      ...status,
      workspaces: [{ ...status.workspaces[0], workspaceLabel: 'bad\u202evalue' }],
    },
    {
      ...status,
      activeWorkspaceId: otherWorkspaceId,
    },
    {
      ...status,
      workspaces: Array.from({ length: 65 }, (_, index) => ({
        availability: 'ready',
        isActive: false,
        workspaceId: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
        workspaceLabel: `Yritys ${index}`,
      })),
    },
  ])('rejects unsafe status output', async (unsafeStatus) => {
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        getWorkspaceManagementStatus: vi.fn(async () => unsafeStatus),
      }),
    });

    await expect(capability?.getStatus()).rejects.toThrow(
      'Invalid workspace management status.',
    );
  });

  it('rejects unsafe inputs and result objects with extra fields', async () => {
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        createEmptyWorkspace: vi.fn(async () => ({
          formatVersion: 1,
          path: 'C:\\private',
          status: 'relaunching',
        })),
      }),
    });

    await expect(capability?.createEmpty(' Uusi yritys')).rejects.toThrow(
      'Invalid workspace label.',
    );
    await expect(capability?.switchTo('not-an-id')).rejects.toThrow(
      'Invalid workspace identifier.',
    );
    await expect(capability?.createEmpty('Uusi yritys')).rejects.toThrow(
      'Invalid workspace create result.',
    );
  });

  it.each([
    { formatVersion: 1, path: 'C:\\private', status: 'relaunching' },
    { formatVersion: 1, status: 'completed' },
    { formatVersion: 2, status: 'cancelled' },
  ])('rejects unsafe active replacement result %#', async (result) => {
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        replaceActiveWorkspaceFromBackup: vi.fn(async () => result),
      }),
    });

    await expect(capability?.replaceActiveFromBackup?.()).rejects.toThrow(
      'Invalid workspace replace result.',
    );
  });

  it('rejects inherited fields and malformed versioned results', async () => {
    const inheritedStatus = Object.assign(
      Object.create({ databasePath: 'C:\\private\\workspace.sqlite' }),
      status,
    );
    const inheritedResult = Object.assign(
      Object.create({ path: 'C:\\private' }),
      { formatVersion: 1, status: 'relaunching' },
    );
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        createEmptyWorkspace: vi.fn(async () => inheritedResult),
        getWorkspaceManagementStatus: vi.fn(async () => inheritedStatus),
      }),
    });

    await expect(capability?.getStatus()).rejects.toThrow(
      'Invalid workspace management status.',
    );
    await expect(capability?.createEmpty('Uusi yritys')).rejects.toThrow(
      'Invalid workspace create result.',
    );

    const wrongVersion = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        createEmptyWorkspace: vi.fn(async () => ({
          formatVersion: 2,
          status: 'relaunching',
        })),
      }),
    });
    await expect(wrongVersion?.createEmpty('Uusi yritys')).rejects.toThrow(
      'Invalid workspace create result.',
    );
  });

  it('allows duplicate labels when workspace identifiers remain unique', async () => {
    const duplicateLabels = {
      ...status,
      workspaces: status.workspaces.map((entry) => ({
        ...entry,
        workspaceLabel: 'Sama nimi',
      })),
    };
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        getWorkspaceManagementStatus: vi.fn(async () => duplicateLabels),
      }),
    });

    await expect(capability?.getStatus()).resolves.toEqual(duplicateLabels);
  });

  it('accepts only referenced duplicate ids and freezes its own projection', async () => {
    const ids = [activeWorkspaceId, otherWorkspaceId];
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        getWorkspaceManagementStatus: async () => ({
          ...status, duplicateWorkspaceLabelIds: ids,
        }),
      }),
    })!;
    const projected = await capability.getStatus();

    expect(projected.duplicateWorkspaceLabelIds).toEqual(ids);
    expect(Object.isFrozen(projected.duplicateWorkspaceLabelIds)).toBe(true);
    ids.pop();
    expect(projected.duplicateWorkspaceLabelIds).toEqual([activeWorkspaceId, otherWorkspaceId]);
    expect(projected.workspaces).toEqual(status.workspaces);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['not an array', activeWorkspaceId],
    ['empty list', []],
    ['single entry', [activeWorkspaceId]],
    ['duplicate id', [activeWorkspaceId, activeWorkspaceId]],
    ['unknown id', [activeWorkspaceId, '33333333-3333-4333-8333-333333333333']],
    ['invalid id', [activeWorkspaceId, 'invalid']],
    ['sparse list', new Array(2)],
    ['over budget', new Array(65).fill(activeWorkspaceId)],
  ])('rejects duplicate metadata: %s', async (_name, duplicateWorkspaceLabelIds) => {
    const capability = getDesktopWorkspaceManagement({
      ekyDesktop: createDesktopApi({
        getWorkspaceManagementStatus: async () => ({
          ...status, duplicateWorkspaceLabelIds,
        }),
      }),
    })!;

    await expect(capability.getStatus()).rejects.toThrow('Invalid workspace management status.');
  });

  it.each(['create', 'import', 'rename'] as const)(
    'preserves the %s conflict for the safe error presenter', async (operation) => {
      const conflict = new Error('WORKSPACE_MANAGEMENT_LABEL_EXISTS');
      const fail = vi.fn(async () => { throw conflict; });
      const capability = getDesktopWorkspaceManagement({
        ekyDesktop: createDesktopApi({
          createEmptyWorkspace: fail,
          importWorkspaceBackupAsNew: fail,
          renameWorkspace: fail,
        }),
      })!;
      const result = operation === 'create'
        ? capability.createEmpty('Yritys')
        : operation === 'import'
          ? capability.importBackupAsNew('Yritys')
          : capability.rename(otherWorkspaceId, 'Yritys');

      await expect(result).rejects.toBe(conflict);
      expect(isWorkspaceLabelExistsError(conflict)).toBe(true);
      expect(fail).toHaveBeenCalledOnce();
    },
  );
});

describe('isWorkspaceLabelExistsError', () => {
  it.each(['create-empty', 'import-backup-as-new', 'rename'])(
    'accepts the exact Electron %s wrapper', (operation) => {
      expect(isWorkspaceLabelExistsError(new Error(
        `Error invoking remote method 'eky:workspace-management:v1:${operation}': Error: WORKSPACE_MANAGEMENT_LABEL_EXISTS`,
      ))).toBe(true);
    },
  );

  it.each([
    undefined,
    'WORKSPACE_MANAGEMENT_LABEL_EXISTS',
    { message: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' },
    new Error('WORKSPACE_MANAGEMENT_LABEL_EXISTS details must not leak'),
    new Error('prefix WORKSPACE_MANAGEMENT_LABEL_EXISTS'),
    new Error('WORKSPACE_CREATION_LABEL_EXISTS'),
    new Error("Error invoking remote method 'eky:workspace-management:v1:switch': Error: WORKSPACE_MANAGEMENT_LABEL_EXISTS"),
    new Error("Error invoking remote method 'eky:workspace-management:v2:rename': Error: WORKSPACE_MANAGEMENT_LABEL_EXISTS"),
    new Error('Unknown failure'),
  ])('rejects an unrecognized error %#', (error) => {
    expect(isWorkspaceLabelExistsError(error)).toBe(false);
  });
});

describe('workspace deletion result reader', () => {
  const completed = { formatVersion: 1, status: 'completed', navigation: 'selector' };
  const failed = {
    formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_MANAGEMENT_BUSY',
    sideEffectState: 'none', nextAction: 'continue',
  };
  const recovery = {
    formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED',
    sideEffectState: 'unknown', nextAction: 'restartRequired',
  };

  it.each([
    completed,
    { ...completed, navigation: 'reopenPrevious' },
    ...['continue', 'relaunching', 'restartRequired'].map((nextAction) => ({
      formatVersion: 1, status: 'cancelled', nextAction,
    })),
    failed,
    { ...failed, nextAction: 'restartRequired' },
    recovery,
  ])('copies and freezes a valid result %#', (source) => {
    const input = { ...source };
    const projected = readWorkspaceDeletionResult(input);
    expect(projected).toEqual(input);
    expect(projected).not.toBe(input);
    expect(Object.isFrozen(projected)).toBe(true);
    input.formatVersion = 2;
    expect(projected.formatVersion).toBe(1);
  });

  it.each([
    'WORKSPACE_MANAGEMENT_BUSY',
    'WORKSPACE_MANAGEMENT_INVALID',
    'WORKSPACE_DELETE_STALE_CONFIRMATION',
    'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
    'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN',
    'WORKSPACE_DELETE_INVENTORY_INVALID',
    'WORKSPACE_DELETE_JOURNAL_CONFLICT',
    'WORKSPACE_DELETE_IO_FAILED',
    'WORKSPACE_DELETE_CLEANUP_FAILED',
    'WORKSPACE_DELETE_FAILED',
  ])('accepts only the safe catalog value %s in either failure shape', (errorCode) => {
    for (const input of [failed, recovery]) {
      expect(readWorkspaceDeletionResult({ ...input, errorCode })).toEqual({ ...input, errorCode });
    }
  });

  it.each([
    undefined, null, [], true, 'completed', new Error('private original cause'),
    { ...completed, formatVersion: 2 },
    { ...completed, status: 'prepared' },
    { ...completed, status: 'recordRemoved' },
    { ...completed, navigation: 'anotherWorkspace' },
    { ...completed, nextAction: 'continue' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'retry' },
    { ...failed, sideEffectState: 'unknown' },
    { ...failed, nextAction: 'relaunching' },
    { ...failed, errorCode: 'WORKSPACE_MANAGEMENT_FORBIDDEN' },
    { ...failed, errorCode: 'WORKSPACE_DELETE_FAILED private detail' },
    { ...failed, errorCode: null },
    { ...failed, errorCode: { code: 'WORKSPACE_DELETE_FAILED' } },
    { ...recovery, sideEffectState: 'none' },
    { ...recovery, nextAction: 'continue' },
    { ...recovery, nextAction: 'relaunching' },
    { ...recovery, status: 'completed' },
    { ...recovery, cause: 'private original cause' },
    { ...completed, databasePath: 'C:\\private\\workspace.sqlite' },
    { ...completed, workspaceId: activeWorkspaceId },
    { ...completed, operationId: 'private-operation' },
    Object.assign(Object.create({ inherited: true }), completed),
    Object.defineProperty({ ...completed }, 'privateField', { value: 'private' }),
    { ...completed, [Symbol('private')]: true },
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy failure'); } }),
  ])('rejects an invalid or overbroad projection %# without disclosing it', (input) => {
    expect(() => readWorkspaceDeletionResult(input)).toThrow('Invalid workspace deletion result.');
    try {
      readWorkspaceDeletionResult(input);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Invalid workspace deletion result.');
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it.each([
    completed,
    { formatVersion: 1, status: 'cancelled', nextAction: 'continue' },
    failed,
    recovery,
  ].flatMap((input) => Object.keys(input).map((field) => [input, field] as const)))(
    'rejects accessors in result %# before reading them', (source, field) => {
      const get = vi.fn(() => { throw new Error('private accessor cause'); });
      const input = Object.defineProperty({ ...source }, field, { get });
      expect(() => readWorkspaceDeletionResult(input)).toThrow('Invalid workspace deletion result.');
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('accepts null-prototype data but never exposes a public delete command', () => {
    expect(readWorkspaceDeletionResult(Object.assign(Object.create(null), recovery))).toEqual(recovery);
    const capability = getDesktopWorkspaceManagement({ ekyDesktop: createDesktopApi() });
    expect(capability).not.toHaveProperty('deleteWorkspace');
    expect(getDesktopWorkspaceManagement({} as Pick<Window, 'ekyDesktop'>)).toBeUndefined();
  });
});

function createDesktopApi(
  overrides: Partial<EkyDesktopApi> = {},
): EkyDesktopApi {
  return {
    cancelLocalUpdate: async () => ({ status: 'cancelled' }),
    chooseInvoicePdfArchiveDirectory: async () => ({}),
    confirmLocalUpdate: async () => ({ status: 'cancelled' }),
    createEmptyWorkspace: async () => ({
      formatVersion: 1,
      status: 'relaunching',
    }),
    createEncryptedProfileBackup: async () => ({ status: 'cancelled' }),
    createManualRecoveryPoint: async () => ({}),
    createSupportBundle: async () => 'cancelled',
    disableInvoicePdfArchive: async () => ({}),
    discardSelectedLocalUpdate: async () => ({}),
    getInvoicePdfArchiveStatus: async () => ({}),
    getLocalUpdateStatus: async () => ({}),
    getProfileBackupStatus: async () => ({}),
    getWorkspaceManagementStatus: async () => status,
    importWorkspaceBackupAsNew: async () => ({
      formatVersion: 1,
      status: 'cancelled',
    }),
    inspectEncryptedProfileBackup: async () => ({ status: 'cancelled' }),
    openInvoicePdf: async () => undefined,
    openInvoicePdfArchiveDirectory: async () => undefined,
    openOperationalLogFolder: async () => undefined,
    renameWorkspace: async () => ({
      formatVersion: 1,
      status: 'completed',
    }),
    retryPendingInvoicePdfArchiveTasks: async () => ({}),
    selectLocalUpdate: async () => ({ status: 'cancelled' }),
    switchWorkspace: async () => ({
      formatVersion: 1,
      status: 'completed',
    }),
    ...overrides,
  };
}
