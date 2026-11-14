import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { createSupportBundleIpcChannel } from '../diagnostics/desktopDiagnosticsTypes.js';
import { createDesktopOnlySupportBundleCapability, createDesktopOnlySupportBundleExport } from './supportBundleCapability.js';
import type { SupportBundleDesktopData } from './supportBundleDesktopData.js';
import { writeSupportBundleAtomically } from './supportBundleFileStore.js';

type NativeOptions = Parameters<typeof createDesktopOnlySupportBundleExport>[0];
type WindowOptions = Parameters<typeof createDesktopOnlySupportBundleCapability>[0];
const identity = { appVersion: '1.2.3', buildRevision: '123456789abc', runtimeInstanceId: '11111111-1111-4111-8111-111111111111' };
const modes = ['native', 'window'] as const;

describe('desktop-only support entry owners', () => {
  for (const mode of modes) {
    it(`${mode}: writes the current v3 through the real file owner without backend reads`, async (context) => {
      const files = retainedFiles(context);
      const fixture = createFixture(mode, { runtimeRoot: files.runtimeRoot, selectTargetPath: async () => files.targetPath,
        writeArchive: writeSupportBundleAtomically });
      await expect(fixture.create()).resolves.toBe('created');
      const document = JSON.parse(gunzipSync(readFileSync(files.targetPath)).toString('utf8'));
      expect(document.manifest).toMatchObject({ supportBundleFormatVersion: 3, kind: 'desktopOnly' });
      expect(document.system).toEqual(desktopData().system);
      expect(document.observation).toEqual({ scope: 'currentOperation', status: 'unavailable' });
      expect(fixture.loadDesktopData).toHaveBeenCalledOnce();
      expect(fixture.loadBackendData).not.toHaveBeenCalled();
      expect(readFileSync(files.neighborPath, 'utf8')).toBe('synthetic neighbor');
      expect(readdirSync(join(files.runtimeRoot, 'support-bundles', 'temporary'))).toEqual([]);
      expect(fixture.events).toEqual(['supportBundle.creationStarted', 'supportBundle.creationCompleted']);
      fixture.capability.dispose();
    });

    for (const cancelledAt of ['confirmation', 'target'] as const) {
      it(`${mode}: cancellation at ${cancelledAt} does not load data or write`, async () => {
        const fixture = createFixture(mode, { confirmCreation: async () => cancelledAt !== 'confirmation',
          selectTargetPath: async () => null });
        await expect(fixture.create()).resolves.toBe('cancelled');
        expect(fixture.loadDesktopData).not.toHaveBeenCalled();
        expect(fixture.writeArchive).not.toHaveBeenCalled();
        expect(fixture.events).toEqual([]);
        fixture.capability.dispose();
      });
    }

    it(`${mode}: rejects a revoked owner before showing native dialogs`, async () => {
      const fixture = createFixture(mode);
      fixture.revokeOwner();
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
      expect(fixture.confirmCreation).not.toHaveBeenCalled();
      expect(fixture.loadDesktopData).not.toHaveBeenCalled();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
      expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(fixture.ownerFailure);
      fixture.capability.dispose();
    });

    for (const heldAt of ['confirmation', 'target'] as const) {
      for (const revoke of ['dispose', 'generation'] as const) {
        it(`${mode}: ${revoke} while ${heldAt} waits cannot publish or show stale feedback`, async (context) => {
          const files = retainedFiles(context);
          const gate = deferred();
          const fixture = createFixture(mode, { runtimeRoot: files.runtimeRoot, writeArchive: writeSupportBundleAtomically,
            confirmCreation: async () => { if (heldAt === 'confirmation') await gate.wait(); return true; },
            selectTargetPath: async () => { if (heldAt === 'target') await gate.wait(); return files.targetPath; } });
          const work = fixture.create();
          const settled = work.catch((cause: unknown) => cause);
          try {
            await gate.entered;
            context.signal.throwIfAborted();
            if (revoke === 'dispose') fixture.capability.dispose();
            else fixture.changeGeneration();
            gate.resolve();
            expect(await settled).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
            expect(fixture.loadDesktopData).not.toHaveBeenCalled();
            expect(fixture.showSafeError).not.toHaveBeenCalled();
            expect(fixture.writeArchive).not.toHaveBeenCalled();
            expect(existsSync(files.targetPath)).toBe(false);
            expect(readFileSync(files.neighborPath, 'utf8')).toBe('synthetic neighbor');
          } finally {
            gate.resolve();
            await settled;
            fixture.capability.dispose();
          }
        });
      }
    }

    it(`${mode}: data-provider reentrancy cannot revive a same-looking management state`, async () => {
      let fixture!: ReturnType<typeof createFixture>;
      fixture = createFixture(mode, { loadDesktopData: () => { fixture.changeGeneration(); return desktopData(); } });
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_CREATION_FAILED');
      expect(fixture.writeArchive).not.toHaveBeenCalled();
      expect(fixture.showSafeError).not.toHaveBeenCalled();
      expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(fixture.ownerFailure);
      fixture.capability.dispose();
    });

    for (const mismatch of ['appVersion', 'buildRevision'] as const) {
      it(`${mode}: cannot use an earlier accepted ${mismatch} as the executing identity`, async () => {
        const fixture = createFixture(mode, { loadDesktopData: () => ({ ...desktopData(),
          system: { ...desktopData().system, [mismatch]: mismatch === 'appVersion' ? '1.2.2' : 'abcdef123456' } }) });
        const error = await fixture.create().catch((cause: unknown) => cause);
        expect(error).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
        expect(error).not.toHaveProperty('cause');
        expect(fixture.writeArchive).not.toHaveBeenCalled();
        expect(fixture.showSafeError).toHaveBeenCalledOnce();
        fixture.capability.dispose();
      });
    }

    it(`${mode}: original provider failure stays private despite logger or notice failure`, async () => {
      const original = new Error('synthetic private original', { cause: new Error('synthetic private cause') });
      const fixture = createFixture(mode, { loadDesktopData: () => { throw original; },
        operationalLogger: { write() { throw new Error('synthetic logger failure'); } },
        showSafeError() { throw new Error('synthetic notice failure'); } });
      const error = await fixture.create().catch((cause: unknown) => cause);
      expect(error).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
      expect(error).not.toHaveProperty('cause');
      expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(original);
      expect(fixture.writeArchive).not.toHaveBeenCalled();
      fixture.capability.dispose();
    });

    it(`${mode}: rejected async data is not accepted or left as an unhandled rejection`, async () => {
      const original = new Error('synthetic async provider original');
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const fixture = createFixture(mode, { loadDesktopData: (() => Promise.reject(original)) as never });
      try {
        const result = await fixture.create().catch((cause: unknown) => cause);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(result).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
        expect(result).not.toHaveProperty('cause');
        expect(unhandled).not.toHaveBeenCalled();
        expect(fixture.writeArchive).not.toHaveBeenCalled();
        expect(fixture.loadBackendData).not.toHaveBeenCalled();
      } finally { process.off('unhandledRejection', unhandled); fixture.capability.dispose(); }
    });

    it(`${mode}: never waits for or accepts a pending async data provider`, async () => {
      let resolve!: (value: Readonly<SupportBundleDesktopData>) => void;
      const pending = new Promise<Readonly<SupportBundleDesktopData>>(complete => { resolve = complete; });
      const fixture = createFixture(mode, { loadDesktopData: (() => pending) as never });
      let settled = false;
      const work = fixture.create().then(value => { settled = true; return value; },
        (cause: unknown) => { settled = true; return cause; });
      try {
        await new Promise<void>(complete => setImmediate(complete));
        expect(settled).toBe(true);
        expect(await work).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
        expect(fixture.writeArchive).not.toHaveBeenCalled();
        expect(fixture.loadBackendData).not.toHaveBeenCalled();
      } finally { resolve(desktopData()); await work; fixture.capability.dispose(); }
    });
  }

  it('native grant is consumed by the first request, even while its dialog waits', async () => {
    const gate = deferred();
    const fixture = createFixture('native', { confirmCreation: async () => { await gate.wait(); return true; } });
    const first = fixture.create();
    const settled = first.catch((cause: unknown) => cause);
    try {
      await gate.entered;
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
      gate.resolve();
      expect(await settled).toBe('created');
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
      expect(fixture.confirmCreation).toHaveBeenCalledOnce();
    } finally { gate.resolve(); await settled; fixture.capability.dispose(); }
  });

  it('native cancellation consumes the grant and disposal prevents its first use', async () => {
    const cancelled = createFixture('native', { confirmCreation: async () => false });
    await expect(cancelled.create()).resolves.toBe('cancelled');
    await expect(cancelled.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    cancelled.capability.dispose();
    const disposed = createFixture('native');
    disposed.capability.dispose();
    await expect(disposed.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(disposed.confirmCreation).not.toHaveBeenCalled();
  });

  it('window entry still requires its exact sender, frame, document and argumentless request', async () => {
    const fixture = createFixture('window');
    await expect(fixture.invoke({}, { kind: 'desktopOnly' })).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    await expect(fixture.invoke({ sender: fixture.webContents, senderFrame: {} })).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(fixture.confirmCreation).not.toHaveBeenCalled();
    fixture.capability.dispose();
    await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
  });

  it('window document replacement during a dialog cannot publish into the new document', async () => {
    const gate = deferred();
    const fixture = createFixture('window', { confirmCreation: async () => { await gate.wait(); return true; } });
    const work = fixture.create().catch((cause: unknown) => cause);
    try {
      await gate.entered;
      fixture.webContents.emit('did-start-navigation', { isMainFrame: true });
      gate.resolve();
      expect(await work).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
      expect(fixture.loadDesktopData).not.toHaveBeenCalled();
      expect(fixture.showSafeError).not.toHaveBeenCalled();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
    } finally { gate.resolve(); await work; fixture.capability.dispose(); }
  });

  it('window captures each request before confirmation but does not read cancelled data', async () => {
    const order: string[] = [];
    const request = {
      assertCurrent() { expect(this).toBe(request); },
      loadDesktopData() { order.push('read'); return desktopData(); },
    };
    const fixture = createFixture('window', {
      captureRequest() { order.push('capture'); return request; },
      confirmCreation: async () => { order.push('confirm'); return false; },
    });
    try {
      await expect(fixture.create()).resolves.toBe('cancelled');
      await expect(fixture.create()).resolves.toBe('cancelled');
      expect(order).toEqual(['capture', 'confirm', 'capture', 'confirm']);
      expect(fixture.captureRequest).toHaveBeenCalledTimes(2);
      expect(fixture.selectTargetPath).not.toHaveBeenCalled();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
    } finally { fixture.capability.dispose(); }
  });

  it('window rejects an old generation even after idle returns, but accepts a fresh request', async () => {
    const gate = deferred();
    const fixture = createFixture('window', { confirmCreation: async () => { await gate.wait(); return true; } });
    const first = fixture.create().catch((cause: unknown) => cause);
    try {
      await gate.entered;
      fixture.changeGeneration();
      gate.resolve();
      expect(await first).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
      expect(fixture.loadDesktopData).not.toHaveBeenCalled();
      expect(fixture.showSafeError).not.toHaveBeenCalled();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
      await expect(fixture.create()).resolves.toBe('created');
      expect(fixture.captureRequest).toHaveBeenCalledTimes(2);
      expect(fixture.loadDesktopData).toHaveBeenCalledOnce();
      expect(fixture.writeArchive).toHaveBeenCalledOnce();
    } finally { gate.resolve(); await first; fixture.capability.dispose(); }
  });

  it('window does not capture an unauthorized or concurrently rejected request', async () => {
    const gate = deferred();
    const fixture = createFixture('window', { confirmCreation: async () => { await gate.wait(); return true; } });
    await expect(fixture.invoke({})).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
    expect(fixture.captureRequest).not.toHaveBeenCalled();
    const first = fixture.create().catch((cause: unknown) => cause);
    try {
      await gate.entered;
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_CREATION_IN_PROGRESS');
      expect(fixture.captureRequest).toHaveBeenCalledOnce();
      gate.resolve();
      expect(await first).toBe('created');
    } finally { gate.resolve(); await first; fixture.capability.dispose(); }
  });

  it('window keeps a capture failure private and releases request admission', async () => {
    const original = new Error('synthetic private capture failure', { cause: new Error('synthetic capture cause') });
    const captureRequest = vi.fn<WindowOptions['captureRequest']>()
      .mockImplementationOnce(() => { throw original; })
      .mockReturnValue({ assertCurrent() {}, loadDesktopData: desktopData });
    const fixture = createFixture('window', { captureRequest });
    try {
      const error = await fixture.create().catch((cause: unknown) => cause);
      expect(error).toMatchObject({ message: 'SUPPORT_BUNDLE_FORBIDDEN' });
      expect(error).not.toHaveProperty('cause');
      expect(fixture.observeFailure).toHaveBeenCalledExactlyOnceWith(original);
      expect(fixture.confirmCreation).not.toHaveBeenCalled();
      expect(fixture.showSafeError).not.toHaveBeenCalled();
      await expect(fixture.create()).resolves.toBe('created');
      expect(fixture.writeArchive).toHaveBeenCalledOnce();
    } finally { fixture.capability.dispose(); }
  });

  it('window cannot confirm after reentrant capture invalidates its document', async () => {
    let fixture!: ReturnType<typeof createFixture>;
    fixture = createFixture('window', { captureRequest() {
      fixture.webContents.emit('did-start-loading');
      return { assertCurrent() {}, loadDesktopData: desktopData };
    } });
    try {
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
      expect(fixture.confirmCreation).not.toHaveBeenCalled();
      expect(fixture.loadDesktopData).not.toHaveBeenCalled();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
    } finally { fixture.capability.dispose(); }
  });

  it('window drains an accidental async capture without awaiting or accepting it', async () => {
    const original = new Error('synthetic asynchronous capture');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const fixture = createFixture('window', { captureRequest: (() => Promise.reject(original)) as never });
    try {
      await expect(fixture.create()).rejects.toThrow('SUPPORT_BUNDLE_FORBIDDEN');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(fixture.confirmCreation).not.toHaveBeenCalled();
      expect(fixture.loadDesktopData).not.toHaveBeenCalled();
      expect(fixture.writeArchive).not.toHaveBeenCalled();
    } finally { process.off('unhandledRejection', unhandled); fixture.capability.dispose(); }
  });
});

function createFixture(mode: typeof modes[number], overrides: Partial<NativeOptions> &
  Pick<Partial<WindowOptions>, 'captureRequest'> = {}) {
  let generation = 0;
  let revoked = false;
  const ownerGeneration = generation;
  const ownerFailure = new Error('synthetic management generation revoked');
  const events: string[] = [];
  const confirmCreation = vi.fn(overrides.confirmCreation ?? (async () => true));
  const selectTargetPath = vi.fn(overrides.selectTargetPath ?? (async () => '/synthetic/export.json.gz'));
  const loadDesktopData = vi.fn(overrides.loadDesktopData ?? desktopData);
  const loadBackendData = vi.fn(() => { throw new Error('BACKEND_MUST_NOT_BE_READ'); });
  const writeArchive = vi.fn(overrides.writeArchive ?? (() => undefined));
  const observeFailure = vi.fn(overrides.observeFailure ?? (() => undefined));
  const showSafeError = vi.fn(overrides.showSafeError ?? (() => undefined));
  const options: NativeOptions & { loadBackendData: typeof loadBackendData } = {
    assertCurrent() { if (revoked || generation !== ownerGeneration) throw ownerFailure; },
    confirmCreation, selectTargetPath, loadDesktopData, loadBackendData, writeArchive, observeFailure, showSafeError,
    now: () => new Date('2026-11-06T10:00:00.000Z'), runtimeRoot: overrides.runtimeRoot ?? '/synthetic/runtime',
    operationalIdentity: identity, operationalLogger: overrides.operationalLogger ?? { write(event) { events.push(event.eventName); } },
  };
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: {} });
  const mainWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents });
  const captureRequest = vi.fn(overrides.captureRequest ?? (() => {
    const selectedGeneration = generation;
    return Object.freeze({
      assertCurrent() { if (generation !== selectedGeneration) throw ownerFailure; },
      loadDesktopData,
    });
  }));
  let invoke!: (event: unknown, ...args: unknown[]) => Promise<unknown>;
  let create: () => Promise<unknown>;
  let capability;
  if (mode === 'native') {
    capability = createDesktopOnlySupportBundleExport(options);
    create = capability.create;
  } else {
    capability = createDesktopOnlySupportBundleCapability({ ...options, mainWindow: mainWindow as never,
      assertCurrent() { if (revoked) throw ownerFailure; }, captureRequest,
      ipcMain: { handle(channel, handler) {
        expect(channel).toBe(createSupportBundleIpcChannel);
        invoke = handler as never;
      }, removeHandler: vi.fn() } });
    create = () => invoke({ sender: webContents, senderFrame: webContents.mainFrame });
  }
  return { capability, create, invoke: (event: unknown, ...args: unknown[]) => invoke(event, ...args), webContents,
    changeGeneration() { generation += 1; }, revokeOwner() { revoked = true; }, captureRequest,
    ownerFailure, events, confirmCreation, selectTargetPath,
    loadDesktopData, loadBackendData, writeArchive, observeFailure, showSafeError };
}

function desktopData(): Readonly<SupportBundleDesktopData> {
  return { system: { appVersion: identity.appVersion, buildRevision: identity.buildRevision,
    architecture: 'x64', platform: 'win32', electronVersion: '43.8.1' },
  availability: { backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
  observation: { scope: 'currentOperation', status: 'unavailable' } };
}

function deferred() {
  let enter!: () => void;
  let resolve!: () => void;
  const entered = new Promise<void>(done => { enter = done; });
  const promise = new Promise<void>(done => { resolve = done; });
  return { entered, resolve, wait() { enter(); return promise; } };
}

function retainedFiles(context: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'eky-support-bundle-'));
  context.onTestFinished(({ task }) => {
    if (task.result?.state === 'pass' && !context.signal.aborted) rmSync(root, { recursive: true, force: true });
  });
  const runtimeRoot = join(root, 'runtime');
  mkdirSync(runtimeRoot);
  const neighborPath = join(root, 'neighbor.txt');
  writeFileSync(neighborPath, 'synthetic neighbor');
  return { runtimeRoot, targetPath: join(root, 'support.json.gz'), neighborPath };
}
