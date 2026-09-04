const SCENARIO_ERROR_CODES = Object.freeze({
  cleanInstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_INSTALL_FAILED',
  cleanInstalledStateInvalid:
    'WINDOWS_ACCEPTANCE_CLEAN_INSTALLED_STATE_INVALID',
  cleanLifecyclePreconditionFailed:
    'WINDOWS_ACCEPTANCE_CLEAN_PRECONDITION_FAILED',
  cleanUninstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALL_FAILED',
  cleanUninstalledStateInvalid:
    'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALLED_STATE_INVALID',
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

export async function resolveCleanInstallUninstallTerminalOutcome({
  cleanupExactProduct,
  readScenarioResult,
  supervisorResult,
  verifyExactProductState,
}) {
  if (supervisorResult.status === 'completed') {
    const scenarioResult = await readScenarioResult();
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

  let productStateVerificationResultCode = 'notChecked';
  let semanticCleanupResultCode = 'notRequired';
  const initialInspection = await inspectExactProduct(verifyExactProductState);
  if (initialInspection.status === 'failed') {
    productStateVerificationResultCode = initialInspection.errorCode;
  } else {
    productStateVerificationResultCode = initialInspection.resultCode;
    if (initialInspection.exactProductPresent) {
      if (!supervisorResult.processTreeAbsent) {
        semanticCleanupResultCode = 'blockedByOwnedProcessTree';
      } else {
        const cleanupResult = await runSemanticCleanup(cleanupExactProduct);
        if (cleanupResult.status === 'failed') {
          semanticCleanupResultCode = cleanupResult.errorCode;
        } else {
          const finalInspection = await inspectExactProduct(
            verifyExactProductState,
          );
          if (finalInspection.status === 'failed') {
            productStateVerificationResultCode = finalInspection.errorCode;
            semanticCleanupResultCode = 'semanticCleanupPostconditionFailed';
          } else if (finalInspection.exactProductPresent) {
            productStateVerificationResultCode = finalInspection.resultCode;
            semanticCleanupResultCode = 'semanticCleanupPostconditionFailed';
          } else {
            productStateVerificationResultCode =
              'exactProductAbsentAfterCleanup';
            semanticCleanupResultCode = cleanupResult.resultCode;
          }
        }
      }
    }
  }

  throw new CleanInstallUninstallCommandFailure(
    createFailureDetails({
      errorCode,
      productStateVerificationResultCode,
      scenarioResultCode,
      semanticCleanupResultCode,
      supervisorResult,
    }),
  );
}

export function cleanInstallUninstallFailureDetails(error) {
  return error instanceof CleanInstallUninstallCommandFailure
    ? error.details
    : null;
}
