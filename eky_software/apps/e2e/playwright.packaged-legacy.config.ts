import { defineConfig } from '@playwright/test';
import standard from './playwright.config.js';
import { packagedSmokeWorkflowTimeoutMilliseconds } from '../desktop/scripts/packagedSmokeLimits.mjs';

// Explicit hardened package gate; ordinary development E2E selection is unchanged.
// Preparation plus two existing 120-second phases fit within this test budget.
export default defineConfig({
  ...standard,
  retries: 0,
  projects: [{
    name: 'packaged-legacy-recovery',
    testMatch: /packaged\/(legacyInvoiceRecovery|workspaceColdRecovery|workspaceDeletionRecovery)\.spec\.ts/,
    timeout: packagedSmokeWorkflowTimeoutMilliseconds,
  }],
});
