import type { WorkspaceBackupCandidatePort } from '../import/workspaceBackupImportPorts.js';

export function createWorkspaceActivationMigrationCandidate(input: {
  readonly candidate: WorkspaceBackupCandidatePort;
  readonly beforeMigration?: () => void;
}): WorkspaceBackupCandidatePort {
  if (input.beforeMigration === undefined) return input.candidate;

  return Object.freeze({
    async migrate(
      migrationInput: Parameters<WorkspaceBackupCandidatePort['migrate']>[0],
    ) {
      input.beforeMigration?.();
      return input.candidate.migrate(migrationInput);
    },
    validateAndMaterialize: (
      validationInput: Parameters<
        WorkspaceBackupCandidatePort['validateAndMaterialize']
      >[0],
    ) =>
      input.candidate.validateAndMaterialize(validationInput),
    validatePublished: (
      validationInput: Parameters<
        WorkspaceBackupCandidatePort['validatePublished']
      >[0],
    ) =>
      input.candidate.validatePublished(validationInput),
  });
}
