import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { inspectPackagedPilotSeries, requirePackagedSeriesPin } from '../../../desktop/scripts/packagedPilotSeries.mjs';
import { runOwnedPackagedSmokeWorkflow } from '../../../desktop/scripts/packagedSmokeJob.mjs';
import { packagedSmokeWorkflowTimeoutMilliseconds } from '../../../desktop/scripts/packagedSmokeLimits.mjs';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';

test('DESK-WORKSPACE-DELETION-PACKAGED-LAST-001 restores, deletes and restarts into the empty selector', async ({}, testInfo) => {
  if (process.platform !== 'win32') throw new Error('WORKSPACE_DELETION_PACKAGED_REQUIRES_WINDOWS');
  const lifetime = createE2eFixtureLifetime(Math.min(testInfo.timeout, packagedSmokeWorkflowTimeoutMilliseconds));
  const selected = await inspectPackagedPilotSeries(requirePackagedSeriesPin(), {
    assertCurrent() { if (lifetime.readRemainingWorkMilliseconds() <= 0) throw new Error('PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED'); },
  });
  const result = await runOwnedPackagedSmokeWorkflow({ schemaVersion: 1, phase: 'workspaceDeletion',
    runNonce: randomBytes(32).toString('hex'), artifactDescriptorSha256: selected.manifest.inventoryIdentity, startupException: false,
  }, { lifetime, environment: { ...process.env, EKY_E2E: '1', EKY_DESKTOP_SMOKE_TOKEN: randomBytes(16).toString('hex') } });
  expect(result.supervisorResult.status).toBe('completed');
  expect(result.supervisorResult.processTreeAbsent).toBe(true);
  expect(result.diagnostic.status).toBe('verified');
  expect(result.portRelease.status).toBe('verified');
  expect(result.cleanup.status).toBe('verified');
});
