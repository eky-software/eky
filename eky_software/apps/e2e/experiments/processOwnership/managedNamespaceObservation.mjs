import { startManagedCommand } from './managedNamespaceCommand.mjs';

// Preserve the show-only API; command closure is not unit/tree-cleanup proof.
export function startManagedObservation(options) {
  const query = startManagedCommand({ ...options, operation: 'observation' });
  const view = ({ commandCleanup, ...state }) => Object.freeze({ ...state, queryCleanup: commandCleanup });
  return Object.freeze({ result: query.result, closed: query.closed.then(view), snapshot: () => view(query.snapshot()) });
}
