import { maximumOperationFailureDepth } from '../../runtime/operationFailureCause.js';
import { readWorkspaceCandidateFailureCause } from '../../runtime/workspaceCandidateFailure.js';
import type { WorkspaceCandidateFailureCause } from '../../runtime/workspaceCandidateMessages.js';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { WorkspaceBackupReplacementError } from '../replacement/workspaceBackupReplacementError.js';

const inspectionStages = new Set([
  'backupPreflight', 'backupStage', 'candidateMigration', 'candidateValidation',
]);

export function classifyWorkspaceManagementFailure(
  error: unknown,
  operationKind: 'create' | 'import' | 'replace' | 'switch' | 'rename',
): { inspectionCauseCode?: WorkspaceCandidateFailureCause; lineageMismatch: boolean } {
  if (operationKind !== 'import' && operationKind !== 'replace') return { lineageMismatch: false };
  const seen = new Set<unknown>();
  let current = error;
  let inspectionObserved = false;
  try {
    for (let depth = 0; depth < maximumOperationFailureDepth; depth++) {
      if (!(current instanceof Error) || seen.has(current)) break;
      seen.add(current);
      if (current instanceof AggregateError) {
        current = current.errors[0];
        continue;
      }
      if (operationKind === 'replace' && current instanceof WorkspaceBackupReplacementError &&
        current.code === 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH' && current.stage === 'lineageCheck') {
        return { lineageMismatch: true };
      }
      if (((operationKind === 'import' && current instanceof WorkspaceBackupImportError) ||
        (operationKind === 'replace' && current instanceof WorkspaceBackupReplacementError)) &&
        inspectionStages.has(current.stage)) inspectionObserved = true;
      current = current.cause;
    }
  } catch {
    // Unreadable exception metadata is not evidence of an inspection failure.
  }
  const cause = readWorkspaceCandidateFailureCause(error);
  return {
    lineageMismatch: false,
    ...(inspectionObserved || cause !== 'unknown' ? { inspectionCauseCode: cause } : {}),
  };
}
