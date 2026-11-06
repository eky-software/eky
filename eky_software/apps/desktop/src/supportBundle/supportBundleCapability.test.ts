import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { createSupportBundleIpcChannel } from '../diagnostics/desktopDiagnosticsTypes.js';
import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { createSupportBundleCapability } from './supportBundleCapability.js';
import { writeSupportBundleAtomically } from './supportBundleFileStore.js';

describe('support bundle capability', () => {
  it('requires confirmation and lets main own the target path', async () => {
    const fixture = createFixture();

    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toBe(
      'created',
    );

    expect(fixture.selectTargetPath).toHaveBeenCalledWith(
      'eky-support-2026-07-27.json.gz',
    );
    expect(fixture.writeArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeRoot: '/trusted/runtime',
        targetPath: '/trusted/export/support.json.gz',
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

  it.each(['confirmation', 'target', 'backend'] as const)(
    'rechecks every owner after the pending %s boundary', async (phase) => {
      for (const invalidate of ['dispose', 'loading', 'navigation', 'crash', 'destroyed', 'frame', 'runtime'] as const) {
        const gate = createGate<unknown>();
        const fixture = createFixture({
          ...(phase === 'confirmation' ? { confirmCreation: async () => Boolean(await gate.wait()) } : {}),
          ...(phase === 'target' ? { selectTargetPath: async () => (await gate.wait()) as string } : {}),
          ...(phase === 'backend' ? { loadBackendData: gate.wait } : {}),
        });
        const work = fixture.invoke(fixture.trustedEvent);
        const settled = work.catch((cause: unknown) => cause);
        await gate.entered;
        switch (invalidate) {
          case 'dispose': fixture.capability.dispose(); break;
          case 'loading': fixture.webContents.emit('did-start-loading'); break;
          case 'navigation': fixture.webContents.emit('did-start-navigation', { isMainFrame: true }); break;
          case 'crash': fixture.webContents.emit('render-process-gone'); break;
          case 'destroyed': fixture.webContents.emit('destroyed'); break;
          case 'frame': fixture.webContents.mainFrame = {}; break;
          case 'runtime': fixture.changeRuntime(); break;
        }
        gate.resolve(phase === 'confirmation' ? true : phase === 'target'
          ? '/trusted/export/support.json.gz' : createBackendData());
        const error = await settled;
        expect(error, `${phase}/${invalidate}`).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('SUPPORT_BUNDLE_CREATION_FAILED');
        expect((error as Error).cause).toBeUndefined();
        expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(invalidate === 'runtime'
          ? fixture.runtimeFailure : expect.objectContaining({ message: 'SUPPORT_BUNDLE_FORBIDDEN' }));
        expect(fixture.writeArchive).not.toHaveBeenCalled();
        expect(fixture.showSafeError).not.toHaveBeenCalled();
        if (phase !== 'backend') expect(fixture.loadBackendData).not.toHaveBeenCalled();
        if (phase === 'confirmation') expect(fixture.selectTargetPath).not.toHaveBeenCalled();
        fixture.capability.dispose();
      }
    },
  );

  it('rejects obsolete and foreign callers before opening any dialog', async () => {
    const fixture = createFixture();
    await expect(fixture.invoke({ sender: fixture.webContents, senderFrame: {} }))
      .rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    fixture.changeRuntime();
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(fixture.confirmCreation).not.toHaveBeenCalled();
    expect(fixture.loadBackendData).not.toHaveBeenCalled();
    expect(fixture.writeArchive).not.toHaveBeenCalled();
  });

  it('does not confuse a subframe navigation with a replaced main document', async () => {
    const gate = createGate<boolean>();
    const fixture = createFixture({ confirmCreation: gate.wait });
    const work = fixture.invoke(fixture.trustedEvent);
    await gate.entered;
    fixture.webContents.emit('did-start-navigation', { isMainFrame: false });
    gate.resolve(true);
    await expect(work).resolves.toBe('created');
    expect(fixture.writeArchive).toHaveBeenCalledOnce();
  });

  it('does not revive an old document when a new request succeeds on the same window', async () => {
    const gate = createGate<boolean>();
    const confirmCreation = vi.fn(async () => true).mockImplementationOnce(gate.wait);
    const fixture = createFixture({ confirmCreation });
    const work = fixture.invoke(fixture.trustedEvent);
    const settled = work.catch((cause: unknown) => cause);
    await gate.entered;
    fixture.webContents.emit('did-start-loading');
    gate.resolve(true);
    expect(await settled).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
    expect(fixture.writeArchive).not.toHaveBeenCalled();
    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toBe('created');
    expect(fixture.writeArchive).toHaveBeenCalledOnce();
  });

  it('rejects a concurrent export and permits a later separate confirmed request', async () => {
    const gate = createGate<boolean>();
    const confirmCreation = vi.fn(async () => true).mockImplementationOnce(gate.wait);
    const fixture = createFixture({ confirmCreation });
    const work = fixture.invoke(fixture.trustedEvent);
    await gate.entered;
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow('SUPPORT_BUNDLE_CREATION_IN_PROGRESS');
    expect(fixture.confirmCreation).toHaveBeenCalledOnce();
    gate.resolve(false);
    await expect(work).resolves.toBe('cancelled');
    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toBe('created');
  });

  it('removes only its own listeners and rejects a saved handler after disposal', async () => {
    const fixture = createFixture();
    const unrelated = vi.fn();
    fixture.webContents.on('did-start-loading', unrelated);
    fixture.capability.dispose();
    fixture.capability.dispose();
    expect(fixture.webContents.listenerCount('did-start-loading')).toBe(1);
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
      expect(fixture.webContents.listenerCount(event)).toBe(0);
    }
    expect(fixture.mainWindow.listenerCount('close')).toBe(0);
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(fixture.confirmCreation).not.toHaveBeenCalled();
  });

  it('keeps the original failure privately when both reporting paths fail', async () => {
    const original = new Error('synthetic original backend error');
    const fixture = createFixture({
      loadBackendData: async () => { throw original; },
      loggerFailure: new Error('synthetic log error'),
      safeErrorFailure: new Error('synthetic notice error'),
    });
    const error = await fixture.invoke(fixture.trustedEvent).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
    expect((error as Error).cause).toBeUndefined();
    expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(original);
    expect(inspect(error)).not.toContain(original.message);
    expect(fixture.showSafeError).toHaveBeenCalledWith();
    expect(fixture.writeArchive).not.toHaveBeenCalled();
  });

  it('does not let a logger failure change a successful export', async () => {
    const fixture = createFixture({ loggerFailure: new Error('synthetic log error') });
    await expect(fixture.invoke(fixture.trustedEvent)).resolves.toBe('created');
    expect(fixture.writeArchive).toHaveBeenCalledOnce();
    expect(fixture.showSafeError).not.toHaveBeenCalled();
  });

  it('rechecks authority after a reentrant log callback before loading backend data', async () => {
    let fixture!: ReturnType<typeof createFixture>;
    fixture = createFixture({ onEvent: () => fixture.capability.dispose() });
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow('SUPPORT_BUNDLE_CREATION_FAILED');
    expect(fixture.loadBackendData).not.toHaveBeenCalled();
    expect(fixture.writeArchive).not.toHaveBeenCalled();
  });

  it('rejects an accidentally asynchronous authority instead of treating it as a grant', async () => {
    const fixture = createFixture({ assertCurrent: async () => { throw new Error('synthetic late guard'); } });
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(fixture.confirmCreation).not.toHaveBeenCalled();
    expect(fixture.writeArchive).not.toHaveBeenCalled();
  });

  it.each(['backend', 'authority'] as const)(
    'keeps the original %s cause out of the Electron console projection', async (source) => {
      const original = new Error('synthetic private message C:\\private\\secret.dat', {
        cause: new Error('synthetic nested private cause'),
      });
      const fail = () => { throw original; };
      const fixture = createFixture(source === 'backend' ? { loadBackendData: fail } : { assertCurrent: fail });
      const error = await fixture.invoke(fixture.trustedEvent).catch((cause: unknown) => cause);
      expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(original);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(source === 'backend'
        ? 'SUPPORT_BUNDLE_CREATION_FAILED' : 'SUPPORT_BUNDLE_FORBIDDEN');
      expect((error as Error).cause).toBeUndefined();
      expect(Object.getOwnPropertyNames(error)).toEqual(['stack', 'message']);
      expect(inspect(error)).not.toMatch(/synthetic private|secret\.dat|nested private/);
      expect(JSON.stringify(fixture.events)).not.toMatch(/synthetic private|secret\.dat|nested private/);
      expect(fixture.writeArchive).not.toHaveBeenCalled();
    },
  );

  it.each(['throw', 'reject', 'unconnected'] as const)(
    'keeps the safe result when the private observer is %s', async (mode) => {
      const original = new Error('synthetic private cause');
      const observeFailure = mode === 'unconnected' ? null : () => {
        if (mode === 'throw') throw new Error('synthetic observer error');
        return Promise.reject(new Error('synthetic late observer error'));
      };
      const fixture = createFixture({ loadBackendData: async () => { throw original; }, observeFailure });
      const error = await fixture.invoke(fixture.trustedEvent).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
      expect(inspect(error)).not.toMatch(/synthetic private|observer error/);
      expect((error as Error).cause).toBeUndefined();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
    },
  );

  it('rechecks after reentrant data validation before writing the archive', async () => {
    let fixture!: ReturnType<typeof createFixture>;
    const data = createBackendData();
    Object.defineProperty(data, 'backendVersion', { enumerable: true, get() {
      fixture.capability.dispose();
      return '1.2.3';
    } });
    fixture = createFixture({ backendData: data });
    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow('SUPPORT_BUNDLE_CREATION_FAILED');
    expect(fixture.loadBackendData).toHaveBeenCalledOnce();
    expect(fixture.writeArchive).not.toHaveBeenCalled();
  });

  for (const outcome of ['created', 'stale'] as const) {
    it(`verifies real file bytes for a ${outcome} request and retains failed evidence`, async (context) => {
      const root = mkdtempSync(join(tmpdir(), 'eky-support-bundle-'));
      const runtimeRoot = join(root, 'runtime');
      mkdirSync(runtimeRoot);
      const targetPath = join(root, 'support.json.gz');
      const neighborPath = join(root, 'neighbor.txt');
      const previous = Buffer.from('synthetic previous user export');
      const neighbor = Buffer.from('synthetic neighbor must survive');
      writeFileSync(targetPath, previous);
      writeFileSync(neighborPath, neighbor);
      context.onTestFinished(({ task }) => {
        if (task.result?.state === 'pass' && !context.signal.aborted) {
          rmSync(root, { recursive: true, force: true });
        }
      });
      const gate = createGate<unknown>();
      const fixture = createFixture({ runtimeRoot, loadBackendData: gate.wait,
        selectTargetPath: async () => targetPath, writeArchive: writeSupportBundleAtomically });
      const work = fixture.invoke(fixture.trustedEvent);
      const settled = work.catch((cause: unknown) => cause);
      try {
        await gate.entered;
        context.signal.throwIfAborted();
        if (outcome === 'stale') fixture.capability.dispose();
        gate.resolve(createBackendData());
        const result = await settled;
        context.signal.throwIfAborted();
        const bytes = readFileSync(targetPath);
        if (outcome === 'stale') {
          expect(result).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
          expect(bytes.equals(previous)).toBe(true);
          expect(existsSync(join(runtimeRoot, 'support-bundles'))).toBe(false);
        } else {
          expect(result).toBe('created');
          const document = JSON.parse(gunzipSync(bytes).toString('utf8')) as Record<string, unknown>;
          expect(document.manifest).toMatchObject({ supportBundleFormatVersion: 2 });
          expect(document.database).toEqual(createBackendData().database);
          expect(readdirSync(join(runtimeRoot, 'support-bundles', 'temporary'))).toEqual([]);
        }
        expect(readFileSync(neighborPath).equals(neighbor)).toBe(true);
        expect(readdirSync(root).sort()).toEqual(['neighbor.txt', 'runtime', 'support.json.gz']);
      } finally {
        fixture.capability.dispose();
        gate.resolve(createBackendData());
        await settled;
      }
    });
  }
});

function createFixture(
  options: {
    backendData?: unknown;
    confirmed?: boolean;
    assertCurrent?(): void;
    confirmCreation?(): Promise<boolean>;
    loadBackendData?(): Promise<unknown>;
    selectTargetPath?(): Promise<string | null>;
    loggerFailure?: Error;
    onEvent?(): void;
    observeFailure?: ((error: unknown) => void) | null;
    runtimeRoot?: string;
    safeErrorFailure?: Error;
    writeArchive?: typeof writeSupportBundleAtomically;
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
  const webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents });
  let runtimeChanged = false;
  const runtimeFailure = new Error('synthetic runtime generation changed');
  const events: DesktopOperationalEvent[] = [];
  const confirmCreation = vi.fn(options.confirmCreation ?? (async () => options.confirmed ?? true));
  const selectTargetPath = vi.fn(options.selectTargetPath ?? (async () => '/trusted/export/support.json.gz'));
  const loadBackendData = vi.fn(options.loadBackendData ?? (async () =>
    options.backendData === undefined
      ? createBackendData()
      : options.backendData
  ));
  const showSafeError = vi.fn(() => { if (options.safeErrorFailure !== undefined) throw options.safeErrorFailure; });
  const writeArchive = vi.fn(options.writeArchive);
  const observeFailure = vi.fn(options.observeFailure ?? (() => undefined));

  const capability = createSupportBundleCapability({
    appVersion: '1.2.3',
    architecture: 'x64',
    assertCurrent: options.assertCurrent ?? (() => {
      if (runtimeChanged) throw runtimeFailure;
    }),
    confirmCreation,
    ipcMain: { handle, removeHandler: vi.fn() } as never,
    loadBackendData,
    mainWindow: mainWindow as never,
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    operationalIdentity: {
      appVersion: '1.2.3',
      buildRevision: '123456789abc',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    ...(options.observeFailure === null ? {} : { observeFailure }),
    operationalLogger: {
      write(event) {
        options.onEvent?.();
        if (options.loggerFailure !== undefined) throw options.loggerFailure;
        events.push(event);
      },
    },
    platform: 'win32',
    runtimeRoot: options.runtimeRoot ?? '/trusted/runtime',
    selectTargetPath,
    showSafeError,
    writeArchive,
  });

  return {
    capability,
    changeRuntime() { runtimeChanged = true; },
    confirmCreation,
    events,
    invoke(event: unknown, ...args: unknown[]) {
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    loadBackendData,
    mainFrame,
    mainWindow,
    observeFailure,
    runtimeFailure,
    selectTargetPath,
    showSafeError,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
    writeArchive,
    webContents,
  };
}

function createGate<Value>() {
  let resolve!: (value: Value) => void;
  let enter!: () => void;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  const entered = new Promise<void>((complete) => { enter = complete; });
  return { entered, resolve, wait: () => { enter(); return promise; } };
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
    incidentSummaries: [],
    incidentSummariesTruncated: false,
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
