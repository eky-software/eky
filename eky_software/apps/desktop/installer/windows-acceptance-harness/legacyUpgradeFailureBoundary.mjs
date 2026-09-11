import { LEGACY_FOOTPRINT_ERROR_CODES, LEGACY_UPGRADE_WORKER_EXIT_CODES } from './legacyUpgradeContracts.mjs';
import { LEGACY_FILESYSTEM_ERROR_CODES } from './legacyUpgradeFilesystem.mjs';
import { areProductProcessesAbsent } from './installerProductOperationRuntime.mjs';

const SCENARIO_ERROR_CODES = Object.freeze({
  ...LEGACY_FOOTPRINT_ERROR_CODES,
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

export const LEGACY_COMMAND_ERROR_CODES = Object.freeze([
  ...LEGACY_FILESYSTEM_ERROR_CODES,
  'WINDOWS_ACCEPTANCE_LEGACY_PRODUCT_PROCESS_UNVERIFIED',
  'WINDOWS_ACCEPTANCE_LEGACY_PHASE_WRITER_EXIT_UNVERIFIED',
  'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_INVALID',
  ...Object.values(SCENARIO_ERROR_CODES), ...Object.values(SUPERVISOR_ERROR_CODES),
  'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_FAILED', 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_FAILED',
  'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID', 'WINDOWS_ACCEPTANCE_LEGACY_TARGET_POSTCONDITION_FAILED',
  'WINDOWS_ACCEPTANCE_LEGACY_SEMANTIC_PROOF_FAILED', 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED',
  'WINDOWS_ACCEPTANCE_LEGACY_FIXTURE_CLEANUP_FAILED', 'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED',
  'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED', 'WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID',
  'WINDOWS_ACCEPTANCE_LEGACY_WINDOWS_REQUIRED', 'WINDOWS_ACCEPTANCE_LEGACY_ENVIRONMENT_INVALID',
  'WINDOWS_ACCEPTANCE_LEGACY_TEMP_ROOT_INVALID', 'WINDOWS_ACCEPTANCE_SUPERVISOR_BINARY_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_START_FAILED', 'WINDOWS_ACCEPTANCE_SUPERVISOR_EXIT_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING', 'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_BINDING_INVALID', 'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID',
]);

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

function productInspection(result) {
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
  return Object.freeze({
    status: 'failed',
    errorCode: 'productStateVerificationFailed',
  });
}

function productCleanup(result) {
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
  return Object.freeze({ status: 'failed', errorCode: 'semanticCleanupFailed' });
}

async function inspectProducts(verifyExactProductStates) {
  try {
    return productInspection(await verifyExactProductStates());
  } catch {
    return productInspection(null);
  }
}

async function cleanupProducts(cleanupExactProducts) {
  try {
    return productCleanup(await cleanupExactProducts());
  } catch {
    return productCleanup(null);
  }
}

function guardedProductVerifier(verifyProducts, outcome) {
  return () => outcome && !areProductProcessesAbsent({ outcome })
    ? { status: 'failed', errorCode: 'productStateVerificationProcessRemains' }
    : verifyProducts();
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

// This read-only phase decides whether exact cleanup is permitted. It never
// performs cleanup or turns a successful cleanup into scenario acceptance.
export async function prepareLegacyUpgradeTerminalOutcome({
  productPrecondition,
  readScenarioResult,
  supervisorResult,
  verifyExactProductStates: verifyProducts,
  verifySemanticPostcondition,
  outcome,
}) {
  const verifyExactProductStates = guardedProductVerifier(verifyProducts, outcome);
  const preconditionValidated =
    productPrecondition?.status === 'completed' &&
    productPrecondition.resultCode === 'exactProductsAbsent' &&
    productPrecondition.sourcePresent === false &&
    productPrecondition.targetPresent === false &&
    productPrecondition.installerRegistryPresent === false;
  const supervisorCompleted = supervisorResult.status === 'completed';
  let errorCode = supervisorCompleted ? null : supervisorErrorCode(supervisorResult);
  let scenarioResult = null;
  let scenarioResultCode = 'notAvailable';
  let semanticProof = null;
  let semanticProofResultCode = 'notChecked';
  let semanticCleanupAllowed = preconditionValidated;
  if (
    supervisorCompleted ||
    (supervisorResult.processResultCode === 'processCompleted' &&
      supervisorResult.workerResultCode === 'workerReportedFailure') ||
    (supervisorResult.processResultCode === 'processExitFailed' &&
      supervisorResult.childExitCode === LEGACY_UPGRADE_WORKER_EXIT_CODES.failed)
  ) {
    try {
      const result = await readScenarioResult();
      if (result.status === 'failed' || (supervisorCompleted && result.status !== 'completed')) {
        errorCode = scenarioErrorCode(result);
        scenarioResultCode = result.resultCode;
        semanticCleanupAllowed = result.errorCode !== 'upgradeLifecyclePreconditionFailed';
      } else if (supervisorCompleted) {
        scenarioResult = result;
        scenarioResultCode = result.resultCode;
        semanticCleanupAllowed = true;
      }
    } catch {
      if (supervisorCompleted) {
        errorCode = 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID';
      }
      scenarioResultCode = 'missingOrInvalid';
    }
  }

  const initial = supervisorResult.processTreeAbsent
    ? await inspectProducts(verifyExactProductStates) : null;
  if (
    errorCode === null &&
    (initial?.status !== 'completed' || initial.resultCode !== 'targetProductPresent')
  ) {
    errorCode = 'WINDOWS_ACCEPTANCE_LEGACY_TARGET_POSTCONDITION_FAILED';
  }
  if (errorCode === null) {
    try {
      semanticProof = await verifySemanticPostcondition();
    } catch {
      semanticProof = { status: 'failed', errorCode: 'legacySemanticProofFailed' };
    }
    if (
      semanticProof?.status !== 'completed' ||
      semanticProof.resultCode !== 'legacySemanticProofValidated'
    ) {
      errorCode = 'WINDOWS_ACCEPTANCE_LEGACY_SEMANTIC_PROOF_FAILED';
      semanticProofResultCode = semanticProof?.errorCode ?? 'legacySemanticProofFailed';
    } else {
      semanticProofResultCode = semanticProof.resultCode;
    }
  }

  let cleanupAction = 'notRequired';
  if (!supervisorResult.processTreeAbsent) {
    cleanupAction = 'blockedByOwnedProcessTree';
  } else if (initial.status === 'completed' && initial.resultCode !== 'exactProductsAbsent') {
    cleanupAction = semanticCleanupAllowed ? 'cleanupThenVerify' : 'blockedByPrecondition';
  }
  return Object.freeze({
    errorCode,
    supervisorResult,
    scenarioResult,
    scenarioResultCode,
    semanticProof,
    semanticProofResultCode,
    initialProductStateResultCode: initial === null ? 'notChecked'
      : initial.status === 'completed' ? initial.resultCode : initial.errorCode,
    cleanupAction,
  });
}

export function completeLegacyUpgradeTerminalOutcome(plan, { cleanup, postcondition } = {}) {
  let semanticCleanupResultCode = plan.cleanupAction;
  let postconditionResultCode = plan.initialProductStateResultCode;
  let errorCode = plan.errorCode;
  if (plan.cleanupAction === 'cleanupThenVerify') {
    cleanup = productCleanup(cleanup);
    postcondition = productInspection(postcondition);
    semanticCleanupResultCode =
      cleanup.status === 'completed' ? cleanup.resultCode : cleanup.errorCode;
    postconditionResultCode =
      postcondition.status === 'completed' ? postcondition.resultCode : postcondition.errorCode;
    if (
      cleanup.status === 'completed' && postcondition.status === 'completed' &&
      postcondition.resultCode === 'exactProductsAbsent'
    ) {
      if (errorCode === null) {
        return Object.freeze({ scenarioResult: plan.scenarioResult, semanticProof: plan.semanticProof });
      }
      postconditionResultCode = 'exactProductsAbsentAfterCleanup';
    }
  }
  errorCode ??= 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED';
  throw new LegacyUpgradeCommandFailure(details({
    ...plan,
    errorCode,
    semanticCleanupResultCode,
    postconditionResultCode,
  }));
}

export async function resolveLegacyUpgradeTerminalOutcome(dependencies) {
  const plan = await prepareLegacyUpgradeTerminalOutcome(dependencies);
  let cleanup;
  let postcondition;
  if (plan.cleanupAction === 'cleanupThenVerify') {
    cleanup = await cleanupProducts(dependencies.cleanupExactProducts);
    postcondition = await inspectProducts(guardedProductVerifier(
      dependencies.verifyExactProductStates, dependencies.outcome,
    ));
  }
  return completeLegacyUpgradeTerminalOutcome(plan, { cleanup, postcondition });
}

export function legacyUpgradeFailureDetails(error) {
  return error instanceof LegacyUpgradeCommandFailure ? error.details : null;
}
