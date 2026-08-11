import { describe, expect, it, vi } from 'vitest';

import { createLocalUpdateSelectionCapability } from './localUpdateSelectionCapability.js';
import { selectLocalUpdateIpcChannel } from './localUpdateSelectionTypes.js';
import type { LocalUpdatePackageSummary } from './localUpdatePackageCache.js';

const currentSummary: Readonly<LocalUpdatePackageSummary> = Object.freeze({
  appVersion: '0.1.0-alpha.1',
  buildRevision: '123456789abc',
  msiProductVersion: '0.1.1',
  releaseChannel: 'pilot' as const,
  role: 'current' as const,
  signingStatus: 'unsigned-prototype' as const,
});

describe('local update selection capability', () => {
  it('registers the exact current package first and returns only a safe summary', async () => {
    const fixture = createFixture();

    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toEqual({
      package: currentSummary,
      status: 'currentRegistered',
    });
    expect(fixture.selectManifestPath).toHaveBeenCalledWith();
    expect(fixture.stageSelectedPackage).toHaveBeenCalledWith({
      manifestPath: 'C:\\Release\\Eky.manifest.json',
      role: 'current',
    });
    const serialized = JSON.stringify(await fixture.invoke(fixture.trustedEvent));
    expect(serialized).not.toContain('C:\\Release');
    expect(serialized).not.toContain('packageSha256');
    expect(serialized).not.toContain('packageFilename');
  });

  it('stages a candidate after current has been registered', async () => {
    const fixture = createFixture({ currentState: 'ready' });
    fixture.stageSelectedPackage.mockResolvedValueOnce({
      ...currentSummary,
      appVersion: '0.1.0-alpha.2',
      msiProductVersion: '0.1.2',
      role: 'candidate',
    });

    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toMatchObject({
      package: { role: 'candidate' },
      status: 'candidateReady',
    });
    expect(fixture.stageSelectedPackage).toHaveBeenCalledWith({
      manifestPath: 'C:\\Release\\Eky.manifest.json',
      role: 'candidate',
    });
  });

  it('returns cancellation without touching the private cache', async () => {
    const fixture = createFixture({ manifestPath: null });

    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(fixture.stageSelectedPackage).not.toHaveBeenCalled();
    expect(fixture.showSafeError).not.toHaveBeenCalled();
  });

  it('rejects renderer input, untrusted frames and overlapping selections', async () => {
    let resolveSelection: ((value: string | null) => void) | undefined;
    const fixture = createFixture({
      selectManifestPath: () =>
        new Promise<string | null>((resolve) => {
          resolveSelection = resolve;
        }),
    });

    await expect(
      fixture.invoke(fixture.trustedEvent, 'C:\\Renderer\\package.json'),
    ).rejects.toThrow('LOCAL_UPDATE_SELECTION_FORBIDDEN');
    await expect(
      fixture.invoke({ sender: {}, senderFrame: fixture.mainFrame }),
    ).rejects.toThrow('LOCAL_UPDATE_SELECTION_FORBIDDEN');
    const firstSelection = fixture.invoke(fixture.trustedEvent);
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow(
      'LOCAL_UPDATE_SELECTION_FORBIDDEN',
    );
    resolveSelection?.(null);
    await expect(firstSelection).resolves.toEqual({ status: 'cancelled' });
    expect(fixture.showSafeError).not.toHaveBeenCalled();
  });

  it('fails closed with a safe error and removes the handler on dispose', async () => {
    const fixture = createFixture();
    fixture.stageSelectedPackage.mockRejectedValueOnce(
      new Error('C:\\Users\\Example\\secret source path'),
    );

    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow(
      'LOCAL_UPDATE_SELECTION_FAILED',
    );
    expect(fixture.showSafeError).toHaveBeenCalledOnce();

    fixture.capability.dispose();
    expect(fixture.removeHandler).toHaveBeenLastCalledWith(
      selectLocalUpdateIpcChannel,
    );
  });

  it('does not expose future cache fields and keeps the fixed error if the dialog fails', async () => {
    const fixture = createFixture();
    fixture.stageSelectedPackage.mockResolvedValueOnce({
      ...currentSummary,
      internalPath: 'C:\\Private\\update-cache',
      packageSha256: 'a'.repeat(64),
    } as never);

    const result = await fixture.invoke(fixture.trustedEvent);
    expect(JSON.stringify(result)).not.toContain('internalPath');
    expect(JSON.stringify(result)).not.toContain('packageSha256');

    fixture.stageSelectedPackage.mockRejectedValueOnce(new Error('raw'));
    fixture.showSafeError.mockImplementationOnce(() => {
      throw new Error('dialog raw error');
    });
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow(
      'LOCAL_UPDATE_SELECTION_FAILED',
    );
  });
});

function createFixture(
  options: {
    currentState?: 'missing' | 'ready';
    manifestPath?: string | null;
    selectManifestPath?: () => Promise<string | null>;
  } = {},
) {
  let handler:
    | ((event: unknown, ...args: unknown[]) => Promise<unknown>)
    | undefined;
  const handle = vi.fn(
    (
      channel: string,
      registeredHandler: (
        event: unknown,
        ...args: unknown[]
      ) => Promise<unknown>,
    ) => {
      expect(channel).toBe(selectLocalUpdateIpcChannel);
      handler = registeredHandler;
    },
  );
  const removeHandler = vi.fn();
  const mainFrame = {};
  const webContents = { mainFrame };
  const getCurrentRegistrationState = vi.fn(
    async () => options.currentState ?? 'missing',
  );
  const stageSelectedPackage = vi.fn(async () => currentSummary);
  const selectManifestPath = vi.fn(
    options.selectManifestPath ??
      (async () =>
        options.manifestPath === undefined
          ? 'C:\\Release\\Eky.manifest.json'
          : options.manifestPath),
  );
  const showSafeError = vi.fn();
  const capability = createLocalUpdateSelectionCapability({
    cache: { getCurrentRegistrationState, stageSelectedPackage } as never,
    ipcMain: { handle, removeHandler } as never,
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as never,
    selectManifestPath,
    showSafeError,
  });

  return {
    capability,
    invoke(event: unknown, ...args: unknown[]) {
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    mainFrame,
    removeHandler,
    selectManifestPath,
    showSafeError,
    stageSelectedPackage,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
  };
}
