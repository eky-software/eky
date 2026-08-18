import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import {
  appendReadyWorkspaceEntry,
  assertActiveWorkspaceUnchanged,
  assertWorkspaceIdAvailable as assertRegistryWorkspaceIdAvailable,
  assertWorkspaceLineageAvailable,
  createReadyWorkspaceEntry as createRegistryReadyWorkspaceEntry,
  findWorkspaceEntry as findRegistryWorkspaceEntry,
  readWorkspaceRegistry,
  WorkspaceRegistryMutationError,
} from '../registry/workspaceRegistryMutations.js';
import { EmptyWorkspaceCreationError } from './emptyWorkspaceCreationError.js';

export function readCreationRegistry(
  value: Readonly<LocalWorkspaceRegistryV1> | undefined,
): Readonly<LocalWorkspaceRegistryV1> {
  return readWorkspaceRegistry(value);
}

export function assertWorkspaceIdAvailable(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): void {
  try {
    assertRegistryWorkspaceIdAvailable(registry, workspaceId);
  } catch (error) {
    if (
      error instanceof WorkspaceRegistryMutationError &&
      error.failure === 'capacityExceeded'
    ) {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_CAPACITY_EXCEEDED',
        'identityGeneration',
      );
    }
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
  try {
    assertWorkspaceLineageAvailable(registry, lineageIdentity);
  } catch {
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
  try {
    return appendReadyWorkspaceEntry(registry, entry);
  } catch (error) {
    if (
      error instanceof WorkspaceRegistryMutationError &&
      error.failure === 'capacityExceeded'
    ) {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_CAPACITY_EXCEEDED',
        'identityGeneration',
      );
    }
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_CONFLICT',
      'bootstrap',
    );
  }
}

export function createReadyWorkspaceEntry(input: {
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  readonly createdAt: string;
}): Readonly<LocalWorkspaceRegistryEntryV1> {
  return createRegistryReadyWorkspaceEntry(input);
}

export function findWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> | undefined {
  return findRegistryWorkspaceEntry(registry, workspaceId);
}

export function assertRegistryStillAtPreviousActive(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  previousActiveWorkspaceId: WorkspaceId | null,
): void {
  try {
    assertActiveWorkspaceUnchanged(registry, previousActiveWorkspaceId);
  } catch {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      'recovery',
    );
  }
}
