import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type WorkerInfo } from '@playwright/test';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { chromiumWorkerProtocol } from '../../src/environment/chromiumWorkerContract.mjs';
import { connectOwnedChromium, OwnedChromiumStartupFailure } from '../../src/environment/connectOwnedChromium.js';
import { claimChromiumWorker } from '../../src/fixtures/chromiumWorkerAdmission.js';
import { runOwnedChromiumWorker } from '../../src/fixtures/runOwnedChromiumWorker.js';

type Fault = 'close' | 'owner' | 'disconnected' | 'startupVerified' | 'startupUnverified' | 'remove' | 'report';
function fixture(fault?: Fault) {
  const runRoot = createE2eRunRoot();
  const outputDirectory = mkdtempSync(join(tmpdir(), 'eky-chromium-worker-contract-'));
  const reports: object[] = [];
  const marker = join(runRoot, 'synthetic-evidence.txt');
  writeFileSync(marker, 'synthetic evidence');
  const input = { outputDirectory, parallelIndex: 0, globalTimeout: 60_000, workers: 1 };
  const workerInfo = { config: { globalTimeout: 60_000, workers: 1 }, parallelIndex: 0,
    project: { outputDir: outputDirectory, timeout: 10_000 } } as WorkerInfo;
  const bodyFailure = new Error('ORIGINAL_BODY_FAILURE');
  const startupFailure = new OwnedChromiumStartupFailure(fault === 'startupVerified' ? 'stopped' : 'unverified', 'browserConnect');
  const browser = { isConnected: () => fault !== 'disconnected', close: async () => {
    if (fault === 'close') throw new Error('PRIVATE close failure');
  } } as Browser;
  const playwright = { chromium: { executablePath: () => 'synthetic-browser', connect: async () => browser } } as unknown as
    Pick<typeof import('@playwright/test'), 'chromium'>;
  const dependencies = {
    createE2eRunRoot: () => runRoot, claimChromiumWorker,
    removeE2eRunRoot: async (root: string) => {
      if (fault === 'remove') throw new Error('PRIVATE removal failure');
      await removeE2eRunRoot(root);
    },
    startOwnedChromium: async () => {
      if (fault?.startsWith('startup')) throw startupFailure;
      const readyPath = join(runRoot, 'ready.json');
      const generation = 'a'.repeat(64);
      writeFileSync(readyPath, JSON.stringify({ protocol: chromiumWorkerProtocol, schemaVersion: 1,
        generation, endpoint: 'ws://127.0.0.1:45123/' + 'x'.repeat(32) }));
      let stopped = false;
      return connectOwnedChromium({ readyPath, generation, requireStartupOpen() {},
        beforeStartupDeadline: operation => operation, readStartupRemainingMilliseconds: () => 10_000,
        async stop() { if (fault === 'owner') throw new Error('PRIVATE owner failure'); stopped = true; },
        readCleanupRemainingMilliseconds: () => 10_000,
        readCleanupEvidence: () => ({ processTree: stopped ? 'stopped' : 'unverified', firstFailure: null }),
      }, playwright);
    },
    report(record: object) {
      reports.push(record);
      if (fault === 'report') throw new Error('PRIVATE report failure');
    },
  };
  return { runRoot, outputDirectory, marker, reports, bodyFailure, startupFailure,
    pending: () => existsSync(join(outputDirectory, '.eky-chromium-worker-pending.json')),
    claim: () => claimChromiumWorker(input),
    run: (failBody = false) => runOwnedChromiumWorker({ playwright }, async () => {
      if (failBody) throw bodyFailure;
    }, workerInfo, dependencies),
    dispose() {
      // This lower-level test owns only simulated processes and synthetic files.
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(outputDirectory, { recursive: true, force: true });
    },
  };
}

test.describe('SYS-CHROMIUM-WORKER-LIFECYCLE-001 @critical @security', () => {
  for (const fault of ['close', 'owner', 'disconnected', 'startupUnverified', 'remove'] as const) {
    for (const failBody of [false, true]) {
      test(`${fault} retains evidence and refuses replacement with body failure ${failBody}`, async () => {
        const f = fixture(fault);
        try {
          const run = f.run(failBody);
          if (fault === 'startupUnverified') await expect(run).rejects.toBe(f.startupFailure);
          else if (failBody) await expect(run).rejects.toBe(f.bodyFailure);
          else await expect(run).rejects.toThrow('E2E_CHROMIUM_WORKER_CLEANUP_UNVERIFIED');
          expect(existsSync(f.marker)).toBe(true);
          expect(f.pending()).toBe(true);
          expect(f.claim).toThrow('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
          expect(f.reports).toHaveLength(1);
          expect(f.reports[0]).toMatchObject({ cleanup: 'unverified', workerRoot: 'retained' });
          expect(JSON.stringify(f.reports)).not.toContain('PRIVATE');
          expect(JSON.stringify(f.reports)).not.toContain(f.runRoot);
        } finally { f.dispose(); }
      });
    }
  }
  for (const failBody of [false, true]) {
    test(`verified cleanup allows replacement without masking body failure ${failBody}`, async () => {
      const f = fixture();
      try {
        if (failBody) await expect(f.run(true)).rejects.toBe(f.bodyFailure);
        else await f.run();
        expect(f.pending()).toBe(false);
        expect(existsSync(f.runRoot)).toBe(false);
        const next = f.claim();
        next.releaseAfterVerifiedCleanup();
        expect(f.reports[0]).toMatchObject({ cleanup: 'verified', workerRoot: 'removed' });
      } finally { f.dispose(); }
    });
  }
  test('verified startup cleanup releases admission while preserving its original failure', async () => {
    const f = fixture('startupVerified');
    try {
      await expect(f.run()).rejects.toBe(f.startupFailure);
      expect(f.pending()).toBe(false);
      expect(existsSync(f.runRoot)).toBe(false);
      expect(f.reports[0]).toMatchObject({ phase: 'browserConnect', cleanup: 'verified' });
    } finally { f.dispose(); }
  });
  test('diagnostic write failure never replaces the original body error', async () => {
    const f = fixture('report');
    try { await expect(f.run(true)).rejects.toBe(f.bodyFailure); }
    finally { f.dispose(); }
  });
  test('diagnostic write failure cannot turn a clean body into a pass', async () => {
    const f = fixture('report');
    try { await expect(f.run()).rejects.toThrow('E2E_CHROMIUM_WORKER_REPORT_FAILED'); }
    finally { f.dispose(); }
  });
});
