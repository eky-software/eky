import { exactKeys } from './pidNamespaceContract.mjs';
import { consumerLossCase, requireConsumerLoss } from './linuxConsumerLossContract.mjs';

export function validateConsumerLossOutcome(value, caseId) {
  const selected = consumerLossCase(caseId);
  requireConsumerLoss(selected.cause !== 'caller' && exactKeys(value,
    ['caseId', 'bodyPreserved', 'refusal', 'fixtureCleanup', 'workerCleanup', 'launches', 'passive', 'commandsClosed']) &&
    value.caseId === caseId && value.bodyPreserved === true && value.passive === true && value.commandsClosed === true &&
    exactKeys(value.launches, selected.profiles) && selected.profiles.every(profile => value.launches[profile] === 1));
  const cleanup = value.fixtureCleanup;
  requireConsumerLoss(exactKeys(cleanup, ['context', 'api', 'web', 'backend', 'webPort', 'backendPort', 'artifacts',
    'priorCleanup', 'runRoot']) && ['context', 'api', 'web', 'backend', 'webPort', 'backendPort', 'artifacts']
    .every(key => ['notStarted', 'completed', 'failed'].includes(cleanup[key])) &&
    ['verified', 'unverified'].includes(cleanup.priorCleanup) && ['retained', 'removed'].includes(cleanup.runRoot) &&
    cleanup.artifacts === 'completed' && cleanup.api === 'completed');
  if (selected.profile === 'backend') {
    requireConsumerLoss(value.refusal === 'backendRestart' && value.workerCleanup === null &&
      cleanup.backend === 'failed' && cleanup.backendPort === 'completed' && cleanup.priorCleanup === 'unverified' &&
      cleanup.runRoot === 'retained' && ['context', 'web', 'webPort'].every(key => cleanup[key] === 'notStarted'));
  } else {
    const worker = value.workerCleanup;
    requireConsumerLoss(exactKeys(worker, ['schemaVersion', 'operation', 'phase', 'ownerFailure', 'cleanup', 'workerRoot']) &&
      worker.schemaVersion === 1 && worker.operation === 'chromiumWorker' && worker.phase === 'workerTeardown' &&
      worker.ownerFailure === null && cleanup.backend === 'completed' && cleanup.backendPort === 'completed' &&
      cleanup.webPort === 'completed' && cleanup.priorCleanup === 'verified');
    if (selected.profile === 'vite') {
      requireConsumerLoss(value.refusal === 'cachedViteStop' && cleanup.context === 'completed' &&
        cleanup.web === 'failed' && cleanup.runRoot === 'retained' && worker.cleanup === 'verified' &&
        worker.workerRoot === 'removed');
    } else {
      requireConsumerLoss(value.refusal === 'chromiumReplacement' && cleanup.web === 'completed' &&
        ['completed', 'failed'].includes(cleanup.context) && worker.cleanup === 'unverified' &&
        worker.workerRoot === 'retained' && cleanup.runRoot === (cleanup.context === 'completed' ? 'removed' : 'retained'));
    }
  }
  return value;
}
