import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from '../registry/workspaceRegistryValidation.js';
import { EmptyWorkspaceCreationError } from './emptyWorkspaceCreationError.js';

export function readCreationRegistry(
  value: Readonly<LocalWorkspaceRegistryV1> | undefined,
): Readonly<LocalWorkspaceRegistryV1> {
  return value ?? Object.freeze({
    formatVersion: 1 as const,
    activeWorkspaceId: null,
    workspaces: Object.freeze([]),
  });
}

export function assertWorkspaceIdAvailable(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): void {
  if (registry.workspaces.length >= WORKSPACE_REGISTRY_MAX_ENTRIES) {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_CAPACITY_EXCEEDED',
      'identityGeneration',
    );
  }
  if (registry.workspaces.some((entry) => entry.workspaceId === workspaceId)) {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_CONFLICT',
      'identityGeneration',
    );
  }
}

export function assertLineageAvailable(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  lineageIdentity: Readonly<WorkspaceLineageIdentityV1>,
): void {
  if (
    registry.workspaces.some(
      (entry) =>
        entry.lineageIdentity.profileId === lineageIdentity.profileId,
    )
  ) {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_CONFLICT',
      'bootstrap',
    );
  }
}

export function publishWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistryV1> {
  assertWorkspaceIdAvailable(registry, entry.workspaceId);
  assertLineageAvailable(registry, entry.lineageIdentity);
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId: registry.activeWorkspaceId ?? entry.workspaceId,
    workspaces: Object.freeze([...registry.workspaces, entry]),
  });
}

export function createReadyWorkspaceEntry(input: {
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  readonly createdAt: string;
}): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    workspaceId: input.workspaceId,
    workspaceLabel: input.workspaceLabel,
    lineageIdentity: input.lineageIdentity,
    layoutVersion: 1,
    lifecycleState: 'ready',
    createdAt: input.createdAt,
  });
}

export function findWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> | undefined {
  return registry.workspaces.find((entry) => entry.workspaceId === workspaceId);
}

export function assertRegistryStillAtPreviousActive(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  previousActiveWorkspaceId: WorkspaceId | null,
): void {
  if (registry.activeWorkspaceId !== previousActiveWorkspaceId) {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      'recovery',
    );
  }
}
