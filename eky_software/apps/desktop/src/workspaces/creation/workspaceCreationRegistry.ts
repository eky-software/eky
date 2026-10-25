import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistry,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import {
  appendReadyWorkspaceEntry,
  assertActiveWorkspaceUnchanged,
  assertWorkspaceIdAvailable as assertRegistryWorkspaceIdAvailable,
  assertWorkspaceLineageAvailable,
  assertWorkspaceLabelAvailable,
  createReadyWorkspaceEntry as createRegistryReadyWorkspaceEntry,
  findWorkspaceEntry as findRegistryWorkspaceEntry,
  readWorkspaceRegistry,
  WorkspaceRegistryMutationError,
} from '../registry/workspaceRegistryMutations.js';
import { EmptyWorkspaceCreationError } from './emptyWorkspaceCreationError.js';

export function readCreationRegistry(
  value: Readonly<LocalWorkspaceRegistry> | undefined,
): Readonly<LocalWorkspaceRegistry> {
  return readWorkspaceRegistry(value);
}

export function assertWorkspaceIdAvailable(
  registry: Readonly<LocalWorkspaceRegistry>,
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
  registry: Readonly<LocalWorkspaceRegistry>,
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
  registry: Readonly<LocalWorkspaceRegistry>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistry> {
  try {
    return appendReadyWorkspaceEntry(registry, entry);
  } catch (error) {
    if (error instanceof WorkspaceRegistryMutationError && error.failure === 'workspaceLabelExists') {
      throw new EmptyWorkspaceCreationError('WORKSPACE_CREATION_LABEL_EXISTS', 'registryPublish');
    }
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

export function assertCreationWorkspaceLabelAvailable(
  registry: Readonly<LocalWorkspaceRegistry>,
  workspaceLabel: string,
  stage: 'inputValidation' | 'registryPublish',
): void {
  try {
    assertWorkspaceLabelAvailable(registry, workspaceLabel);
  } catch (error) {
    if (error instanceof WorkspaceRegistryMutationError && error.failure === 'workspaceLabelExists') {
      throw new EmptyWorkspaceCreationError('WORKSPACE_CREATION_LABEL_EXISTS', stage);
    }
    throw error;
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
  registry: Readonly<LocalWorkspaceRegistry>,
  workspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> | undefined {
  return findRegistryWorkspaceEntry(registry, workspaceId);
}

export function assertRegistryStillAtPreviousActive(
  registry: Readonly<LocalWorkspaceRegistry>,
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
