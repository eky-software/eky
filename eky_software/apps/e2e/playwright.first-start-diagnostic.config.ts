import { defineConfig } from '@playwright/test';
import standard from './playwright.config.js';
import { ELECTRON_E2E_TEST_TIMEOUT_MILLISECONDS } from './src/fixtures/electronLaunchBudgets.js';

// Explicit diagnostic only. Ordinary CI and acceptance selection are unchanged.
export default defineConfig({
  ...standard,
  projects: [{
    name: 'first-start-load-diagnostic',
    testMatch: /diagnostics\/firstStartLoadOrder\.spec\.ts/,
    timeout: ELECTRON_E2E_TEST_TIMEOUT_MILLISECONDS,
  }],
});
