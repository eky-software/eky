import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import {
  appendReadyWorkspaceEntry,
  assertActiveWorkspaceUnchanged,
  assertWorkspaceIdAvailable,
  assertWorkspaceLineageAvailable,
  createReadyWorkspaceEntry,
  findWorkspaceEntry,
  readWorkspaceRegistry,
  WorkspaceRegistryMutationError,
} from '../registry/workspaceRegistryMutations.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';

export function readWorkspaceBackupImportRegistry(
  value: Readonly<LocalWorkspaceRegistryV1> | undefined,
): Readonly<LocalWorkspaceRegistryV1> {
  return readWorkspaceRegistry(value);
}

export function assertImportLineageAvailable(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  lineageIdentity: Readonly<WorkspaceLineageIdentityV1>,
): void {
  try {
    assertWorkspaceLineageAvailable(registry, lineageIdentity);
  } catch {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_LINEAGE_EXISTS',
      'lineageCheck',
    );
  }
}

export function assertImportWorkspaceIdAvailable(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): void {
  try {
    assertWorkspaceIdAvailable(registry, workspaceId);
  } catch (error) {
    if (
      error instanceof WorkspaceRegistryMutationError &&
      error.failure === 'capacityExceeded'
    ) {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_CAPACITY_EXCEEDED',
        'identityGeneration',
      );
    }
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_CONFLICT',
      'identityGeneration',
    );
  }
}

export function assertImportRegistryStillAtPreviousActive(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  previousActiveWorkspaceId: WorkspaceId | null,
): void {
  try {
    assertActiveWorkspaceUnchanged(registry, previousActiveWorkspaceId);
  } catch {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'recovery',
    );
  }
}

export function publishImportedWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistryV1> {
  try {
    return appendReadyWorkspaceEntry(registry, entry);
  } catch (error) {
    if (error instanceof WorkspaceRegistryMutationError) {
      if (error.failure === 'capacityExceeded') {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_CAPACITY_EXCEEDED',
          'registryPublish',
        );
      }
      if (error.failure === 'lineageExists') {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_LINEAGE_EXISTS',
          'lineageCheck',
        );
      }
    }
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_CONFLICT',
      'registryPublish',
    );
  }
}

export function createImportedWorkspaceEntry(input: {
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  readonly createdAt: string;
}): Readonly<LocalWorkspaceRegistryEntryV1> {
  return createReadyWorkspaceEntry(input);
}

export function findImportedWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> | undefined {
  return findWorkspaceEntry(registry, workspaceId);
}
