import { describe, expect, it, vi } from 'vitest';

import {
  getDesktopInvoicePdfArchive,
  getDesktopInvoicePdfPreview,
  getDesktopLocalUpdate,
  getDesktopOperationalLogFolder,
  getDesktopProfileProtection,
  getDesktopSupportBundleCreator,
  type EkyDesktopApi,
} from './desktopBridge.js';

describe('desktop bridge', () => {
  it('returns only the narrow invoice PDF preview callback when available', async () => {
    const openInvoicePdf = vi.fn(async () => undefined);
    const preview = getDesktopInvoicePdfPreview({
      ekyDesktop: createDesktopApi({ openInvoicePdf }),
    });

    await preview?.('invoice-1');

    expect(openInvoicePdf).toHaveBeenCalledWith('invoice-1');
  });

  it('does not invent a desktop bridge in the browser runtime', () => {
    expect(
      getDesktopInvoicePdfPreview({} as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();
  });

  it('does not expose desktop-only capabilities through a malformed bridge', () => {
    expect(
      getDesktopInvoicePdfPreview({
        ekyDesktop: {} as EkyDesktopApi,
      } as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();
  });

  it('exposes only the named local update commands and safe status', async () => {
    const getLocalUpdateStatus = vi.fn(async () => localUpdateStatus);
    const selectLocalUpdate = vi.fn(async () => ({
      package: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: '123456789abc',
        msiProductVersion: '0.1.1',
        releaseChannel: 'pilot',
        role: 'current',
        signingStatus: 'unsigned-prototype',
      },
      status: 'currentRegistered',
    }));
    const capability = getDesktopLocalUpdate({
      ekyDesktop: createDesktopApi({
        getLocalUpdateStatus,
        selectLocalUpdate,
      }),
    });

    await expect(capability?.getStatus()).resolves.toEqual(localUpdateStatus);
    await expect(capability?.select()).resolves.toBe('currentRegistered');
    await expect(capability?.cancel()).resolves.toBe('cancelled');
    expect(getLocalUpdateStatus).toHaveBeenCalledWith();
    expect(selectLocalUpdate).toHaveBeenCalledWith();
  });

  it('does not expose local updates in browser or through an incomplete bridge', () => {
    expect(
      getDesktopLocalUpdate({} as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();
    const desktop = createDesktopApi();
    desktop.confirmLocalUpdate = undefined as never;
    expect(getDesktopLocalUpdate({ ekyDesktop: desktop })).toBeUndefined();
  });

  it.each([
    { ...localUpdateStatus, rawPath: 'C:\\Private\\update' },
    {
      ...localUpdateStatus,
      candidate: {
        ...localUpdateStatus.candidate,
        packageFingerprint: 'b'.repeat(64),
      },
    },
    { ...localUpdateStatus, phase: 'unknown' },
  ])('rejects unsafe local update status data', async (unsafeStatus) => {
    const capability = getDesktopLocalUpdate({
      ekyDesktop: createDesktopApi({
        getLocalUpdateStatus: vi.fn(async () => unsafeStatus),
      }),
    });

    await expect(capability?.getStatus()).rejects.toThrow(
      'Invalid local update status.',
    );
  });

  it('exposes the fixed desktop log folder capability when available', async () => {
    const openOperationalLogFolder = vi.fn(async () => undefined);
    const openLogFolder = getDesktopOperationalLogFolder({
      ekyDesktop: createDesktopApi({ openOperationalLogFolder }),
    });

    await openLogFolder?.();

    expect(openOperationalLogFolder).toHaveBeenCalledOnce();
  });

  it('exposes support bundle creation without returning a file path', async () => {
    const createSupportBundle = vi.fn(async () => 'created' as const);
    const createBundle = getDesktopSupportBundleCreator({
      ekyDesktop: createDesktopApi({ createSupportBundle }),
    });

    await expect(createBundle?.()).resolves.toBe('created');
    expect(createSupportBundle).toHaveBeenCalledWith();
  });

  it('exposes the narrow invoice PDF archive capability', async () => {
    const chooseInvoicePdfArchiveDirectory = vi.fn(async () => enabledStatus);
    const disableInvoicePdfArchive = vi.fn(async () => disabledStatus);
    const getInvoicePdfArchiveStatus = vi.fn(async () => enabledStatus);
    const openInvoicePdfArchiveDirectory = vi.fn(async () => undefined);
    const retryPendingInvoicePdfArchiveTasks = vi.fn(
      async () => enabledStatus,
    );
    const capability = getDesktopInvoicePdfArchive({
      ekyDesktop: createDesktopApi({
        chooseInvoicePdfArchiveDirectory,
        disableInvoicePdfArchive,
        getInvoicePdfArchiveStatus,
        openInvoicePdfArchiveDirectory,
        retryPendingInvoicePdfArchiveTasks,
      }),
    });

    await expect(capability?.getStatus()).resolves.toEqual(enabledStatus);
    await expect(capability?.chooseDirectory()).resolves.toEqual(enabledStatus);
    await expect(capability?.retryPending()).resolves.toEqual(enabledStatus);
    await expect(capability?.disable()).resolves.toEqual(disabledStatus);
    await expect(capability?.openDirectory()).resolves.toBeUndefined();

    expect(chooseInvoicePdfArchiveDirectory).toHaveBeenCalledWith();
    expect(disableInvoicePdfArchive).toHaveBeenCalledWith();
    expect(getInvoicePdfArchiveStatus).toHaveBeenCalledWith();
    expect(openInvoicePdfArchiveDirectory).toHaveBeenCalledWith();
    expect(retryPendingInvoicePdfArchiveTasks).toHaveBeenCalledWith();
  });

  it('does not expose an incomplete invoice PDF archive bridge', () => {
    const desktop = createDesktopApi();
    desktop.retryPendingInvoicePdfArchiveTasks = undefined as never;

    expect(
      getDesktopInvoicePdfArchive({ ekyDesktop: desktop }),
    ).toBeUndefined();
  });

  it.each([
    {
      ...enabledStatus,
      displayName: 'C:\\Renderer\\Path',
    },
    {
      ...enabledStatus,
      lastSafeErrorCode: 'INTERNAL_ERROR',
    },
    {
      ...enabledStatus,
      pendingCount: -1,
    },
    {
      ...enabledStatus,
      rawDirectoryPath: 'C:\\Secret',
    },
  ])('rejects an unsafe invoice PDF archive status', async (status) => {
    const capability = getDesktopInvoicePdfArchive({
      ekyDesktop: createDesktopApi({
        getInvoicePdfArchiveStatus: vi.fn(async () => status),
      }),
    });

    await expect(capability?.getStatus()).rejects.toThrow(
      'Invalid invoice PDF archive status.',
    );
  });

  it('exposes the narrow profile protection capability', async () => {
    const activatePreparedProfileRestore = vi.fn(
      async () => 'cancelled' as const,
    );
    const createEncryptedProfileBackup = vi.fn(
      async () => 'created' as const,
    );
    const createManualRecoveryPoint = vi.fn(async () => protectionStatus);
    const getProfileBackupStatus = vi.fn(async () => protectionStatus);
    const inspectEncryptedProfileBackup = vi.fn(
      async () => inspectedBackup,
    );
    const prepareEncryptedProfileRestore = vi.fn(
      async () => inspectedBackup,
    );
    const capability = getDesktopProfileProtection({
      ekyDesktop: createDesktopApi({
        activatePreparedProfileRestore,
        createEncryptedProfileBackup,
        createManualRecoveryPoint,
        getProfileBackupStatus,
        inspectEncryptedProfileBackup,
        prepareEncryptedProfileRestore,
      }),
    });

    await expect(capability?.getStatus()).resolves.toEqual(protectionStatus);
    await expect(capability?.createBackup()).resolves.toBe('created');
    await expect(capability?.inspectBackup()).resolves.toEqual(
      inspectedBackup,
    );
    await expect(capability?.prepareRestore()).resolves.toEqual(
      inspectedBackup,
    );
    await expect(capability?.createRecoveryPoint()).resolves.toEqual(
      protectionStatus,
    );
    await expect(capability?.activatePreparedRestore()).resolves.toBe(
      'cancelled',
    );
  });

  it('rejects unsafe profile protection data from desktop main', async () => {
    const capability = getDesktopProfileProtection({
      ekyDesktop: createDesktopApi({
        getProfileBackupStatus: vi.fn(async () => ({
          ...protectionStatus,
          rawPath: 'C:\\Private\\profile',
        })),
      }),
    });

    await expect(capability?.getStatus()).rejects.toThrow(
      'Invalid profile protection status.',
    );
  });

  it('rejects backup summaries that expose internal fields', async () => {
    const capability = getDesktopProfileProtection({
      ekyDesktop: createDesktopApi({
        inspectEncryptedProfileBackup: vi.fn(async () => ({
          ...inspectedBackup,
          summary: {
            ...inspectedBackup.summary,
            companyId: 'private-company',
          },
        })),
      }),
    });

    await expect(capability?.inspectBackup()).rejects.toThrow(
      'Invalid profile backup inspection result.',
    );
  });
});

const enabledStatus = {
  displayName: 'Laskuarkisto',
  enabled: true,
  lastArchivedAt: '2026-08-03T20:00:00.000Z',
  lastSafeErrorCode: null,
  pendingCount: 2,
};

const disabledStatus = {
  displayName: null,
  enabled: false,
  lastArchivedAt: null,
  lastSafeErrorCode: null,
  pendingCount: 0,
};

const localUpdateStatus = {
  architecture: 'x64' as const,
  candidate: {
    appVersion: '0.1.0-alpha.2',
    buildRevision: 'abcdef012345',
    msiProductVersion: '0.1.2',
    packageFingerprint: 'abcdef012345',
    releaseChannel: 'pilot' as const,
    role: 'candidate' as const,
    signingStatus: 'unsigned-prototype' as const,
  },
  current: {
    appVersion: '0.1.0-alpha.1',
    buildRevision: '123456789abc',
    msiProductVersion: '0.1.1',
    releaseChannel: 'pilot' as const,
  },
  currentRollbackPackage: 'ready' as const,
  phase: 'idle' as const,
  recoveryPointState: 'notStarted' as const,
  signingStatus: 'unsigned-prototype' as const,
};

const protectionStatus = {
  portableBackup: {
    latestSuccessfulPortableBackupAt: '2026-08-04T18:00:00.000Z',
    operationState: 'idle' as const,
  },
  recoveryPoints: {
    availability: 'available' as const,
    budgetState: 'withinBudget' as const,
    latestValidatedGoodAt: '2026-08-04T17:00:00.000Z',
    nextAutomaticCheckAt: '2026-08-05T17:00:00.000Z',
    operationState: 'idle' as const,
    pointCount: 3,
  },
  restoreOperationState: 'idle' as const,
};

const inspectedBackup = {
  status: 'inspected' as const,
  summary: {
    appVersion: '0.1.0',
    compatibilityStatus: 'compatible' as const,
    createdAt: '2026-08-04T18:00:00.000Z',
    databaseHealth: 'healthy' as const,
    documentCount: 4,
    formatVersion: 1 as const,
    profileMatchStatus: 'same' as const,
    totalBusinessByteSize: 1024,
  },
};

function createDesktopApi(
  overrides: Partial<EkyDesktopApi> = {},
): EkyDesktopApi {
  return {
    activatePreparedProfileRestore: vi.fn(async () => 'cancelled'),
    chooseInvoicePdfArchiveDirectory: vi.fn(async () => disabledStatus),
    createEncryptedProfileBackup: vi.fn(async () => 'cancelled'),
    createManualRecoveryPoint: vi.fn(async () => protectionStatus),
    createSupportBundle: vi.fn(async () => 'cancelled' as const),
    createEmptyWorkspace: vi.fn(async () => ({
      formatVersion: 1,
      status: 'relaunching',
    })),
    cancelLocalUpdate: vi.fn(async () => ({ status: 'cancelled' })),
    confirmLocalUpdate: vi.fn(async () => ({ status: 'cancelled' })),
    disableInvoicePdfArchive: vi.fn(async () => disabledStatus),
    discardSelectedLocalUpdate: vi.fn(async () => ({
      status: localUpdateStatus,
    })),
    getLocalUpdateStatus: vi.fn(async () => localUpdateStatus),
    getInvoicePdfArchiveStatus: vi.fn(async () => disabledStatus),
    getProfileBackupStatus: vi.fn(async () => ({
      operationState: 'idle',
    })),
    getWorkspaceManagementStatus: vi.fn(async () => ({
      activeWorkspaceId: null,
      formatVersion: 1,
      operationState: 'idle',
      workspaces: [],
    })),
    importWorkspaceBackupAsNew: vi.fn(async () => ({
      formatVersion: 1,
      status: 'cancelled',
    })),
    inspectEncryptedProfileBackup: vi.fn(async () => ({
      status: 'cancelled',
    })),
    openInvoicePdf: vi.fn(async () => undefined),
    openInvoicePdfArchiveDirectory: vi.fn(async () => undefined),
    openOperationalLogFolder: vi.fn(async () => undefined),
    prepareEncryptedProfileRestore: vi.fn(async () => ({
      status: 'cancelled',
    })),
    renameWorkspace: vi.fn(async () => ({
      formatVersion: 1,
      status: 'completed',
    })),
    retryPendingInvoicePdfArchiveTasks: vi.fn(async () => disabledStatus),
    selectLocalUpdate: vi.fn(async () => ({ status: 'cancelled' })),
    switchWorkspace: vi.fn(async () => ({
      formatVersion: 1,
      status: 'completed',
    })),
    ...overrides,
  };
}
