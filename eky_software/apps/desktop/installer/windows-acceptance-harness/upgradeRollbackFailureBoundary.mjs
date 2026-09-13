import { areProductProcessesAbsent } from './installerProductOperationRuntime.mjs';

const SCENARIO_ERROR_CODES = Object.freeze({
  artifactVerificationFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_VERIFICATION_FAILED',
  binaryRollbackFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_FAILED',
  binaryRollbackLauncherExitedEarly:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_LAUNCHER_EXITED_EARLY',
  binaryRollbackLauncherFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_LAUNCHER_FAILED',
  binaryRollbackLauncherWaitFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_LAUNCHER_WAIT_FAILED',
  binaryRollbackMsiExecPathInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_MSIEXEC_PATH_INVALID',
  binaryRollbackProcessFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_PROCESS_FAILED',
  binaryRollbackProgressInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_PROGRESS_INVALID',
  binaryRollbackSourceInstallAndTargetRepairFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_SOURCE_AND_REPAIR_FAILED',
  binaryRollbackSourceInstallFailedTargetRestored:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_SOURCE_FAILED_TARGET_RESTORED',
  binaryRollbackSourcePackagePathInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_SOURCE_PATH_INVALID',
  binaryRollbackStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_STATE_INVALID',
  binaryRollbackTargetPackagePathInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_TARGET_PATH_INVALID',
  binaryRollbackTargetUninstallFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_TARGET_UNINSTALL_FAILED',
  binaryRollbackUnexpectedFailure:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_UNEXPECTED_FAILURE',
  downgradeAccepted: 'WINDOWS_ACCEPTANCE_UPGRADE_DOWNGRADE_ACCEPTED',
  downgradeStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_DOWNGRADE_STATE_INVALID',
  finalUninstallFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_FINAL_UNINSTALL_FAILED',
  finalUninstalledStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_FINAL_STATE_INVALID',
  installerEnvironmentInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_ENVIRONMENT_INVALID',
  installerStateInspectionFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_STATE_INSPECTION_FAILED',
  majorUpgradeFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_MAJOR_UPGRADE_FAILED',
  upgradePayloadInvalid: 'WINDOWS_ACCEPTANCE_UPGRADE_PAYLOAD_INVALID',
  runningUpgradeApplicationExitedEarly: 'WINDOWS_ACCEPTANCE_UPGRADE_APPLICATION_EXITED_EARLY',
  runningUpgradeApplicationFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_APPLICATION_FAILED',
  runningUpgradeShutdownFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_APPLICATION_SHUTDOWN_FAILED',
  runningUpgradeMsiFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_RUNNING_MSI_FAILED',
  runningUpgradeValidationInvalid: 'WINDOWS_ACCEPTANCE_UPGRADE_VALIDATION_OBSERVATION_INVALID',
  runningUpgradeBlockedSourceChanged: 'WINDOWS_ACCEPTANCE_UPGRADE_BLOCKED_SOURCE_CHANGED',
  runningUpgradeFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_RUNNING_APPLICATION_FAILED',
  majorUpgradeStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_MAJOR_UPGRADE_STATE_INVALID',
  rollbackBlockerFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_ROLLBACK_BLOCKER_FAILED',
  sourceInstallFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_SOURCE_INSTALL_FAILED',
  sourceInstalledStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_SOURCE_STATE_INVALID',
  unexpectedFailure: 'WINDOWS_ACCEPTANCE_UPGRADE_UNEXPECTED_FAILURE',
  upgradeLifecyclePreconditionFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED',
  windowsInstallerRollbackFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_WINDOWS_ROLLBACK_FAILED',
  windowsInstallerRollbackStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_WINDOWS_ROLLBACK_STATE_INVALID',
});

const SUPERVISOR_ERROR_CODES = Object.freeze({
  deadlineExceeded: 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  processCompleted: 'WINDOWS_ACCEPTANCE_SUPERVISOR_WORKER_RESULT_FAILED',
  processExitFailed: 'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_EXIT_FAILED',
  unexpectedFailure: 'WINDOWS_ACCEPTANCE_SUPERVISOR_UNEXPECTED_FAILURE',
});

export const UPGRADE_COMMAND_ERROR_CODES = Object.freeze([...new Set([
  ...Object.values(SCENARIO_ERROR_CODES), ...Object.values(SUPERVISOR_ERROR_CODES),
  'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_FAILED', 'WINDOWS_ACCEPTANCE_UPGRADE_SCENARIO_FAILED',
  'WINDOWS_ACCEPTANCE_UPGRADE_POSTCONDITION_FAILED', 'WINDOWS_ACCEPTANCE_UPGRADE_RESULT_MISSING_OR_INVALID',
  'WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID', 'WINDOWS_ACCEPTANCE_UPGRADE_TEMP_ROOT_INVALID',
  'WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_INVALID', 'WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED',
  'WINDOWS_ACCEPTANCE_UPGRADE_FIXTURE_CLEANUP_FAILED', 'WINDOWS_ACCEPTANCE_UPGRADE_FINAL_CLEANUP_FAILED',
  'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED',
])]);

export class UpgradeRollbackCommandFailure extends Error {
  constructor(details) {
    super(details.errorCode);
    this.details = Object.freeze({ ...details });
  }
}

function supervisorErrorCode(result) {
  return (
    SUPERVISOR_ERROR_CODES[result.processResultCode] ??
    'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_FAILED'
  );
}

function scenarioErrorCode(result) {
  return (
    SCENARIO_ERROR_CODES[result.errorCode] ??
    'WINDOWS_ACCEPTANCE_UPGRADE_SCENARIO_FAILED'
  );
}

function expectedProductStateResultCode(result) {
  return result.sourcePresent
    ? result.targetPresent
      ? 'multipleProductsPresent'
      : 'sourceProductPresent'
    : result.targetPresent
      ? 'targetProductPresent'
      : result.installerRegistryPresent
        ? 'installerRegistryPresent'
        : 'exactProductsAbsent';
}

async function inspectProducts(verifyExactProductStates) {
  try {
    const result = await verifyExactProductStates();
    if (
      result?.status === 'completed' &&
      typeof result.sourcePresent === 'boolean' &&
      typeof result.targetPresent === 'boolean' &&
      typeof result.installerRegistryPresent === 'boolean' &&
      [
        'exactProductsAbsent',
        'installerRegistryPresent',
        'sourceProductPresent',
        'targetProductPresent',
        'multipleProductsPresent',
      ].includes(result.resultCode) &&
      result.resultCode === expectedProductStateResultCode(result)
    ) {
      return result;
    }
    if (
      result?.status === 'failed' &&
      typeof result.errorCode === 'string' &&
      /^[a-z][A-Za-z0-9]{0,63}$/.test(result.errorCode)
    ) {
      return result;
    }
  } catch {
    // Closed verifier failure below.
  }
  return Object.freeze({
    status: 'failed',
    errorCode: 'productStateVerificationFailed',
  });
}

async function cleanupProducts(cleanupExactProducts) {
  try {
    const result = await cleanupExactProducts();
    if (
      result?.status === 'completed' &&
      result.resultCode === 'semanticCleanupCompleted'
    ) {
      return result;
    }
    if (
      result?.status === 'failed' &&
      typeof result.errorCode === 'string' &&
      /^[a-z][A-Za-z0-9]{0,63}$/.test(result.errorCode)
    ) {
      return result;
    }
  } catch {
    // Closed cleanup failure below.
  }
  return Object.freeze({ status: 'failed', errorCode: 'semanticCleanupFailed' });
}

function failureDetails({
  applicationCleanupResultCode = 'notChecked',
  runningUpgradeInitialExitCode = null,
  runningUpgradeObservation = null,
  errorCode,
  initialProductStateResultCode,
  postconditionResultCode,
  scenarioResultCode,
  semanticCleanupResultCode,
  supervisorResult,
}) {
  return Object.freeze({
    schemaVersion: 1,
    scenario: 'upgradeRollback',
    status: 'failed',
    errorCode,
    supervisorProcessResultCode: supervisorResult.processResultCode,
    supervisorWorkerResultCode: supervisorResult.workerResultCode,
    supervisorCleanupResultCode: supervisorResult.cleanupResultCode,
    processTreeAbsent: supervisorResult.processTreeAbsent,
    applicationCleanupResultCode,
    runningUpgradeInitialExitCode,
    runningUpgradeObservation,
    scenarioResultCode,
    initialProductStateResultCode,
    semanticCleanupResultCode,
    postconditionResultCode,
  });
}

async function prepareRecovery({
  applicationCleanupResultCode = 'notChecked',
  runningUpgradeInitialExitCode = null,
  runningUpgradeObservation = null,
  errorCode,
  initialInspection,
  scenarioResultCode,
  semanticCleanupAllowed = true,
  supervisorResult,
  verifyExactProductStates,
}) {
  if (!supervisorResult.processTreeAbsent) {
    return Object.freeze({ errorCode, scenarioResultCode,
      applicationCleanupResultCode, runningUpgradeInitialExitCode, runningUpgradeObservation,
      initialProductStateResultCode: 'notChecked', postconditionResultCode: 'notChecked',
      semanticCleanupResultCode: 'blockedByOwnedProcessTree', supervisorResult, cleanupAction: 'blocked' });
  }
  const initial =
    initialInspection ?? (await inspectProducts(verifyExactProductStates));
  const initialProductStateResultCode =
    initial.status === 'completed' ? initial.resultCode : initial.errorCode;
  const present = initial.status === 'completed' && initial.resultCode !== 'exactProductsAbsent';
  return Object.freeze({ applicationCleanupResultCode, runningUpgradeInitialExitCode, runningUpgradeObservation,
    errorCode, initialProductStateResultCode, postconditionResultCode: initialProductStateResultCode,
    scenarioResultCode, semanticCleanupResultCode: present && !semanticCleanupAllowed ? 'blockedByPrecondition' : 'notRequired',
    supervisorResult, cleanupAction: present && semanticCleanupAllowed ? 'cleanupThenVerify' : 'notRequired' });
}

export async function prepareUpgradeRollbackTerminalOutcome({
  readScenarioResult,
  supervisorResult,
  verifyExactProductStates: verifyProducts,
  outcome,
}) {
  const verifyExactProductStates = () => outcome && !areProductProcessesAbsent({ outcome })
    ? { status: 'failed', errorCode: 'productStateVerificationProcessRemains' } : verifyProducts();
  if (supervisorResult.status === 'completed') {
    let scenarioResult;
    try { scenarioResult = await readScenarioResult(); }
    catch {
      return Object.freeze({ supervisorResult, errorCode: 'WINDOWS_ACCEPTANCE_UPGRADE_RESULT_MISSING_OR_INVALID',
        scenarioResultCode: 'missingOrInvalid', initialProductStateResultCode: 'notChecked',
        postconditionResultCode: 'notChecked', semanticCleanupResultCode: 'blockedByPrecondition', cleanupAction: 'blocked' });
    }
    if (scenarioResult.status !== 'completed') {
      return prepareRecovery({
        applicationCleanupResultCode: scenarioResult.applicationCleanupResultCode,
        runningUpgradeInitialExitCode: scenarioResult.runningUpgradeInitialExitCode,
        runningUpgradeObservation: scenarioResult.runningUpgradeObservation,
        errorCode: scenarioErrorCode(scenarioResult),
        scenarioResultCode: scenarioResult.resultCode,
        semanticCleanupAllowed:
          scenarioResult.errorCode !== 'upgradeLifecyclePreconditionFailed',
        supervisorResult,
        verifyExactProductStates,
      });
    }
    const postcondition = await inspectProducts(verifyExactProductStates);
    if (
      postcondition.status !== 'completed' ||
      postcondition.resultCode !== 'exactProductsAbsent'
    ) {
      return prepareRecovery({
        errorCode: 'WINDOWS_ACCEPTANCE_UPGRADE_POSTCONDITION_FAILED',
        initialInspection: postcondition,
        runningUpgradeInitialExitCode: scenarioResult.runningUpgradeInitialExitCode,
        runningUpgradeObservation: scenarioResult.runningUpgradeObservation,
        scenarioResultCode: scenarioResult.resultCode,
        supervisorResult,
        verifyExactProductStates,
      });
    }
    return Object.freeze({ supervisorResult, scenarioResult, errorCode: null, cleanupAction: 'notRequired' });
  }

  let errorCode = supervisorErrorCode(supervisorResult);
  let scenarioResultCode = 'notAvailable';
  let applicationCleanupResultCode = 'notChecked';
  let runningUpgradeInitialExitCode = null;
  let runningUpgradeObservation = null;
  let semanticCleanupAllowed = true;
  if (
    supervisorResult.processResultCode === 'processCompleted' &&
    supervisorResult.workerResultCode === 'workerReportedFailure'
  ) {
    try {
      const scenarioResult = await readScenarioResult();
      if (scenarioResult.status === 'failed') {
        errorCode = scenarioErrorCode(scenarioResult);
        scenarioResultCode = scenarioResult.resultCode;
        applicationCleanupResultCode = scenarioResult.applicationCleanupResultCode ?? 'notChecked';
        runningUpgradeInitialExitCode = scenarioResult.runningUpgradeInitialExitCode ?? null;
        runningUpgradeObservation = scenarioResult.runningUpgradeObservation ?? null;
        semanticCleanupAllowed =
          scenarioResult.errorCode !== 'upgradeLifecyclePreconditionFailed';
      }
    } catch {
      scenarioResultCode = 'missingOrInvalid';
    }
  }
  return prepareRecovery({
    applicationCleanupResultCode,
    runningUpgradeInitialExitCode,
    runningUpgradeObservation,
    errorCode,
    scenarioResultCode,
    semanticCleanupAllowed,
    supervisorResult,
    verifyExactProductStates,
  });
}

// This reader consumes completed phase facts; it does not execute cleanup.
export function completeUpgradeRollbackTerminalOutcome(plan, { cleanup, postcondition } = {}) {
  if (plan.errorCode === null) return plan.scenarioResult;
  let { semanticCleanupResultCode, postconditionResultCode } = plan;
  if (plan.cleanupAction === 'cleanupThenVerify') {
    semanticCleanupResultCode = cleanup?.status === 'completed' && cleanup.resultCode === 'semanticCleanupCompleted'
      ? cleanup.resultCode : cleanup?.errorCode ?? 'semanticCleanupFailed';
    postconditionResultCode = postcondition?.status === 'completed' ? postcondition.resultCode
      : postcondition?.errorCode ?? 'productStateVerificationFailed';
    if (semanticCleanupResultCode === 'semanticCleanupCompleted' && postconditionResultCode === 'exactProductsAbsent')
      postconditionResultCode = 'exactProductsAbsentAfterCleanup';
  }
  throw new UpgradeRollbackCommandFailure(failureDetails({ ...plan, semanticCleanupResultCode, postconditionResultCode }));
}

export async function resolveUpgradeRollbackTerminalOutcome(options) {
  const plan = await prepareUpgradeRollbackTerminalOutcome(options);
  let cleanup, postcondition;
  if (plan.cleanupAction === 'cleanupThenVerify') {
    cleanup = await cleanupProducts(options.cleanupExactProducts);
    postcondition = await inspectProducts(() => options.outcome && !areProductProcessesAbsent({ outcome: options.outcome })
      ? { status: 'failed', errorCode: 'productStateVerificationProcessRemains' } : options.verifyExactProductStates());
  }
  return completeUpgradeRollbackTerminalOutcome(plan, { cleanup, postcondition });
}

export function upgradeRollbackFailureDetails(error) {
  return error instanceof UpgradeRollbackCommandFailure ? error.details : null;
}
