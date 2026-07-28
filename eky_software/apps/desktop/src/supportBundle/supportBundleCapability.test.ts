import { describe, expect, it, vi } from 'vitest';

import { createSupportBundleIpcChannel } from '../diagnostics/desktopDiagnosticsTypes.js';
import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { createSupportBundleCapability } from './supportBundleCapability.js';

describe('support bundle capability', () => {
  it('requires confirmation and lets main own the target path', async () => {
    const fixture = createFixture();

    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toBe(
      'created',
    );

    expect(fixture.selectTargetPath).toHaveBeenCalledWith(
      'eky-support-2026-07-27.ekysupport',
    );
    expect(fixture.writeArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeRoot: '/trusted/runtime',
        targetPath: '/trusted/export/support.ekysupport',
      }),
    );
    expect(fixture.events.map(({ eventName }) => eventName)).toEqual([
      'supportBundle.creationStarted',
      'supportBundle.creationCompleted',
    ]);
  });

  it('does nothing when the user cancels before choosing a target', async () => {
    const fixture = createFixture({ confirmed: false });

    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toBe(
      'cancelled',
    );
    expect(fixture.loadBackendData).not.toHaveBeenCalled();
    expect(fixture.writeArchive).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);
  });

  it('rejects renderer input and an untrusted frame', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(fixture.trustedEvent, '/renderer/path'),
    ).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    await expect(
      fixture.invoke({ sender: {}, senderFrame: fixture.mainFrame }),
    ).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(fixture.selectTargetPath).not.toHaveBeenCalled();
  });

  it('reports only a safe failure when backend data is invalid', async () => {
    const fixture = createFixture({
      backendData: { password: 'must-not-be-accepted' },
    });

    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow(
      'SUPPORT_BUNDLE_CREATION_FAILED',
    );
    expect(fixture.showSafeError).toHaveBeenCalledOnce();
    expect(fixture.events.at(-1)).toMatchObject({
      errorCode: 'SUPPORT_BUNDLE_CREATION_FAILED',
      eventName: 'supportBundle.creationFailed',
    });
  });
});

function createFixture(
  options: {
    backendData?: unknown;
    confirmed?: boolean;
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
      expect(channel).toBe(createSupportBundleIpcChannel);
      handler = registeredHandler;
    },
  );
  const mainFrame = {};
  const webContents = { mainFrame };
  const events: DesktopOperationalEvent[] = [];
  const selectTargetPath = vi.fn(
    async () => '/trusted/export/support.ekysupport',
  );
  const loadBackendData = vi.fn(async () =>
    options.backendData === undefined
      ? createBackendData()
      : options.backendData,
  );
  const showSafeError = vi.fn();
  const writeArchive = vi.fn();

  createSupportBundleCapability({
    appVersion: '1.2.3',
    architecture: 'x64',
    confirmCreation: vi.fn(async () => options.confirmed ?? true),
    ipcMain: { handle, removeHandler: vi.fn() } as never,
    loadBackendData,
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as never,
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    operationalIdentity: {
      appVersion: '1.2.3',
      buildRevision: '123456789abc',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    operationalLogger: {
      write(event) {
        events.push(event);
      },
    },
    platform: 'win32',
    runtimeRoot: '/trusted/runtime',
    selectTargetPath,
    showSafeError,
    writeArchive,
  });

  return {
    events,
    invoke(event: unknown, ...args: unknown[]) {
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    loadBackendData,
    mainFrame,
    selectTargetPath,
    showSafeError,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
    writeArchive,
  };
}

function createBackendData() {
  return {
    backendVersion: '1.2.3',
    database: {
      appliedMigrationCount: 35,
      health: 'ok',
      latestMigrationName: '035_example.sql',
    },
    diagnosticEvents: [],
    diagnosticPeriodDays: 30,
    runtimeSummary: {
      appVersion: '0.1.0-alpha.1',
      appliedMigrationCount: 35,
      architecture: 'x64',
      buildCreatedAt: '2026-07-27T10:00:00.000Z',
      buildDirty: false,
      buildRevision: 'abcdef123456',
      databaseHealth: 'ok',
      electronVersion: '42.7.0',
      latestErrorAt: null,
      latestMigrationName: '035_example.sql',
      latestSecurityEventAt: null,
      latestWarningAt: null,
      nodeVersion: 'v24.11.0',
      operationalLogNewestMonth: '2026-07',
      operationalLogOldestMonth: '2026-07',
      operationalLogsAvailable: true,
      operationalLogTotalBytes: 4_096,
      platform: 'win32',
      runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    },
    truncated: false,
  };
}
