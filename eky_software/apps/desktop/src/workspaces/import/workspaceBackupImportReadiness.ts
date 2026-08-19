import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import type { WorkspaceBackupCandidateReadiness } from './workspaceBackupImportPorts.js';

const boundedIdentityPattern = /^[A-Za-z0-9._:-]{1,200}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function validateWorkspaceBackupCandidateReadiness(
  value: Readonly<WorkspaceBackupCandidateReadiness>,
): Readonly<WorkspaceBackupCandidateReadiness> {
  if (
    value.actorId !== 'local-owner' ||
    value.artifactRootHealth !== 'ready' ||
    value.databaseHealth !== 'healthy' ||
    value.foreignKeyHealth !== 'healthy' ||
    value.handlesClosed !== true ||
    value.migrationState !== 'current' ||
    typeof value.companyId !== 'string' ||
    !boundedIdentityPattern.test(value.companyId) ||
    typeof value.migrationChainIdentity !== 'string' ||
    !sha256Pattern.test(value.migrationChainIdentity)
  ) {
    throw new Error('WORKSPACE_IMPORT_READINESS_INVALID');
  }
  const lineageIdentity = validateWorkspaceLineage(value.lineageIdentity);
  return Object.freeze({ ...value, lineageIdentity });
}

export function validateWorkspaceBackupMigrationResult(value: {
  readonly handlesClosed: true;
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}): void {
  if (
    value.handlesClosed !== true ||
    !sha256Pattern.test(value.migrationChainIdentity) ||
    !sha256Pattern.test(value.profileId)
  ) {
    throw new Error('WORKSPACE_IMPORT_MIGRATION_RESULT_INVALID');
  }
}
