import { describe, expect, it, vi } from 'vitest';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { createLocalUpdateSelectionCapability } from './localUpdateSelectionCapability.js';
import {
  cancelLocalUpdateIpcChannel,
  confirmLocalUpdateIpcChannel,
  discardSelectedLocalUpdateIpcChannel,
  getLocalUpdateStatusIpcChannel,
  selectLocalUpdateIpcChannel,
} from './localUpdateSelectionTypes.js';
import type {
  LocalUpdatePackageStatusSummary,
  LocalUpdatePackageSummary,
} from './localUpdatePackageCache.js';

const releaseInfo: DesktopReleaseInfo = {
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  buildRevision: '123456789abc',
  msiProductVersion: '0.1.1',
  platform: 'win32',
  releaseChannel: 'pilot',
  schemaVersion: 1,
  upgradeCode: '302530B2-D950-41F5-8397-264B485FEE9A',
};

const currentSummary: Readonly<LocalUpdatePackageStatusSummary> =
  Object.freeze({
    appVersion: releaseInfo.appVersion,
    buildRevision: releaseInfo.buildRevision,
    msiProductVersion: releaseInfo.msiProductVersion,
    packageFingerprint: 'a'.repeat(12),
    releaseChannel: 'pilot' as const,
    role: 'current' as const,
    signingStatus: 'unsigned-prototype' as const,
  });

const candidateSummary: Readonly<LocalUpdatePackageStatusSummary> =
  Object.freeze({
    appVersion: '0.1.0-alpha.2',
    buildRevision: 'abcdef012345',
    msiProductVersion: '0.1.2',
    packageFingerprint: 'b'.repeat(12),
    releaseChannel: 'pilot' as const,
    role: 'candidate' as const,
    signingStatus: 'unsigned-prototype' as const,
  });

describe('local update selection capability', () => {
  it('returns a bounded status without paths, full hashes or session data', async () => {
    const fixture = createFixture({
      candidate: candidateSummary,
      current: currentSummary,
    });

    const status = await fixture.invoke(
      getLocalUpdateStatusIpcChannel,
      fixture.trustedEvent,
    );

    expect(status).toEqual({
      architecture: 'x64',
      candidate: candidateSummary,
      current: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: '123456789abc',
        msiProductVersion: '0.1.1',
        releaseChannel: 'pilot',
      },
      currentRollbackPackage: 'ready',
      phase: 'idle',
      recoveryPointState: 'notStarted',
      signingStatus: 'unsigned-prototype',
    });
    expect(JSON.stringify(status)).not.toMatch(
      /C:\\|packageSha256|packagePath|runtimeSession/i,
    );
  });

  it('registers the exact current package first and stages only later candidates', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(selectLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toMatchObject({ status: 'currentRegistered' });
    expect(fixture.stageSelectedPackage).toHaveBeenLastCalledWith({
      manifestPath: 'C:\\Release\\Eky.manifest.json',
      role: 'current',
    });

    fixture.getPackageStatus.mockImplementation(async (role) =>
      role === 'current' ? currentSummary : undefined,
    );
    fixture.stageSelectedPackage.mockResolvedValueOnce(candidateSummary);
    await expect(
      fixture.invoke(selectLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toMatchObject({ status: 'candidateReady' });
    expect(fixture.stageSelectedPackage).toHaveBeenLastCalledWith({
      manifestPath: 'C:\\Release\\Eky.manifest.json',
      role: 'candidate',
    });
  });

  it('returns file-picker cancellation without touching the private cache', async () => {
    const fixture = createFixture({ manifestPath: null });

    await expect(
      fixture.invoke(selectLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(fixture.stageSelectedPackage).not.toHaveBeenCalled();
    expect(fixture.showSafeError).not.toHaveBeenCalled();
  });

  it('discards only the main-owned candidate and returns the refreshed status', async () => {
    const fixture = createFixture({
      candidate: candidateSummary,
      current: currentSummary,
    });
    fixture.discardCandidate.mockImplementationOnce(async () => {
      fixture.getPackageStatus.mockImplementation(async (role) =>
        role === 'current' ? currentSummary : undefined,
      );
    });

    await expect(
      fixture.invoke(discardSelectedLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toMatchObject({ status: { candidate: null } });
    expect(fixture.discardCandidate).toHaveBeenCalledOnce();
  });

  it('does not create a recovery point or hand off when native confirmation is cancelled', async () => {
    const fixture = createFixture({
      candidate: candidateSummary,
      confirmResult: false,
      current: currentSummary,
    });

    await expect(
      fixture.invoke(confirmLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(fixture.confirmUpdate).toHaveBeenCalledOnce();
    expect(fixture.prepareConfirmedUpdate).not.toHaveBeenCalled();
    expect(fixture.handoffPreparedUpdate).not.toHaveBeenCalled();
  });

  it('prepares and hands off only the revalidated main-owned candidate after confirmation', async () => {
    const fixture = createFixture({
      candidate: candidateSummary,
      confirmResult: true,
      current: currentSummary,
    });

    await expect(
      fixture.invoke(confirmLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toEqual({ status: 'handoffStarted' });
    expect(fixture.confirmUpdate).toHaveBeenCalledOnce();
    expect(fixture.prepareConfirmedUpdate).toHaveBeenCalledOnce();
    expect(fixture.handoffPreparedUpdate).toHaveBeenCalledOnce();
    expect(fixture.prepareConfirmedUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.handoffPreparedUpdate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps cancel as a no-op command', async () => {
    const fixture = createFixture({
      candidate: candidateSummary,
      current: currentSummary,
    });

    await expect(
      fixture.invoke(cancelLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(fixture.confirmUpdate).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.prepareConfirmedUpdate).not.toHaveBeenCalled();
  });

  it('rejects renderer input, untrusted frames and overlapping commands', async () => {
    let resolveSelection: ((value: string | null) => void) | undefined;
    const fixture = createFixture({
      selectManifestPath: () =>
        new Promise<string | null>((resolve) => {
          resolveSelection = resolve;
        }),
    });

    await expect(
      fixture.invoke(
        selectLocalUpdateIpcChannel,
        fixture.trustedEvent,
        'C:\\Renderer\\package.json',
      ),
    ).rejects.toThrow('LOCAL_UPDATE_OPERATION_FORBIDDEN');
    await expect(
      fixture.invoke(getLocalUpdateStatusIpcChannel, {
        sender: {},
        senderFrame: fixture.mainFrame,
      }),
    ).rejects.toThrow('LOCAL_UPDATE_OPERATION_FORBIDDEN');
    const firstSelection = fixture.invoke(
      selectLocalUpdateIpcChannel,
      fixture.trustedEvent,
    );
    await expect(
      fixture.invoke(getLocalUpdateStatusIpcChannel, fixture.trustedEvent),
    ).rejects.toThrow('LOCAL_UPDATE_OPERATION_FORBIDDEN');
    resolveSelection?.(null);
    await expect(firstSelection).resolves.toEqual({ status: 'cancelled' });
  });

  it('fails closed, reports a safe error and removes every handler on dispose', async () => {
    const fixture = createFixture();
    fixture.stageSelectedPackage.mockRejectedValueOnce(
      new Error('C:\\Users\\Example\\secret source path'),
    );

    await expect(
      fixture.invoke(selectLocalUpdateIpcChannel, fixture.trustedEvent),
    ).rejects.toThrow('LOCAL_UPDATE_OPERATION_FAILED');
    expect(fixture.showSafeError).toHaveBeenCalledOnce();

    fixture.capability.dispose();
    expect(fixture.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(
      expect.arrayContaining(allChannels),
    );
  });

  it('reports only closed update stages without forwarding package details', async () => {
    const fixture = createFixture({ current: currentSummary });

    await expect(
      fixture.invoke(selectLocalUpdateIpcChannel, fixture.trustedEvent),
    ).resolves.toMatchObject({ status: 'candidateReady' });

    expect(fixture.operationStarted.mock.calls.map(([event]) => event)).toEqual([
      { correlationId: 'update-operation-id', stage: 'packageInspection' },
      { correlationId: 'update-operation-id', stage: 'packageStaging' },
    ]);
    expect(
      JSON.stringify([
        fixture.operationStarted.mock.calls,
        fixture.operationCompleted.mock.calls,
      ]),
    ).not.toMatch(/C:\\|manifest|packageSha256|runtimeSession/i);
  });
});

const allChannels = [
  getLocalUpdateStatusIpcChannel,
  selectLocalUpdateIpcChannel,
  discardSelectedLocalUpdateIpcChannel,
  confirmLocalUpdateIpcChannel,
  cancelLocalUpdateIpcChannel,
];

function createFixture(
  options: {
    candidate?: Readonly<LocalUpdatePackageStatusSummary>;
    confirmResult?: boolean;
    current?: Readonly<LocalUpdatePackageStatusSummary>;
    manifestPath?: string | null;
    selectManifestPath?: () => Promise<string | null>;
  } = {},
) {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >();
  const handle = vi.fn(
    (
      channel: string,
      registeredHandler: (
        event: unknown,
        ...args: unknown[]
      ) => Promise<unknown>,
    ) => {
      handlers.set(channel, registeredHandler);
    },
  );
  const removeHandler = vi.fn();
  const mainFrame = {};
  const webContents = { mainFrame };
  const getPackageStatus = vi.fn(async (role: 'candidate' | 'current') =>
    role === 'current' ? options.current : options.candidate,
  );
  const discardCandidate = vi.fn(async () => undefined);
  const stageSelectedPackage = vi.fn(
    async (): Promise<Readonly<LocalUpdatePackageSummary>> => currentSummary,
  );
  const selectManifestPath = vi.fn(
    options.selectManifestPath ??
      (async () =>
        options.manifestPath === undefined
          ? 'C:\\Release\\Eky.manifest.json'
          : options.manifestPath),
  );
  const showSafeError = vi.fn();
  const confirmUpdate = vi.fn(async () => options.confirmResult ?? false);
  const prepareConfirmedUpdate = vi.fn(async () => undefined);
  const handoffPreparedUpdate = vi.fn(async () => undefined);
  const operationStarted = vi.fn();
  const operationCompleted = vi.fn();
  const operationFailed = vi.fn();
  const capability = createLocalUpdateSelectionCapability({
    cache: {
      discardCandidate,
      getPackageStatus,
      stageSelectedPackage,
    } as never,
    confirmUpdate,
    handoffCoordinator: {
      handoffPreparedUpdate,
      prepareConfirmedUpdate,
    } as never,
    ipcMain: { handle, removeHandler } as never,
    journalStore: { read: vi.fn(async () => undefined) },
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as never,
    observer: {
      operationCompleted,
      operationFailed,
      operationStarted,
    },
    operationIdFactory: () => 'update-operation-id',
    releaseInfo,
    selectManifestPath,
    showSafeError,
  });

  return {
    capability,
    confirmUpdate,
    discardCandidate,
    getPackageStatus,
    handoffPreparedUpdate,
    invoke(channel: string, event: unknown, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (handler === undefined) {
        throw new Error(`Test handler was not registered: ${channel}`);
      }
      return handler(event, ...args);
    },
    mainFrame,
    operationCompleted,
    operationFailed,
    operationStarted,
    prepareConfirmedUpdate,
    removeHandler,
    showSafeError,
    stageSelectedPackage,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
  };
}
