import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';

export interface WorkspaceReplacementTarget {
  readonly entry: Readonly<LocalWorkspaceRegistryEntryV1>;
  readonly registrySnapshot: Uint8Array;
}

export function validateWorkspaceReplacementTarget(
  value: Readonly<LocalWorkspaceRegistryV1> | undefined,
  targetWorkspaceId: unknown,
): Readonly<WorkspaceReplacementTarget> {
  let workspaceId: WorkspaceId;
  let registrySnapshot: Uint8Array;
  try {
    workspaceId = validateWorkspaceId(targetWorkspaceId);
    if (value === undefined) throw new Error('missing');
    registrySnapshot = serializeWorkspaceRegistry(value);
  } catch {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_TARGET_INELIGIBLE',
      'targetValidation',
    );
  }

  const entries = value.workspaces.filter(
    (entry) => entry.workspaceId === workspaceId,
  );
  if (
    value.activeWorkspaceId !== workspaceId ||
    entries.length !== 1 ||
    entries[0]?.lifecycleState !== 'ready'
  ) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_TARGET_INELIGIBLE',
      'targetValidation',
    );
  }
  const entry = entries[0];
  const lineageCount = value.workspaces.filter(
    (candidate) =>
      candidate.lineageIdentity.profileId ===
      entry.lineageIdentity.profileId,
  ).length;
  if (lineageCount !== 1) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_TARGET_INELIGIBLE',
      'targetValidation',
    );
  }
  return Object.freeze({ entry, registrySnapshot });
}

export function assertWorkspaceReplacementLineage(
  target: Readonly<LocalWorkspaceRegistryEntryV1>,
  backupProfileId: string,
): void {
  if (backupProfileId !== target.lineageIdentity.profileId) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
      'lineageCheck',
    );
  }
}

export function assertWorkspaceReplacementRegistryUnchanged(
  expectedSnapshot: Uint8Array,
  current: Readonly<LocalWorkspaceRegistryV1> | undefined,
): void {
  try {
    if (current === undefined) throw new Error('missing');
    const currentSnapshot = serializeWorkspaceRegistry(current);
    if (!bytesEqual(expectedSnapshot, currentSnapshot)) {
      throw new Error('changed');
    }
  } catch {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
      'registryInvariant',
    );
  }
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}
