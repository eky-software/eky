import type {
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceBackupImportOperationId } from './workspaceBackupImportTypes.js';

export interface WorkspaceBackupSourceInput {
  readonly containerPath: string;
  readonly password: string;
}

export interface WorkspaceBackupPreflightResult {
  readonly appVersion: string;
  readonly containerSha256: string;
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}

export interface WorkspaceBackupStageInput extends WorkspaceBackupSourceInput {
  readonly expectedContainerSha256: string;
  readonly expectedMigrationChainIdentity: string;
  readonly expectedProfileId: string;
  readonly importStagingRoot: string;
}

export interface WorkspaceBackupContainerPort {
  inspect(
    input: Readonly<WorkspaceBackupSourceInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>>;
  stage(
    input: Readonly<WorkspaceBackupStageInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>>;
}

export interface WorkspaceBackupCandidateMigrationInput {
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly workspaceId: WorkspaceId;
  readonly candidateRoot: string;
  readonly importStagingRoot: string;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
  readonly expectedProfileId: string;
  readonly expectedSourceMigrationChainIdentity: string;
}

export interface WorkspaceBackupCandidateMigrationResult {
  readonly handlesClosed: true;
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}

export interface WorkspaceBackupCandidateValidationInput {
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly workspaceId: WorkspaceId;
  readonly candidateRoot: string;
  readonly importStagingRoot: string;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
  readonly expectedProfileId: string;
}

export interface PublishedWorkspaceBackupValidationInput {
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly workspaceId: WorkspaceId;
  readonly publishedRoot: string;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
  readonly expectedProfileId: string;
}

export interface WorkspaceBackupCandidateReadiness {
  readonly actorId: 'local-owner';
  readonly artifactRootHealth: 'ready';
  readonly companyId: string;
  readonly databaseHealth: 'healthy';
  readonly foreignKeyHealth: 'healthy';
  readonly handlesClosed: true;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  readonly migrationChainIdentity: string;
  readonly migrationState: 'current';
}

export interface WorkspaceBackupCandidatePort {
  migrate(
    input: Readonly<WorkspaceBackupCandidateMigrationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateMigrationResult>>;
  validateAndMaterialize(
    input: Readonly<WorkspaceBackupCandidateValidationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>>;
  validatePublished(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>>;
}
