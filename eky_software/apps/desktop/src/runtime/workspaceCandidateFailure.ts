import {
  maximumOperationFailureDepth,
  readPrimaryOperationFailureCause,
} from './operationFailureCause.js';
import {
  workspaceCandidateFailureCauses,
  type WorkspaceCandidateFailureCause,
} from './workspaceCandidateMessages.js';

export function readWorkspaceCandidateFailureCause(
  error: unknown,
): WorkspaceCandidateFailureCause {
  return readPrimaryOperationFailureCause(error, workspaceCandidateFailureCauses)
    ?? 'unknown';
}

export function readWorkspaceCandidateCleanupCause(
  error: unknown,
): WorkspaceCandidateFailureCause | undefined {
  const seen = new Set<unknown>();
  let current = error;
  let cleanup: WorkspaceCandidateFailureCause | undefined;
  try {
    for (let depth = 0; depth < maximumOperationFailureDepth; depth++) {
      if (!(current instanceof Error)) {
        return cleanup;
      }
      if (seen.has(current)) {
        return cleanup;
      }
      seen.add(current);
      if (current instanceof AggregateError) {
        if (current.errors.length > 1) {
          // A deeper aggregate's recovery precedes an outer lease failure.
          cleanup = readWorkspaceCandidateFailureCause(current.errors[1]);
        }
        current = current.errors[0];
      } else {
        current = current.cause;
      }
    }
    return cleanup;
  } catch {
    return cleanup;
  }
}
