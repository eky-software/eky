import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { inspectPackageArtifactInventory } from '../../../desktop/scripts/package-artifact-inventory.mjs';
import { runOwnedPackagedSmokeWorkflow } from '../../../desktop/scripts/packagedSmokeJob.mjs';
import { packagedSmokeWorkflowTimeoutMilliseconds } from '../../../desktop/scripts/packagedSmokeLimits.mjs';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';

test('DESK-WORKSPACE-DELETION-PACKAGED-LAST-001 restores, deletes and restarts into the empty selector', async ({}, testInfo) => {
  if (process.platform !== 'win32') throw new Error('WORKSPACE_DELETION_PACKAGED_REQUIRES_WINDOWS');
  const lifetime = createE2eFixtureLifetime(Math.min(testInfo.timeout, packagedSmokeWorkflowTimeoutMilliseconds));
  const inventory = await inspectPackageArtifactInventory({
    root: fileURLToPath(new URL('../../../desktop/out/Eky-win32-x64/', import.meta.url)), stage: 'packagedApp',
  });
  const result = await runOwnedPackagedSmokeWorkflow({ schemaVersion: 1, phase: 'workspaceDeletion',
    runNonce: randomBytes(32).toString('hex'), artifactDescriptorSha256: inventory.identity, startupException: false,
  }, { lifetime, environment: { ...process.env, EKY_E2E: '1', EKY_DESKTOP_SMOKE_TOKEN: randomBytes(16).toString('hex') } });
  expect(result.supervisorResult.status).toBe('completed');
  expect(result.supervisorResult.processTreeAbsent).toBe(true);
  expect(result.diagnostic.status).toBe('verified');
  expect(result.portRelease.status).toBe('verified');
  expect(result.cleanup.status).toBe('verified');
});
