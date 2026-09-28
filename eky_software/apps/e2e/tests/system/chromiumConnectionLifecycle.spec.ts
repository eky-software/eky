import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
import { connectOwnedChromium, OwnedChromiumStartupFailure,
  type ChromiumConnectionOwner } from '../../src/environment/connectOwnedChromium.js';
import { chromiumWorkerProtocol } from '../../src/environment/chromiumWorkerContract.mjs';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eky-chromium-contract-'));
  const generation = 'a'.repeat(64);
  const endpoint = 'ws://127.0.0.1:45123/' + 'x'.repeat(32);
  const readyPath = join(root, 'ready.json');
  writeFileSync(readyPath, JSON.stringify({ protocol: chromiumWorkerProtocol, schemaVersion: 1, generation, endpoint }));
  const calls: string[] = [];
  let stopped = false;
  let remaining = 60_000;
  const owner: ChromiumConnectionOwner = {
    readyPath, generation, requireStartupOpen() {},
    beforeStartupDeadline: operation => operation,
    readStartupRemainingMilliseconds: () => 12_345,
    async stop() { calls.push('ownerStop'); stopped = true; },
    readCleanupRemainingMilliseconds: () => remaining,
    readCleanupEvidence: () => ({ processTree: stopped ? 'stopped' : 'unverified', firstFailure: null }),
  };
  const browser = { isConnected: () => true,
    async close() { calls.push('browserClose'); } } as unknown as Browser;
  const playwright = { chromium: { async connect(actual: string, options: { timeout: number }) {
    calls.push('connect');
    expect(actual).toBe(endpoint);
    expect(options.timeout).toBe(12_345);
    return browser;
  } } } as unknown as Pick<typeof import('@playwright/test'), 'chromium'>;
  return { owner, browser, playwright, calls, root,
    remaining: (value: number) => { remaining = value; },
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test.describe('SYS-CHROMIUM-LIFECYCLE-001 @critical @security', () => {
  test('normal public closure and owner proof occur once under a shared stop promise', async () => {
    const f = fixture();
    try {
      const session = await connectOwnedChromium(f.owner, f.playwright);
      const first = session.stop();
      expect(session.stop()).toBe(first);
      await first;
      expect(f.calls.filter(call => call === 'browserClose')).toHaveLength(1);
      expect(f.calls.filter(call => call === 'ownerStop')).toHaveLength(1);
    } finally { f.dispose(); }
  });
  for (const kind of ['reject', 'throw'] as const) {
    test(`connect ${kind} preserves safe startup classification and verified cleanup`, async () => {
      const f = fixture();
      f.playwright.chromium.connect = (() => {
        if (kind === 'throw') throw new Error('PRIVATE endpoint');
        return Promise.reject(new Error('PRIVATE endpoint'));
      }) as typeof f.playwright.chromium.connect;
      try {
        await expect(connectOwnedChromium(f.owner, f.playwright)).rejects.toMatchObject({
          message: 'E2E_CHROMIUM_START_FAILED', phase: 'browserConnect', processTree: 'stopped',
        });
        expect(f.calls).toEqual(['ownerStop']);
      } finally { f.dispose(); }
    });
  }
  test('malformed ready receipt never reaches public connect', async () => {
    const f = fixture();
    writeFileSync(f.owner.readyPath, '{"private":"SECRET"}');
    try {
      await expect(connectOwnedChromium(f.owner, f.playwright)).rejects.toMatchObject({
        message: 'E2E_CHROMIUM_START_FAILED', phase: 'browserReady', processTree: 'stopped',
      });
      expect(f.calls).toEqual(['ownerStop']);
    } finally { f.dispose(); }
  });
  test('expired startup refuses a new connection instead of resetting its timeout', async () => {
    const f = fixture();
    f.owner.readStartupRemainingMilliseconds = () => 0;
    try {
      await expect(connectOwnedChromium(f.owner, f.playwright)).rejects.toBeInstanceOf(OwnedChromiumStartupFailure);
      expect(f.calls).toEqual(['ownerStop']);
    } finally { f.dispose(); }
  });
  test('timed-out connect waits for late browser closure before declaring cleanup verified', async () => {
    const f = fixture();
    const connection = deferred<Browser>();
    const closing = deferred<void>();
    const closeStarted = deferred<void>();
    f.playwright.chromium.connect = (() => connection.promise) as typeof f.playwright.chromium.connect;
    f.browser.close = async () => { f.calls.push('browserClose'); closeStarted.resolve(); await closing.promise; };
    let phases = 0;
    f.owner.beforeStartupDeadline = async operation => {
      if (++phases === 2) throw new Error('PRIVATE startup timeout');
      return operation;
    };
    const stop = f.owner.stop;
    f.owner.stop = async () => { await stop(); connection.resolve(f.browser); };
    let finished = false;
    const run = connectOwnedChromium(f.owner, f.playwright).catch(error => { finished = true; return error; });
    try {
      await closeStarted.promise;
      expect(finished).toBe(false);
      closing.resolve();
      expect(await run).toMatchObject({ phase: 'browserConnect', processTree: 'stopped' });
      expect(f.calls).toEqual(['ownerStop', 'browserClose']);
    } finally { closing.resolve(); await run; f.dispose(); }
  });
  test('unsettled late connect is unverified and is still closed if it arrives afterward', async () => {
    const f = fixture();
    const connection = deferred<Browser>();
    const closeStarted = deferred<void>();
    f.playwright.chromium.connect = (() => connection.promise) as typeof f.playwright.chromium.connect;
    f.browser.close = async () => { f.calls.push('browserClose'); closeStarted.resolve(); };
    let phases = 0;
    f.owner.beforeStartupDeadline = async operation => {
      if (++phases === 2) throw new Error('TIMEOUT');
      return operation;
    };
    f.remaining(1);
    try {
      await expect(connectOwnedChromium(f.owner, f.playwright)).rejects.toMatchObject({ processTree: 'unverified' });
      connection.resolve(f.browser);
      await closeStarted.promise;
      expect(f.calls).toEqual(['ownerStop', 'browserClose']);
    } finally { connection.resolve(f.browser); f.dispose(); }
  });
  for (const fault of ['closeReject', 'closeThrow', 'closeHangs', 'ownerReject', 'ownerHangs', 'disconnected'] as const) {
    test(`${fault} cannot pass stop or skip the other cleanup operation`, async () => {
      const f = fixture();
      const pending = deferred<void>();
      if (fault.startsWith('close')) f.browser.close = (() => {
        f.calls.push('browserClose');
        if (fault === 'closeThrow') throw new Error('PRIVATE');
        return fault === 'closeHangs' ? pending.promise : Promise.reject(new Error('PRIVATE'));
      }) as typeof f.browser.close;
      if (fault.startsWith('owner')) f.owner.stop = () => {
        f.calls.push('ownerStop');
        return fault === 'ownerHangs' ? pending.promise : Promise.reject(new Error('PRIVATE'));
      };
      if (fault === 'disconnected') f.browser.isConnected = () => false;
      if (fault.endsWith('Hangs')) f.remaining(1);
      try {
        const session = await connectOwnedChromium(f.owner, f.playwright);
        const result = session.stop();
        expect(session.stop()).toBe(result);
        await expect(result).rejects.toThrow(fault === 'disconnected'
          ? 'E2E_CHROMIUM_CONNECTION_LOST' : 'E2E_CHROMIUM_CLEANUP_UNVERIFIED');
        expect(f.calls.filter(call => call === 'ownerStop')).toHaveLength(1);
        expect(f.calls.filter(call => call === 'browserClose')).toHaveLength(1);
      } finally { pending.resolve(); f.dispose(); }
    });
  }
  test('public closure cannot receive a fresh deadline after owner cleanup used it', async () => {
    const f = fixture();
    const stop = f.owner.stop;
    f.owner.stop = async () => { await stop(); f.remaining(0); };
    try {
      const session = await connectOwnedChromium(f.owner, f.playwright);
      await expect(session.stop()).rejects.toThrow('E2E_CHROMIUM_CLEANUP_UNVERIFIED');
      expect(f.calls).toContain('browserClose');
    } finally { f.dispose(); }
  });
  test('disconnection caused by this stop is not misclassified as an earlier connection loss', async () => {
    const f = fixture();
    const stop = f.owner.stop;
    f.owner.stop = async () => {
      f.browser.isConnected = () => false;
      await stop();
    };
    try {
      const session = await connectOwnedChromium(f.owner, f.playwright);
      await expect(session.stop()).resolves.toBeUndefined();
    } finally { f.dispose(); }
  });
});
