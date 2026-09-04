import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_UPGRADE_SCENARIO,
  createLegacyUpgradeWorkerRequest,
  validateLegacyUpgradeResult,
  validateLegacyUpgradeWorkerRequest,
} from './legacyUpgradeContracts.mjs';

const request = createLegacyUpgradeWorkerRequest({
  artifactDescriptorSha256: 'a'.repeat(64),
  fixtureRoot: 'C:\\temp\\legacy-fixture',
  runNonce: 'b'.repeat(64),
});

function completedResult(overrides = {}) {
  return {
    schemaVersion: 1,
    runNonce: request.runNonce,
    scenario: LEGACY_UPGRADE_SCENARIO,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: 'completed',
    resultCode: 'historicalLegacyUpgradeCompleted',
    errorCode: null,
    sourceInstallExitCode: 0,
    upgradeExitCode: 0,
    sourceStateValidated: true,
    sourceNormalStartupValidated: true,
    sourcePackagedSmokeValidated: true,
    legacyBusinessFixtureValidated: true,
    majorUpgradeValidated: true,
    targetFirstStartupValidated: true,
    targetSecondStartupValidated: true,
    artifactBytesValidated: true,
    ...overrides,
  };
}

test('legacy request is strict and bound to an absolute fixture root', () => {
  assert.equal(request.scenario, LEGACY_UPGRADE_SCENARIO);
  assert.throws(
    () => validateLegacyUpgradeWorkerRequest({ ...request, extra: true }),
    /WINDOWS_ACCEPTANCE_LEGACY_REQUEST_INVALID/,
  );
  assert.throws(
    () =>
      validateLegacyUpgradeWorkerRequest({
        ...request,
        fixtureRoot: 'relative',
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_REQUEST_INVALID/,
  );
});

test('legacy success requires every historical and target proof', () => {
  assert.equal(validateLegacyUpgradeResult(completedResult(), request).status, 'completed');
  assert.throws(
    () =>
      validateLegacyUpgradeResult(
        completedResult({ sourceNormalStartupValidated: false }),
        request,
      ),
    /WINDOWS_ACCEPTANCE_LEGACY_RESULT_INVALID/,
  );
});

test('legacy failure remains a strict safe result', () => {
  const failed = completedResult({
    status: 'failed',
    resultCode: 'historicalLegacyUpgradeFailed',
    errorCode: 'targetFirstStartupFailed',
    targetFirstStartupValidated: false,
  });
  assert.equal(validateLegacyUpgradeResult(failed, request).errorCode, 'targetFirstStartupFailed');
  assert.throws(
    () => validateLegacyUpgradeResult({ ...failed, errorCode: 'PATH C:\\secret' }, request),
    /WINDOWS_ACCEPTANCE_LEGACY_RESULT_INVALID/,
  );
});
