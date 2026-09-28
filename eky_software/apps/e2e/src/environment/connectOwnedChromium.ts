import { lstatSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { Browser } from '@playwright/test';
import { chromiumControlMaximumBytes, requireChromiumReady } from './chromiumWorkerContract.mjs';

export interface StartedOwnedChromium {
  readonly browser: Browser;
  stop(): Promise<void>;
}

export interface ChromiumConnectionOwner {
  readonly readyPath: string;
  readonly generation: string;
  requireStartupOpen(): void;
  beforeStartupDeadline<T>(operation: Promise<T>): Promise<T>;
  readStartupRemainingMilliseconds(): number;
  stop(): Promise<void>;
  readCleanupRemainingMilliseconds(): number;
  readCleanupEvidence(): { processTree: 'stopped' | 'unverified'; firstFailure: string | null };
}

export class OwnedChromiumStartupFailure extends Error {
  constructor(readonly processTree: 'stopped' | 'unverified',
    readonly phase: 'ownerPreparation' | 'ownerLaunch' | 'browserReady' | 'browserConnect',
    readonly ownerFailure: string | null = null,
  ) { super('E2E_CHROMIUM_START_FAILED'); }
}

async function beforeCleanup<T>(operation: Promise<T>, owner: ChromiumConnectionOwner): Promise<T> {
  void operation.catch(() => {});
  const remaining = owner.readCleanupRemainingMilliseconds();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('E2E_CHROMIUM_CLEANUP_UNVERIFIED');
  const controller = new AbortController();
  try {
    const value = await Promise.race([operation,
      delay(Math.min(remaining, 2_147_483_647), undefined, { signal: controller.signal })
        .then(() => { throw new Error('E2E_CHROMIUM_CLEANUP_UNVERIFIED'); })]);
    if (owner.readCleanupRemainingMilliseconds() <= 0) throw new Error('E2E_CHROMIUM_CLEANUP_UNVERIFIED');
    return value;
  } finally { controller.abort(); }
}

export async function connectOwnedChromium(owner: ChromiumConnectionOwner,
  playwright: Pick<typeof import('@playwright/test'), 'chromium'>,
): Promise<StartedOwnedChromium> {
  let phase: OwnedChromiumStartupFailure['phase'] = 'browserReady';
  let admissionClosed = false;
  let connection: Promise<Browser> | undefined;
  let connectedBrowser: Browser | undefined;
  let cleanupResult: Promise<{ verified: boolean; ownerFailed: boolean; wasConnected: boolean }> | undefined;
  const cleanup = () => {
    admissionClosed = true;
    cleanupResult ??= (async () => {
      // Capture this before owner.stop can intentionally disconnect the client.
      const wasConnected = connectedBrowser?.isConnected() ?? true;
      // Observe a late connection through its actual close, not just a queued
      // callback. Its closure shares the owner's original cleanup deadline.
      const closed = connection?.then(async browser => {
        await browser.close();
      }, () => {}) ?? Promise.resolve();
      void closed.catch(() => {});
      let ownerFailed = false;
      try { await beforeCleanup(owner.stop(), owner); } catch { ownerFailed = true; }
      let connectionClosed = false;
      try { await beforeCleanup(closed, owner); connectionClosed = true; } catch { /* Retain the root. */ }
      return { verified: connectionClosed && owner.readCleanupEvidence().processTree === 'stopped',
        ownerFailed, wasConnected };
    })();
    return cleanupResult;
  };
  try {
    const endpoint = await owner.beforeStartupDeadline((async () => {
      for (;;) {
        if (admissionClosed) throw new Error('E2E_CHROMIUM_START_FAILED');
        owner.requireStartupOpen();
        try {
          const stat = lstatSync(owner.readyPath);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > chromiumControlMaximumBytes) {
            throw new Error('E2E_CHROMIUM_READY_INVALID');
          }
          return requireChromiumReady(JSON.parse(readFileSync(owner.readyPath, 'utf8')), owner.generation);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
        await delay(20);
      }
    })());
    phase = 'browserConnect';
    owner.requireStartupOpen();
    const remaining = owner.readStartupRemainingMilliseconds();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('E2E_CHROMIUM_START_FAILED');
    // The automatic worker fixture calls this before per-test trace recording.
    connection = playwright.chromium.connect(endpoint, { timeout: Math.max(1, Math.floor(remaining)) });
    const browser = await owner.beforeStartupDeadline(connection);
    connectedBrowser = browser;
    let stopResult: Promise<void> | undefined;
    return { browser, stop() {
      stopResult ??= cleanup().then(result => {
        if (!result.verified || result.ownerFailed) throw new Error('E2E_CHROMIUM_CLEANUP_UNVERIFIED');
        if (!result.wasConnected) throw new Error('E2E_CHROMIUM_CONNECTION_LOST');
      });
      return stopResult;
    } };
  } catch {
    const result = await cleanup();
    throw new OwnedChromiumStartupFailure(result.verified ? 'stopped' : 'unverified', phase,
      owner.readCleanupEvidence().firstFailure);
  }
}
