import { resolve } from 'node:path';
import type { Browser, WorkerInfo } from '@playwright/test';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../environment/removeE2eRunRoot.js';
import { OwnedChromiumStartupFailure, type StartedOwnedChromium } from '../environment/connectOwnedChromium.js';
import { startOwnedWindowsChromium } from '../environment/startOwnedWindowsChromium.js';
import { startOwnedLinuxChromium } from '../environment/startOwnedLinuxChromium.js';
import { claimChromiumWorker } from './chromiumWorkerAdmission.js';

const defaults = { createE2eRunRoot, removeE2eRunRoot, claimChromiumWorker,
  startOwnedChromium: process.platform === 'win32' ? startOwnedWindowsChromium : startOwnedLinuxChromium,
  report: (record: object) => { process.stdout.write(JSON.stringify(record) + '\n'); } };

export async function runOwnedChromiumWorker(input: {
  playwright: Pick<typeof import('@playwright/test'), 'chromium'>;
}, use: (browser: Browser) => Promise<void>, workerInfo: WorkerInfo, dependencies = defaults): Promise<void> {
  const admission = dependencies.claimChromiumWorker({ outputDirectory: workerInfo.project.outputDir,
    parallelIndex: workerInfo.parallelIndex, globalTimeout: workerInfo.config.globalTimeout,
    workers: workerInfo.config.workers });
  let runRoot: string | undefined;
  let owned: StartedOwnedChromium | undefined;
  let cleanupVerified = true;
  let rootRemoved = false;
  let failure: { error: unknown } | undefined;
  try {
    runRoot = dependencies.createE2eRunRoot();
    const startupDeadline = performance.now() + Math.min(workerInfo.project.timeout,
      admission.lifetime.readRemainingWorkMilliseconds());
    cleanupVerified = false;
    try {
      owned = await dependencies.startOwnedChromium({ repositoryRoot: resolve(import.meta.dirname, '../../../..'),
        runRoot, lifetime: admission.lifetime, startupDeadline, redactedValues: [],
        browserExecutable: input.playwright.chromium.executablePath() }, input.playwright);
    } catch (error) {
      cleanupVerified = error instanceof OwnedChromiumStartupFailure && error.processTree === 'stopped';
      throw error;
    }
    await use(owned.browser);
  } catch (error) { failure = { error }; }
  finally {
    if (owned !== undefined) {
      try { await owned.stop(); cleanupVerified = true; }
      catch { cleanupVerified = false; }
    }
    if (cleanupVerified) {
      try {
        if (runRoot !== undefined) { await dependencies.removeE2eRunRoot(runRoot); rootRemoved = true; }
        admission.releaseAfterVerifiedCleanup();
      } catch { cleanupVerified = false; }
    }
    const startupFailure = failure?.error instanceof OwnedChromiumStartupFailure ? failure.error : undefined;
    let reportingFailed = false;
    try {
      dependencies.report({ schemaVersion: 1, operation: 'chromiumWorker',
        phase: startupFailure?.phase ?? 'workerTeardown', ownerFailure: startupFailure?.ownerFailure ?? null,
        cleanup: cleanupVerified ? 'verified' : 'unverified',
        workerRoot: rootRemoved ? 'removed' : runRoot === undefined ? 'notCreated' : 'retained' });
    } catch { reportingFailed = true; }
    if (failure !== undefined) throw failure.error;
    if (!cleanupVerified) throw new Error('E2E_CHROMIUM_WORKER_CLEANUP_UNVERIFIED');
    if (reportingFailed) throw new Error('E2E_CHROMIUM_WORKER_REPORT_FAILED');
  }
}
