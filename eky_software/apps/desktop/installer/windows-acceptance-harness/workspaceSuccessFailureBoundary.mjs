import {
  WORKSPACE_SUCCESS_POSTCONDITION_ERRORS, hasWorkspaceSuccessExactKeys,
  validateWorkspaceSuccessResult, workspaceSuccessErrorCode,
} from './workspaceSuccessContracts.mjs';
import { validateWorkspaceFaultRequest, validateWorkspaceFaultResult,
  workspaceFaultErrorCode, workspaceFaultPlan } from './workspaceFaultContracts.mjs';
import { WORKSPACE_FAULT_POSTCONDITION_ERRORS } from './workspaceFaultPostcondition.mjs';
import { areProductProcessesAbsent } from './installerProductOperationRuntime.mjs';

const PRODUCT_FAILURES = Object.freeze([
  'productStateVerificationFailed', 'productStateVerificationTimedOut', 'productStateVerificationProcessRemains',
]);
const CLEANUP_FAILURES = Object.freeze([
  ...PRODUCT_FAILURES, 'semanticCleanupFailed', 'semanticCleanupTimedOut', 'semanticCleanupProcessRemains',
]);

function productState(value) {
  if (hasWorkspaceSuccessExactKeys(value, ['status', 'resultCode', 'sourcePresent', 'targetPresent', 'installerRegistryPresent']) &&
    value.status === 'completed' &&
    ['sourcePresent', 'targetPresent', 'installerRegistryPresent'].every((key) => typeof value[key] === 'boolean')) {
    const expected = value.sourcePresent ? value.targetPresent ? 'multipleProductsPresent' : 'sourceProductPresent'
      : value.targetPresent ? 'targetProductPresent' : value.installerRegistryPresent ? 'installerRegistryPresent' : 'exactProductsAbsent';
    if (value.resultCode === expected) return value;
  }
  return { status: 'failed', errorCode: PRODUCT_FAILURES.includes(value?.errorCode)
    ? value.errorCode : 'productStateVerificationFailed' };
}

export function requireWorkspaceSuccessProductPrecondition(value) {
  const result = productState(value);
  if (result.status !== 'completed') throw new Error(result.errorCode);
  if (result.resultCode !== 'exactProductsAbsent') throw new Error('preconditionFailed');
  return result;
}

async function inspect(verify) {
  try { return productState(await verify()); }
  catch { return productState(null); }
}

async function cleanup(remove) {
  try {
    const value = await remove();
    if (hasWorkspaceSuccessExactKeys(value, ['status', 'resultCode']) &&
      value.status === 'completed' && value.resultCode === 'semanticCleanupCompleted') return value;
    if (value?.status === 'failed' && CLEANUP_FAILURES.includes(value.errorCode)) return {
      status: 'failed', errorCode: value.errorCode,
    };
  } catch { /* A cleanup error never replaces the original scenario failure. */ }
  return { status: 'failed', errorCode: 'semanticCleanupFailed' };
}

export function resolveWorkspaceSuccessTerminalOutcome(input) {
  return resolveWorkspaceTerminalOutcome(input);
}

export function prepareWorkspaceSuccessTerminalOutcome(input) {
  return prepareWorkspaceTerminalOutcome(input);
}

export function prepareWorkspaceFaultTerminalOutcome(input) {
  const request = validateWorkspaceFaultRequest(input.request);
  return prepareWorkspaceTerminalOutcome({ ...input, request }, request.faultScenario);
}

export function resolveWorkspaceFaultTerminalOutcome(input) {
  const request = validateWorkspaceFaultRequest(input.request);
  return resolveWorkspaceTerminalOutcome({ ...input, request }, request.faultScenario);
}

async function resolveWorkspaceTerminalOutcome(input, faultScenario) {
  const plan = await prepareWorkspaceTerminalOutcome(input, faultScenario);
  return completeWorkspaceTerminalOutcome(plan, input);
}

async function prepareWorkspaceTerminalOutcome({
  request, supervisorResult, productPrecondition, readScenarioResult,
  verifyExactProductStates, verifySemanticPostcondition, verifySessionPostcondition,
}, faultScenario) {
  const fault = faultScenario !== undefined;
  const installedRole = fault ? workspaceFaultPlan(faultScenario).installedRole : 'target';
  const result = {
    schemaVersion: 1, scenario: fault ? request.scenario : 'packagedWorkspaceSuccess', status: 'failed',
    ...(fault ? { faultScenario, sessionProofResultCode: 'notChecked' } : {}),
    errorCode: 'supervisorResultUnavailable', processTreeAbsent: supervisorResult?.processTreeAbsent === true,
    supervisorProcessResultCode: supervisorResult?.processResultCode ?? 'notAvailable',
    supervisorWorkerResultCode: supervisorResult?.workerResultCode ?? 'notAvailable',
    supervisorCleanupResultCode: supervisorResult?.cleanupResultCode ?? 'notAvailable',
    scenarioResultCode: 'notChecked', failedPhase: null,
    initialProductStateResultCode: 'notChecked', semanticProofResultCode: 'notChecked',
    semanticCleanupResultCode: 'blockedByOwnedProcessTree', postconditionResultCode: 'notChecked',
    removalPostconditionResultCode: 'notChecked',
  };
  if (supervisorResult) {
    result.errorCode = supervisorResult.status === 'completed' ? null
      : supervisorResult.processResultCode === 'deadlineExceeded' ? 'supervisorDeadlineExceeded'
        : 'supervisorFailed';
  }
  // A missing supervisor result cannot prove an empty Job or authorize MSI cleanup.
  if (!result.processTreeAbsent) {
    result.errorCode ??= 'supervisorFailed';
    return { result, initial: null, cleanupAllowed: false, terminal: true };
  }
  const precondition = productState(productPrecondition);
  const cleanupAllowed = precondition.status === 'completed' && precondition.resultCode === 'exactProductsAbsent';
  if (!cleanupAllowed) result.errorCode ??= precondition.status === 'failed' ? precondition.errorCode : 'preconditionFailed';

  if (supervisorResult.status === 'completed' ||
    (supervisorResult.processResultCode === 'processCompleted' && supervisorResult.workerResultCode === 'workerReportedFailure') ||
    (supervisorResult.processResultCode === 'processExitFailed' && supervisorResult.childExitCode === 1)) {
    try {
      const scenario = (fault ? validateWorkspaceFaultResult : validateWorkspaceSuccessResult)(await readScenarioResult(), request);
      result.scenarioResultCode = scenario.resultCode;
      result.failedPhase = scenario.failedPhase;
      if (scenario.status === 'failed') result.errorCode = (fault ? workspaceFaultErrorCode : workspaceSuccessErrorCode)({ message: scenario.errorCode });
      else if (supervisorResult.status !== 'completed') result.errorCode ??= 'supervisorFailed';
    } catch {
      result.scenarioResultCode = 'missingOrInvalid';
      result.errorCode ??= 'scenarioResultInvalid';
    }
  }

  const initial = await inspect(verifyExactProductStates);
  result.initialProductStateResultCode = initial.status === 'completed' ? initial.resultCode : initial.errorCode;
  if (initial.status !== 'completed') {
    result.semanticCleanupResultCode = 'blockedByProductInspection';
    result.errorCode ??= initial.errorCode;
    return { result, initial, cleanupAllowed: false, terminal: true };
  }
  if (result.errorCode === null) {
    if (initial.resultCode !== `${installedRole}ProductPresent` || !initial.installerRegistryPresent) result.errorCode = `${installedRole}StateInvalid`;
    else {
      try {
        const proof = await verifySemanticPostcondition();
        if (!hasWorkspaceSuccessExactKeys(proof, ['status', 'resultCode']) ||
          proof.status !== 'completed' || proof.resultCode !== (fault ? 'workspaceFaultSemanticProofValidated' : 'workspaceSemanticProofValidated')) throw new Error();
        result.semanticProofResultCode = proof.resultCode;
      } catch (error) {
        result.semanticProofResultCode = fault ? 'workspaceFaultSemanticProofFailed' : 'workspaceSemanticProofFailed';
        result.errorCode = (fault ? WORKSPACE_FAULT_POSTCONDITION_ERRORS : WORKSPACE_SUCCESS_POSTCONDITION_ERRORS).includes(error?.message)
          ? error.message : 'profileEvidenceInvalid';
      }
      if (fault) {
        try {
          const proof = await verifySessionPostcondition();
          if (!hasWorkspaceSuccessExactKeys(proof, ['status', 'resultCode']) ||
            proof.status !== 'completed' || proof.resultCode !== 'workspaceFaultSessionsValidated') throw new Error();
          result.sessionProofResultCode = proof.resultCode;
        } catch {
          result.sessionProofResultCode = 'workspaceFaultSessionsFailed';
          result.errorCode ??= 'sessionProofInvalid';
        }
      }
    }
  }

  return { result, initial, cleanupAllowed, terminal: false };
}

// A plan is an internal read-only result, not a transferable cleanup permit.
// The fixed command reevaluates preparation from bound facts before mutation.
export async function completeWorkspaceTerminalOutcome(plan, {
  cleanupExactProducts, verifyExactProductStates, verifyRemovalPostcondition,
  outcome: productProcessOutcome,
}) {
  const { initial, cleanupAllowed } = plan;
  const result = { ...plan.result };
  if (plan.terminal) return Object.freeze(result);
  result.semanticCleanupResultCode = 'notRequired';
  let finalState = initial;
  if (initial.resultCode !== 'exactProductsAbsent') {
    if (!cleanupAllowed) {
      result.semanticCleanupResultCode = 'blockedByPrecondition';
      result.postconditionResultCode = initial.resultCode;
      return Object.freeze(result);
    }
    const outcome = await cleanup(cleanupExactProducts);
    result.semanticCleanupResultCode = outcome.status === 'completed' ? outcome.resultCode : outcome.errorCode;
    result.errorCode ??= outcome.status === 'completed' ? null : outcome.errorCode;
    if (productProcessOutcome && !areProductProcessesAbsent({ outcome: productProcessOutcome })) {
      result.postconditionResultCode = 'productStateVerificationProcessRemains';
      result.errorCode ??= 'semanticCleanupProcessRemains';
      return Object.freeze(result);
    }
    finalState = await inspect(verifyExactProductStates);
  }
  result.postconditionResultCode = finalState.status === 'completed' ? finalState.resultCode : finalState.errorCode;
  if (finalState.status !== 'completed' || finalState.resultCode !== 'exactProductsAbsent') {
    result.errorCode ??= 'productRemovalUnverified';
  } else {
    try {
      const removal = await verifyRemovalPostcondition();
      if (!hasWorkspaceSuccessExactKeys(removal, ['status', 'resultCode']) ||
        removal.status !== 'completed' || removal.resultCode !== 'installerFootprintAbsent') throw new Error();
      result.removalPostconditionResultCode = removal.resultCode;
    } catch {
      result.removalPostconditionResultCode = 'installerFootprintUnverified';
      result.errorCode ??= 'installerFootprintUnverified';
    }
  }
  result.status = result.errorCode === null ? 'completed' : 'failed';
  return Object.freeze(result);
}

export function workspaceSuccessRunRootRemovable({ supervisorAttempted, terminal, productProcessAbsent }) {
  if (productProcessAbsent !== true) return false;
  if (!supervisorAttempted) return true;
  return terminal?.processTreeAbsent === true && terminal.postconditionResultCode === 'exactProductsAbsent' &&
    ['notRequired', 'semanticCleanupCompleted'].includes(terminal.semanticCleanupResultCode) &&
    terminal.removalPostconditionResultCode === 'installerFootprintAbsent';
}
