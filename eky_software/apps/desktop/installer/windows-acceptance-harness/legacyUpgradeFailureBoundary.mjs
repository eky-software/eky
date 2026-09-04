import { LEGACY_UPGRADE_WORKER_EXIT_CODES } from './legacyUpgradeContracts.mjs';

const SCENARIO_ERROR_CODES = Object.freeze({
  artifactVerificationFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFICATION_FAILED',
  installerFootprintInspectionFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_FOOTPRINT_INSPECTION_FAILED',
  installerSourceProductInspectionFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_PRODUCT_INSPECTION_FAILED',
  installerStateInspectionFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_STATE_INSPECTION_FAILED',
  installerStateSnapshotChanged:
    'WINDOWS_ACCEPTANCE_LEGACY_STATE_SNAPSHOT_CHANGED',
  installerTargetProductInspectionFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_TARGET_PRODUCT_INSPECTION_FAILED',
  legacyBusinessFixtureInvalid:
    'WINDOWS_ACCEPTANCE_LEGACY_BUSINESS_FIXTURE_INVALID',
  majorUpgradeFailed: 'WINDOWS_ACCEPTANCE_LEGACY_MAJOR_UPGRADE_FAILED',
  majorUpgradeStateInvalid:
    'WINDOWS_ACCEPTANCE_LEGACY_MAJOR_UPGRADE_STATE_INVALID',
  sourceInstallFailed: 'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_INSTALL_FAILED',
  sourceNormalStartupFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_NORMAL_START_FAILED',
  sourcePackagedSmokeFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_SMOKE_FAILED',
  sourceStateInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_STATE_INVALID',
  targetFirstStartupFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_TARGET_FIRST_START_FAILED',
  targetSecondStartupFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_TARGET_SECOND_START_FAILED',
  unexpectedFailure: 'WINDOWS_ACCEPTANCE_LEGACY_UNEXPECTED_FAILURE',
  upgradeLifecyclePreconditionFailed:
    'WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED',
});

const SUPERVISOR_ERROR_CODES = Object.freeze({
  deadlineExceeded: 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  processCompleted: 'WINDOWS_ACCEPTANCE_SUPERVISOR_WORKER_RESULT_FAILED',
  processExitFailed: 'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_EXIT_FAILED',
  unexpectedFailure: 'WINDOWS_ACCEPTANCE_SUPERVISOR_UNEXPECTED_FAILURE',
});

export class LegacyUpgradeCommandFailure extends Error {
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
    'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_FAILED'
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
    // Closed verifier result below.
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
    // Closed cleanup result below.
  }
  return Object.freeze({ status: 'failed', errorCode: 'semanticCleanupFailed' });
}

function details({
  errorCode,
  initialProductStateResultCode,
  postconditionResultCode,
  scenarioResultCode,
  semanticCleanupResultCode,
  semanticProofResultCode,
  supervisorResult,
}) {
  return Object.freeze({
    schemaVersion: 1,
    scenario: 'historicalLegacyUpgrade',
    status: 'failed',
    errorCode,
    supervisorProcessResultCode: supervisorResult.processResultCode,
    supervisorWorkerResultCode: supervisorResult.workerResultCode,
    supervisorCleanupResultCode: supervisorResult.cleanupResultCode,
    processTreeAbsent: supervisorResult.processTreeAbsent,
    scenarioResultCode,
    initialProductStateResultCode,
    semanticProofResultCode,
    semanticCleanupResultCode,
    postconditionResultCode,
  });
}

async function recoverAndThrow({
  cleanupExactProducts,
  errorCode,
  initialInspection,
  scenarioResultCode,
  semanticCleanupAllowed = true,
  semanticProofResultCode = 'notChecked',
  supervisorResult,
  verifyExactProductStates,
}) {
  const initial =
    initialInspection ?? (await inspectProducts(verifyExactProductStates));
  const initialProductStateResultCode =
    initial.status === 'completed' ? initial.resultCode : initial.errorCode;
  let semanticCleanupResultCode = 'notRequired';
  let postconditionResultCode = initialProductStateResultCode;
  if (
    initial.status === 'completed' &&
    initial.resultCode !== 'exactProductsAbsent'
  ) {
    if (!semanticCleanupAllowed) {
      semanticCleanupResultCode = 'blockedByPrecondition';
    } else if (!supervisorResult.processTreeAbsent) {
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
  throw new LegacyUpgradeCommandFailure(
    details({
      errorCode,
      initialProductStateResultCode,
      postconditionResultCode,
      scenarioResultCode,
      semanticCleanupResultCode,
      semanticProofResultCode,
      supervisorResult,
    }),
  );
}

export async function resolveLegacyUpgradeTerminalOutcome({
  cleanupExactProducts,
  readScenarioResult,
  supervisorResult,
  verifyExactProductStates,
  verifySemanticPostcondition,
}) {
  if (supervisorResult.status === 'completed') {
    const scenarioResult = await readScenarioResult();
    if (scenarioResult.status !== 'completed') {
      await recoverAndThrow({
        cleanupExactProducts,
        errorCode: scenarioErrorCode(scenarioResult),
        scenarioResultCode: scenarioResult.resultCode,
        semanticCleanupAllowed:
          scenarioResult.errorCode !== 'upgradeLifecyclePreconditionFailed',
        supervisorResult,
        verifyExactProductStates,
      });
    }
    const installed = await inspectProducts(verifyExactProductStates);
    if (
      installed.status !== 'completed' ||
      installed.resultCode !== 'targetProductPresent'
    ) {
      await recoverAndThrow({
        cleanupExactProducts,
        errorCode: 'WINDOWS_ACCEPTANCE_LEGACY_TARGET_POSTCONDITION_FAILED',
        initialInspection: installed,
        scenarioResultCode: scenarioResult.resultCode,
        supervisorResult,
        verifyExactProductStates,
      });
    }
    let semanticProof;
    try {
      semanticProof = await verifySemanticPostcondition();
    } catch {
      semanticProof = { status: 'failed', errorCode: 'legacySemanticProofFailed' };
    }
    if (
      semanticProof?.status !== 'completed' ||
      semanticProof.resultCode !== 'legacySemanticProofValidated'
    ) {
      await recoverAndThrow({
        cleanupExactProducts,
        errorCode: 'WINDOWS_ACCEPTANCE_LEGACY_SEMANTIC_PROOF_FAILED',
        initialInspection: installed,
        scenarioResultCode: scenarioResult.resultCode,
        semanticProofResultCode:
          semanticProof?.errorCode ?? 'legacySemanticProofFailed',
        supervisorResult,
        verifyExactProductStates,
      });
    }
    const cleanup = await cleanupProducts(cleanupExactProducts);
    const postcondition = await inspectProducts(verifyExactProductStates);
    if (
      cleanup.status !== 'completed' ||
      postcondition.status !== 'completed' ||
      postcondition.resultCode !== 'exactProductsAbsent'
    ) {
      throw new LegacyUpgradeCommandFailure(
        details({
          errorCode: 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED',
          initialProductStateResultCode: installed.resultCode,
          postconditionResultCode:
            postcondition.status === 'completed'
              ? postcondition.resultCode
              : postcondition.errorCode,
          scenarioResultCode: scenarioResult.resultCode,
          semanticCleanupResultCode:
            cleanup.status === 'completed'
              ? cleanup.resultCode
              : cleanup.errorCode,
          semanticProofResultCode: semanticProof.resultCode,
          supervisorResult,
        }),
      );
    }
    return Object.freeze({ scenarioResult, semanticProof });
  }

  let errorCode = supervisorErrorCode(supervisorResult);
  let scenarioResultCode = 'notAvailable';
  let semanticCleanupAllowed = true;
  if (
    (supervisorResult.processResultCode === 'processCompleted' &&
      supervisorResult.workerResultCode === 'workerReportedFailure') ||
    (supervisorResult.processResultCode === 'processExitFailed' &&
      supervisorResult.childExitCode === LEGACY_UPGRADE_WORKER_EXIT_CODES.failed)
  ) {
    try {
      const scenarioResult = await readScenarioResult();
      if (scenarioResult.status === 'failed') {
        errorCode = scenarioErrorCode(scenarioResult);
        scenarioResultCode = scenarioResult.resultCode;
        semanticCleanupAllowed =
          scenarioResult.errorCode !== 'upgradeLifecyclePreconditionFailed';
      }
    } catch {
      scenarioResultCode = 'missingOrInvalid';
    }
  }
  await recoverAndThrow({
    cleanupExactProducts,
    errorCode,
    scenarioResultCode,
    semanticCleanupAllowed,
    supervisorResult,
    verifyExactProductStates,
  });
}

export function legacyUpgradeFailureDetails(error) {
  return error instanceof LegacyUpgradeCommandFailure ? error.details : null;
}
