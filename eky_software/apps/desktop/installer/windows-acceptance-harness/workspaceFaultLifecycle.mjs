import {
  WORKSPACE_FAULT_SCENARIO, workspaceFaultErrorCode, workspaceFaultPlan,
} from './workspaceFaultContracts.mjs';
import { requireWorkspaceInstalledState } from './workspaceInstalledState.mjs';
import { hasWorkspaceSuccessExactKeys } from './workspaceSuccessContracts.mjs';

export async function executeWorkspaceFaultLifecycle(faultScenario, runtime) {
  const plan = workspaceFaultPlan(faultScenario);
  const completedPhases = [];
  const startedAt = performance.now();
  let failedPhase = plan.phases[0];
  let errorCode = null;
  function report(phase, status, phaseStarted, code) {
    try {
      runtime.reportProgress?.(Object.freeze({
        schemaVersion: 1, operation: 'workspaceFaultLifecycle', scenario: WORKSPACE_FAULT_SCENARIO,
        faultScenario, phase, status,
        durationMs: status === 'started' ? 0 : Math.max(0, Math.round(performance.now() - phaseStarted)),
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(status === 'failed' ? { errorCode: code } : { resultCode: code }),
      }));
    } catch { /* Progress is not the terminal result protocol. */ }
  }
  async function step(phase, fallback, task) {
    if (plan.phases[completedPhases.length] !== phase) throw new Error('unexpectedFailure');
    failedPhase = phase;
    const start = performance.now();
    report(phase, 'started', start, 'started');
    try {
      await task();
      completedPhases.push(phase);
      report(phase, 'completed', start, 'validated');
    } catch (error) {
      const code = workspaceFaultErrorCode(error, fallback);
      report(phase, 'failed', start, code);
      throw new Error(code);
    }
  }
  async function installed(role) {
    requireWorkspaceInstalledState(await runtime.inspectState(), role, runtime.versions);
    await runtime.validatePayload(role);
  }
  async function proof(phase, status) {
    await step(phase, phase === 'sourceHandoff' ? 'sourceHandoffFailed' : 'faultProofFailed', async () => {
      const result = await runtime.runProofPhase(phase, status);
      if (!hasWorkspaceSuccessExactKeys(result, ['formatVersion', 'faultScenario', 'phase', 'status']) ||
        result.formatVersion !== 2 || result.faultScenario !== faultScenario ||
        result.phase !== phase || result.status !== status) throw new Error('proofResultInvalid');
    });
  }
  try {
    await step('preflight', 'preconditionFailed', async () =>
      requireWorkspaceInstalledState(await runtime.inspectState(), null, runtime.versions));
    await step('artifactBeforeInstall', 'artifactInvalid', runtime.verifyArtifact);
    await step('sourceInstall', 'sourceInstallFailed', async () => {
      if (await runtime.installSource() !== 0) throw new Error('sourceInstallFailed');
    });
    await step('sourcePostcondition', 'sourceStateInvalid', () => installed('source'));
    await step('profilePreparation', 'profilePreparationFailed', async () => {
      await runtime.prepareProfile();
      await runtime.captureCheckpoint('sourceBaseline');
    });
    await proof('sourceHandoff', 'completed');
    if (faultScenario !== 'preUpdateRecoveryPointFailure') {
      await step('targetInstall', 'targetInstallFailed', async () => {
        // Main owns both upgrade and rollback handoffs. The worker only observes.
        await runtime.waitForInstallation('target');
        await installed('target');
        await runtime.verifyArtifact();
      });
    }
    switch (faultScenario) {
      case 'preUpdateRecoveryPointFailure': break;
      case 'activeWorkspaceFirstStartFailure':
        await proof('targetFirstStartFailure', 'relaunching');
        await proof('businessRollback', 'relaunching');
        await step('sourceRollbackInstall', 'sourceRollbackInstallFailed', async () => {
          await runtime.waitForInstallation('source');
          await installed('source');
          await runtime.verifyArtifact();
        });
        await proof('rollbackFirstStart', 'completed');
        break;
      case 'acceptanceInterruption':
        await proof('targetAcceptanceInterruption', 'interrupted');
        await proof('targetAcceptanceRecovery', 'relaunching');
        await proof('targetAcceptanceRestart', 'completed');
        break;
      case 'passiveWorkspaceMigrationFailure':
        await proof('targetFirstStart', 'completed');
        await proof('switchToB', 'relaunching');
        await proof('passiveWorkspaceMigrationFailure', 'relaunching');
        await proof('passiveWorkspaceRecovery', 'completed');
        break;
      case 'binaryRollbackFailure':
        await proof('targetFirstStartFailure', 'relaunching');
        await proof('binaryRollbackFailure', 'completed');
        await proof('failedSafeVerification', 'completed');
        break;
    }
    await step('installedPostcondition', `${plan.installedRole}StateInvalid`, () => installed(plan.installedRole));
    await step('profileCheckpoint', 'profileEvidenceInvalid', () => runtime.captureCheckpoint('faultTerminal'));
    await step('artifactAfterFault', 'artifactInvalid', runtime.verifyArtifact);
    failedPhase = null;
  } catch (error) { errorCode = workspaceFaultErrorCode(error); }
  return Object.freeze({ schemaVersion: 1, status: errorCode === null ? 'completed' : 'failed',
    resultCode: errorCode === null ? 'workspaceFaultCompleted' : 'workspaceFaultFailed',
    errorCode, failedPhase, completedPhases: Object.freeze(completedPhases) });
}
