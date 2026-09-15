import { CI_GATES, isCiRecord, validateCiRiskPlan } from './ciRiskPolicy.mjs';

export function evaluateCiAcceptance(plan, results) {
  const failed = (resultCode, failedGates = []) => Object.freeze({ schemaVersion: 1,
    status: 'failed', resultCode, failedGates: Object.freeze(failedGates),
  });
  try { validateCiRiskPlan(plan); }
  catch { return failed('riskPlanInvalid'); }
  if (!isCiRecord(results, ['classification', ...CI_GATES]) ||
    Object.values(results).some((result) => !['success', 'failure', 'cancelled', 'skipped'].includes(result))) {
    return failed('jobResultsInvalid');
  }
  if (results.classification !== 'success') return failed('classificationNotSuccessful', ['classification']);
  const failedGates = CI_GATES.filter((gate) => plan.gates[gate]
    ? results[gate] !== 'success' : !['success', 'skipped'].includes(results[gate]));
  if (failedGates.length > 0) return failed('requiredJobsNotSuccessful', failedGates);
  return Object.freeze({ schemaVersion: 1, status: 'completed', resultCode: 'ciAccepted', failedGates: Object.freeze([]) });
}
