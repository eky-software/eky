import { test as base, type Browser } from '@playwright/test';
import { runOwnedChromiumWorker } from './runOwnedChromiumWorker.js';

interface ChromiumWorkerFixtures { ownedChromiumBrowser: Browser }

export const test = base.extend<{}, ChromiumWorkerFixtures>({
  ownedChromiumBrowser: [async ({ playwright, browserName, headless, channel, launchOptions }, use, workerInfo) => {
    if (browserName !== 'chromium' || headless !== true || channel !== undefined || Object.keys(launchOptions).length !== 0 ||
        process.env.DEBUG || process.env.PWDEBUG || process.env.PW_TEST_REUSE_CONTEXT) {
      throw new Error('E2E_CHROMIUM_OPTIONS_UNSUPPORTED');
    }
    // The Linux adapter additionally requires the approved CI runtime guards.
    if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('E2E_CHROMIUM_PLATFORM_UNSUPPORTED');
    await runOwnedChromiumWorker({ playwright }, use, workerInfo);
  }, { scope: 'worker', auto: true }],
  browser: [async ({ ownedChromiumBrowser }, use) => { await use(ownedChromiumBrowser); }, { scope: 'worker' }],
});
