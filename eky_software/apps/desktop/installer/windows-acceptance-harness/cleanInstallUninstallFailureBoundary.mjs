const SCENARIO_ERROR_CODES = Object.freeze({
  cleanInstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_INSTALL_FAILED',
  cleanInstalledStateInvalid:
    'WINDOWS_ACCEPTANCE_CLEAN_INSTALLED_STATE_INVALID',
  cleanLifecyclePreconditionFailed:
    'WINDOWS_ACCEPTANCE_CLEAN_PRECONDITION_FAILED',
  cleanUninstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALL_FAILED',
  cleanUninstalledStateInvalid:
    'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALLED_STATE_INVALID',
  cleanPayloadInvalid: 'WINDOWS_ACCEPTANCE_CLEAN_PAYLOAD_INVALID',
  cleanProfileChanged: 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED',
  cleanRepairFailed: 'WINDOWS_ACCEPTANCE_CLEAN_REPAIR_FAILED',
  cleanRepairPreparationFailed: 'WINDOWS_ACCEPTANCE_CLEAN_REPAIR_PREPARATION_FAILED',
  cleanReinstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_REINSTALL_FAILED',
  fixtureVerificationFailed:
    'WINDOWS_ACCEPTANCE_CLEAN_FIXTURE_VERIFICATION_FAILED',
  installerStateInspectionFailed:
    'WINDOWS_ACCEPTANCE_CLEAN_STATE_INSPECTION_FAILED',
  unexpectedFailure: 'WINDOWS_ACCEPTANCE_CLEAN_UNEXPECTED_FAILURE',
});

const SUPERVISOR_ERROR_CODES = Object.freeze({
  deadlineExceeded: 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  processCompleted: 'WINDOWS_ACCEPTANCE_SUPERVISOR_WORKER_RESULT_FAILED',
  processExitFailed: 'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_EXIT_FAILED',
  unexpectedFailure: 'WINDOWS_ACCEPTANCE_SUPERVISOR_UNEXPECTED_FAILURE',
});

export const CLEAN_COMMAND_ERROR_CODES = Object.freeze([...new Set([
  ...Object.values(SCENARIO_ERROR_CODES), ...Object.values(SUPERVISOR_ERROR_CODES),
  'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_FAILED', 'WINDOWS_ACCEPTANCE_CLEAN_SCENARIO_FAILED',
  'WINDOWS_ACCEPTANCE_CLEAN_RESULT_MISSING_OR_INVALID', 'WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID',
  'WINDOWS_ACCEPTANCE_CLEAN_TEMP_ROOT_INVALID', 'WINDOWS_ACCEPTANCE_CLEAN_ENVIRONMENT_INVALID',
  'WINDOWS_ACCEPTANCE_CLEAN_FINAL_CLEANUP_FAILED', 'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED',
  'WINDOWS_ACCEPTANCE_FIXTURE_CLEANUP_FAILED', 'WINDOWS_ACCEPTANCE_CLEAN_ARTIFACT_VERIFICATION_FAILED',
])]);

export class CleanInstallUninstallCommandFailure extends Error {
  constructor(details) {
    super(details.errorCode);
    this.details = Object.freeze({ ...details });
  }
}

function supervisorErrorCode(supervisorResult) {
  return (
    SUPERVISOR_ERROR_CODES[supervisorResult.processResultCode] ??
    'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_FAILED'
  );
}

function scenarioErrorCode(scenarioResult) {
  return (
    SCENARIO_ERROR_CODES[scenarioResult.errorCode] ??
    'WINDOWS_ACCEPTANCE_CLEAN_SCENARIO_FAILED'
  );
}

async function inspectExactProduct(verifyExactProductState) {
  try {
    const result = await verifyExactProductState();
    if (
      result?.status === 'completed' &&
      typeof result.exactProductPresent === 'boolean' &&
      (result.resultCode === 'exactProductPresent' ||
        result.resultCode === 'exactProductAbsent') &&
      result.exactProductPresent ===
        (result.resultCode === 'exactProductPresent')
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
    // The exact verifier has a closed failure result below.
  }
  return Object.freeze({
    status: 'failed',
    errorCode: 'productStateVerificationFailed',
  });
}

async function runSemanticCleanup(cleanupExactProduct) {
  try {
    const result = await cleanupExactProduct();
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
    // The cleanup adapter has a closed failure result below.
  }
  return Object.freeze({
    status: 'failed',
    errorCode: 'semanticCleanupFailed',
  });
}

function createFailureDetails({
  errorCode,
  productStateVerificationResultCode,
  scenarioResultCode,
  semanticCleanupResultCode,
  supervisorResult,
}) {
  return Object.freeze({
    schemaVersion: 1,
    scenario: 'cleanInstallUninstall',
    status: 'failed',
    errorCode,
    supervisorProcessResultCode: supervisorResult.processResultCode,
    supervisorWorkerResultCode: supervisorResult.workerResultCode,
    supervisorCleanupResultCode: supervisorResult.cleanupResultCode,
    processTreeAbsent: supervisorResult.processTreeAbsent,
    scenarioResultCode,
    productStateVerificationResultCode,
    semanticCleanupResultCode,
  });
}

export async function prepareCleanInstallUninstallTerminalOutcome({
  readScenarioResult,
  supervisorResult,
  verifyExactProductState,
}) {
  if (supervisorResult.status === 'completed') {
    let scenarioResult;
    try { scenarioResult = await readScenarioResult(); }
    catch {
      return Object.freeze({ supervisorResult, scenarioResult: null,
        errorCode: 'WINDOWS_ACCEPTANCE_CLEAN_RESULT_MISSING_OR_INVALID',
        scenarioResultCode: 'missingOrInvalid', productStateVerificationResultCode: 'notChecked',
        semanticCleanupResultCode: 'notRequired', cleanupAction: 'blocked' });
    }
    if (scenarioResult.status !== 'completed') {
      throw new CleanInstallUninstallCommandFailure(
        createFailureDetails({
          errorCode: scenarioErrorCode(scenarioResult),
          productStateVerificationResultCode: 'notRequired',
          scenarioResultCode: scenarioResult.resultCode,
          semanticCleanupResultCode: scenarioResult.cleanupResultCode,
          supervisorResult,
        }),
      );
    }
    return Object.freeze({ supervisorResult, scenarioResult, errorCode: null, cleanupAction: 'notRequired' });
  }

  let errorCode = supervisorErrorCode(supervisorResult);
  let scenarioResultCode = 'notAvailable';
  let preconditionRejected = false;
  if (
    supervisorResult.processResultCode === 'processCompleted' &&
    supervisorResult.workerResultCode === 'workerReportedFailure'
  ) {
    try {
      const scenarioResult = await readScenarioResult();
      if (scenarioResult.status === 'failed') {
        errorCode = scenarioErrorCode(scenarioResult);
        scenarioResultCode = scenarioResult.resultCode;
        preconditionRejected = scenarioResult.errorCode === 'cleanLifecyclePreconditionFailed';
      }
    } catch {
      scenarioResultCode = 'missingOrInvalid';
    }
  }

  let productStateVerificationResultCode = 'notChecked';
  let semanticCleanupResultCode = 'notRequired';
  if (preconditionRejected) {
    return Object.freeze({ errorCode, scenarioResultCode, productStateVerificationResultCode,
      semanticCleanupResultCode: 'blockedByPrecondition', supervisorResult, cleanupAction: 'blocked' });
  }
  if (!supervisorResult.processTreeAbsent) {
    return Object.freeze({ errorCode, scenarioResultCode, productStateVerificationResultCode,
      semanticCleanupResultCode: 'blockedByOwnedProcessTree', supervisorResult, cleanupAction: 'blocked' });
  }
  const initialInspection = await inspectExactProduct(verifyExactProductState);
  if (initialInspection.status === 'failed') {
    productStateVerificationResultCode = initialInspection.errorCode;
  } else {
    productStateVerificationResultCode = initialInspection.resultCode;
  }
  return Object.freeze({ errorCode, productStateVerificationResultCode, scenarioResultCode,
    semanticCleanupResultCode, supervisorResult, cleanupAction: initialInspection.status === 'completed' &&
      initialInspection.exactProductPresent ? 'cleanupThenVerify' : 'notRequired' });
}

// Cleanup is an explicit phase result, never executed by the decision reader.
export function completeCleanInstallUninstallTerminalOutcome(plan, { cleanup, postcondition } = {}) {
  if (plan.errorCode === null) return plan.scenarioResult;
  let { semanticCleanupResultCode, productStateVerificationResultCode } = plan;
  if (plan.cleanupAction === 'cleanupThenVerify') {
    if (cleanup?.status !== 'completed' || cleanup.resultCode !== 'semanticCleanupCompleted') {
      semanticCleanupResultCode = cleanup?.errorCode ?? 'semanticCleanupFailed';
    } else if (postcondition?.status !== 'completed' || postcondition.exactProductPresent !== false ||
      postcondition.resultCode !== 'exactProductAbsent') {
      productStateVerificationResultCode = postcondition?.errorCode ?? postcondition?.resultCode ?? 'productStateVerificationFailed';
      semanticCleanupResultCode = 'semanticCleanupPostconditionFailed';
    } else {
      productStateVerificationResultCode = 'exactProductAbsentAfterCleanup';
      semanticCleanupResultCode = 'semanticCleanupCompleted';
    }
  }
  throw new CleanInstallUninstallCommandFailure(createFailureDetails({ ...plan,
    semanticCleanupResultCode, productStateVerificationResultCode }));
}

export async function resolveCleanInstallUninstallTerminalOutcome(options) {
  const plan = await prepareCleanInstallUninstallTerminalOutcome(options);
  let cleanup, postcondition;
  if (plan.cleanupAction === 'cleanupThenVerify') {
    cleanup = await runSemanticCleanup(options.cleanupExactProduct);
    if (cleanup.status === 'completed') postcondition = await inspectExactProduct(options.verifyExactProductState);
  }
  return completeCleanInstallUninstallTerminalOutcome(plan, { cleanup, postcondition });
}

export function cleanInstallUninstallFailureDetails(error) {
  return error instanceof CleanInstallUninstallCommandFailure
    ? error.details
    : null;
}
