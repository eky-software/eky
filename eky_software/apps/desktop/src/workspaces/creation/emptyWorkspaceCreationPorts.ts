import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceCreationOperationId } from './workspaceCreationTypes.js';

export interface ActiveWorkspaceLifecyclePort {
  quiesceWrites(previousActiveWorkspaceId: WorkspaceId | null): Promise<void>;
  stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }>;
  restartPreviousWorkspace(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void>;
}

export interface EmptyWorkspaceBootstrapInput {
  readonly operationId: WorkspaceCreationOperationId;
  readonly workspaceId: WorkspaceId;
  readonly candidateRoot: string;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
}

export interface EmptyWorkspaceBootstrapResult {
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

export interface EmptyWorkspaceBootstrapPort {
  bootstrap(
    input: Readonly<EmptyWorkspaceBootstrapInput>,
  ): Promise<Readonly<EmptyWorkspaceBootstrapResult>>;
}

export interface PublishedWorkspaceValidationInput {
  readonly operationId: WorkspaceCreationOperationId;
  readonly workspaceId: WorkspaceId;
  readonly publishedRoot: string;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
}

export interface PublishedWorkspaceValidationPort {
  validatePublished(
    input: Readonly<PublishedWorkspaceValidationInput>,
  ): Promise<Readonly<EmptyWorkspaceBootstrapResult>>;
}

export interface WorkspaceRegistryPort {
  read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined>;
  write(value: unknown): Promise<void>;
}
