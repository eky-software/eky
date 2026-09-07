import {
  WORKSPACE_SUCCESS_PHASES, WORKSPACE_SUCCESS_SCENARIO, workspaceSuccessErrorCode,
} from './workspaceSuccessContracts.mjs';

function fail(code) { throw new Error(code); }

function present(product) {
  return product.productState >= 1 || product.productName !== null ||
    product.productVersion !== null || product.localPackagePresent;
}

function requireState(state, installed, versions) {
  if (state.ekyProcessCount !== 0 || state.source.ownedRegistryExists !== state.target.ownedRegistryExists) {
    fail('productInspectionFailed');
  }
  for (const role of ['source', 'target']) {
    const product = state[role];
    if (role === installed) {
      if (product.productState < 1 || product.productName !== 'Eky' ||
        product.productVersion !== versions[role] || !product.localPackagePresent ||
        !product.ownedRegistryExists) fail(`${role}StateInvalid`);
    } else if (present(product)) fail(installed === null ? 'preconditionFailed' : `${installed}StateInvalid`);
  }
  if (['installRootExists', 'executableExists', 'shortcutExists', 'installerRegistryExists']
    .some((key) => state[key] !== (installed !== null))) {
    fail(installed === null ? 'preconditionFailed' : `${installed}StateInvalid`);
  }
}

export async function executeWorkspaceSuccessLifecycle(runtime) {
  const completedPhases = [];
  const startedAt = performance.now();
  let failedPhase = WORKSPACE_SUCCESS_PHASES[0];
  let errorCode = null;
  function emit(phase, status, phaseStarted, code) {
    try {
      runtime.reportProgress?.(Object.freeze({
        schemaVersion: 1, operation: 'workspaceSuccessLifecycle',
        scenario: WORKSPACE_SUCCESS_SCENARIO, phase, status,
        durationMs: status === 'started' ? 0 : Math.max(0, Math.round(performance.now() - phaseStarted)),
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(status === 'failed' ? { errorCode: code } : { resultCode: code }),
      }));
    } catch { /* Evidence is not the terminal control protocol. */ }
  }
  async function step(phase, failureCode, task) {
    if (WORKSPACE_SUCCESS_PHASES[completedPhases.length] !== phase) fail('unexpectedFailure');
    failedPhase = phase;
    const start = performance.now();
    emit(phase, 'started', start, 'started');
    try {
      await task();
      completedPhases.push(phase);
      emit(phase, 'completed', start, 'validated');
    } catch (error) {
      const code = workspaceSuccessErrorCode(error, failureCode);
      emit(phase, 'failed', start, code);
      fail(code);
    }
  }
  async function proof(phase, status) {
    const result = await runtime.runProofPhase(phase, status);
    if (result?.formatVersion !== 1 || result.phase !== phase || result.status !== status ||
      Object.keys(result).sort().join(',') !== 'formatVersion,phase,status') fail('proofResultInvalid');
  }
  try {
    await step('preflight', 'preconditionFailed', async () =>
      requireState(await runtime.inspectState(), null, runtime.versions));
    await step('artifactBeforeInstall', 'artifactInvalid', runtime.verifyArtifact);
    await step('sourceInstall', 'sourceInstallFailed', async () => {
      if (await runtime.installSource() !== 0) fail('sourceInstallFailed');
    });
    await step('sourcePostcondition', 'sourceStateInvalid', async () => {
      requireState(await runtime.inspectState(), 'source', runtime.versions);
      await runtime.validatePayload('source');
    });
    await step('profilePreparation', 'profilePreparationFailed', async () => {
      await runtime.prepareProfile();
      await runtime.captureCheckpoint('sourceBaseline');
    });
    await step('sourceHandoff', 'sourceHandoffFailed', () => proof('sourceHandoff', 'completed'));
    await step('targetInstall', 'targetInstallFailed', async () => {
      // The application owns the handoff. This worker must not launch another MSI.
      await runtime.waitForTargetInstallation();
      requireState(await runtime.inspectState(), 'target', runtime.versions);
      await runtime.validatePayload('target');
      await runtime.verifyArtifact();
    });
    await step('targetFirstStart', 'targetFirstStartFailed', async () => {
      await proof('targetFirstStart', 'completed');
      await runtime.verifyProfile('targetFirstStart');
      await runtime.captureCheckpoint('targetFirstStart');
    });
    await step('switchToB', 'switchToBFailed', async () => {
      await proof('switchToB', 'relaunching');
      await runtime.captureCheckpoint('beforeBMigration');
    });
    await step('migrateB', 'migrationBFailed', () => proof('verifyBRestart', 'relaunching'));
    await step('verifyBFirstStart', 'firstStartBFailed', async () => {
      await proof('verifyBRestart', 'completed');
      await runtime.verifyProfile('verifyBRestart');
      await runtime.captureCheckpoint('firstBStartup');
    });
    await step('verifyBRestart', 'restartBFailed', async () => {
      await proof('verifyBRestart', 'completed');
      await runtime.verifyProfile('verifyBRestart');
      await runtime.captureCheckpoint('secondBStartup');
    });
    await step('switchToA', 'switchToAFailed', () => proof('switchToA', 'relaunching'));
    await step('rejectC', 'rejectionCFailed', async () => {
      await proof('rejectC', 'completed');
      await runtime.verifyProfile('rejectC');
      await runtime.captureCheckpoint('rejectedC');
    });
    await step('artifactAfterStartup', 'artifactInvalid', runtime.verifyArtifact);
    failedPhase = null;
  } catch (error) { errorCode = workspaceSuccessErrorCode(error); }
  return Object.freeze({
    schemaVersion: 1, status: errorCode === null ? 'completed' : 'failed',
    resultCode: errorCode === null ? 'workspaceSuccessCompleted' : 'workspaceSuccessFailed',
    errorCode, failedPhase, completedPhases: Object.freeze(completedPhases),
  });
}
