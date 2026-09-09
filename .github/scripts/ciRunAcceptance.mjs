import { CI_GATES, isCiRecord, validateCiRiskPlan } from './ciRiskPolicy.mjs';
import { evaluateCiAcceptance } from './ciAcceptanceResult.mjs';
import { verifyCiJobCoverage } from './ciJobCoverage.mjs';

export const CI_WORKFLOWS = Object.freeze(['classification', 'cadence_contracts', 'core', 'supervisor', 'clean', 'upgrade', 'legacy', 'workspace']);

export function evaluateCiRun(plan, needs, jobs) {
  const failed = (resultCode) => ({ schemaVersion: 1, status: 'failed', resultCode });
  try { validateCiRiskPlan(plan); } catch { return failed('riskPlanInvalid'); }
  if (!isCiRecord(needs, CI_WORKFLOWS) || Object.values(needs).some((value) =>
    !isCiRecord(value, ['result', 'outputs']) || !['success', 'failure', 'cancelled', 'skipped'].includes(value.result))) {
    return failed('workflowResultsInvalid');
  }
  if (needs.classification.result !== 'success') return failed('classificationNotSuccessful');
  const selected = { classification: true, cadence_contracts: true, core: true,
    supervisor: plan.gates.windowsContracts, clean: plan.gates.cleanLifecycle,
    upgrade: plan.gates.upgradeRollback, legacy: plan.gates.legacyUpgrade,
    workspace: plan.gates.workspaceSuccess || plan.gates.workspaceFault };
  if (CI_WORKFLOWS.some((key) => selected[key] ? needs[key].result !== 'success'
    : !['success', 'skipped'].includes(needs[key].result))) return failed('workflowNotSuccessful');
  try { verifyCiJobCoverage(plan, jobs); }
  catch (error) {
    return failed(['CI_FAULT_COVERAGE_INVALID', 'CI_JOB_EVIDENCE_INVALID', 'CI_UNEXPECTED_MATRIX_MEMBER',
      'CI_REQUIRED_JOB_INCOMPLETE', 'CI_REQUIRED_STEP_INCOMPLETE'].includes(error?.message) ? error.message : 'jobCoverageInvalid');
  }
  return evaluateCiAcceptance(plan, { classification: 'success',
    ...Object.fromEntries(CI_GATES.map((gate) => [gate, plan.gates[gate] ? 'success' : 'skipped'])),
  });
}
