const SCENARIO_ERROR_CODES = Object.freeze({
  artifactVerificationFailed:
    'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_VERIFICATION_FAILED',
  binaryRollbackFailed: 'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_FAILED',
  binaryRollbackStateInvalid:
    'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_STATE_INVALID',
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

async function inspectProducts(verifyExactProductStates) {
  try {
    const result = await verifyExactProductStates();
    if (
      result?.status === 'completed' &&
      typeof result.sourcePresent === 'boolean' &&
      typeof result.targetPresent === 'boolean' &&
      [
        'exactProductsAbsent',
        'sourceProductPresent',
        'targetProductPresent',
        'multipleProductsPresent',
      ].includes(result.resultCode)
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
    scenarioResultCode,
    initialProductStateResultCode,
    semanticCleanupResultCode,
    postconditionResultCode,
  });
}

async function recoverAndThrow({
  cleanupExactProducts,
  errorCode,
  initialInspection,
  scenarioResultCode,
  supervisorResult,
  verifyExactProductStates,
}) {
  const initial =
    initialInspection ?? (await inspectProducts(verifyExactProductStates));
  let initialProductStateResultCode =
    initial.status === 'completed' ? initial.resultCode : initial.errorCode;
  let semanticCleanupResultCode = 'notRequired';
  let postconditionResultCode = initialProductStateResultCode;
  if (
    initial.status === 'completed' &&
    initial.resultCode !== 'exactProductsAbsent'
  ) {
    if (!supervisorResult.processTreeAbsent) {
      semanticCleanupResultCode = 'blockedByOwnedProcessTree';
      postconditionResultCode = 'notChecked';
    } else {
      const cleanup = await cleanupProducts(cleanupExactProducts);
      semanticCleanupResultCode =
        cleanup.status === 'completed' ? cleanup.resultCode : cleanup.errorCode;
      const postcondition = await inspectProducts(verifyExactProductStates);
      postconditionResultCode =
        postcondition.status === 'completed'
          ? postcondition.resultCode
          : postcondition.errorCode;
      if (
        cleanup.status === 'completed' &&
        postcondition.status === 'completed' &&
        postcondition.resultCode === 'exactProductsAbsent'
      ) {
        postconditionResultCode = 'exactProductsAbsentAfterCleanup';
      }
    }
  }

  throw new UpgradeRollbackCommandFailure(
    failureDetails({
      errorCode,
      initialProductStateResultCode,
      postconditionResultCode,
      scenarioResultCode,
      semanticCleanupResultCode,
      supervisorResult,
    }),
  );
}

export async function resolveUpgradeRollbackTerminalOutcome({
  cleanupExactProducts,
  readScenarioResult,
  supervisorResult,
  verifyExactProductStates,
}) {
  if (supervisorResult.status === 'completed') {
    const scenarioResult = await readScenarioResult();
    if (scenarioResult.status !== 'completed') {
      await recoverAndThrow({
        cleanupExactProducts,
        errorCode: scenarioErrorCode(scenarioResult),
        scenarioResultCode: scenarioResult.resultCode,
        supervisorResult,
        verifyExactProductStates,
      });
    }
    const postcondition = await inspectProducts(verifyExactProductStates);
    if (
      postcondition.status !== 'completed' ||
      postcondition.resultCode !== 'exactProductsAbsent'
    ) {
      await recoverAndThrow({
        cleanupExactProducts,
        errorCode: 'WINDOWS_ACCEPTANCE_UPGRADE_POSTCONDITION_FAILED',
        initialInspection: postcondition,
        scenarioResultCode: scenarioResult.resultCode,
        supervisorResult,
        verifyExactProductStates,
      });
    }
    return scenarioResult;
  }

  let errorCode = supervisorErrorCode(supervisorResult);
  let scenarioResultCode = 'notAvailable';
  if (
    supervisorResult.processResultCode === 'processCompleted' &&
    supervisorResult.workerResultCode === 'workerReportedFailure'
  ) {
    try {
      const scenarioResult = await readScenarioResult();
      if (scenarioResult.status === 'failed') {
        errorCode = scenarioErrorCode(scenarioResult);
        scenarioResultCode = scenarioResult.resultCode;
      }
    } catch {
      scenarioResultCode = 'missingOrInvalid';
    }
  }
  await recoverAndThrow({
    cleanupExactProducts,
    errorCode,
    scenarioResultCode,
    supervisorResult,
    verifyExactProductStates,
  });
}

export function upgradeRollbackFailureDetails(error) {
  return error instanceof UpgradeRollbackCommandFailure ? error.details : null;
}
