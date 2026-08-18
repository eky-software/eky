import { workspaceRegistryInvalid } from './workspaceRegistryError.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
  WorkspaceLifecycleState,
} from './workspaceRegistryTypes.js';
import { validateWorkspaceId } from './workspaceIdValidation.js';
import { validateWorkspaceLabel } from './workspaceLabelValidation.js';
import { validateWorkspaceLineage } from './workspaceLineageValidation.js';
import { validateWorkspaceTimestamp } from './workspaceTimestampValidation.js';
import { hasExactDataKeys, isPlainDataRecord } from './workspaceRegistryValueShape.js';

export const WORKSPACE_REGISTRY_MAX_ENTRIES = 64;

const registryKeys = ['formatVersion', 'activeWorkspaceId', 'workspaces'] as const;
const entryKeys = [
  'workspaceId',
  'workspaceLabel',
  'lineageIdentity',
  'layoutVersion',
  'lifecycleState',
  'createdAt',
] as const;

export function validateWorkspaceRegistry(
  value: unknown,
): Readonly<LocalWorkspaceRegistryV1> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, registryKeys) ||
    value.formatVersion !== 1 ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length > WORKSPACE_REGISTRY_MAX_ENTRIES
  ) {
    return workspaceRegistryInvalid();
  }

  const entries = value.workspaces.map(validateWorkspaceRegistryEntry);
  assertUniqueIdentities(entries);

  const readyIds = new Set(
    entries
      .filter((entry) => entry.lifecycleState === 'ready')
      .map((entry) => entry.workspaceId),
  );
  const activeWorkspaceId = validateActiveWorkspaceId(
    value.activeWorkspaceId,
    readyIds,
  );

  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId,
    workspaces: Object.freeze(entries),
  });
}

function validateWorkspaceRegistryEntry(
  value: unknown,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, entryKeys) ||
    value.layoutVersion !== 1 ||
    !isWorkspaceLifecycleState(value.lifecycleState)
  ) {
    return workspaceRegistryInvalid();
  }
  return Object.freeze({
    workspaceId: validateWorkspaceId(value.workspaceId),
    workspaceLabel: validateWorkspaceLabel(value.workspaceLabel),
    lineageIdentity: validateWorkspaceLineage(value.lineageIdentity),
    layoutVersion: 1,
    lifecycleState: value.lifecycleState,
    createdAt: validateWorkspaceTimestamp(value.createdAt),
  });
}

function validateActiveWorkspaceId(
  value: unknown,
  readyIds: ReadonlySet<WorkspaceId>,
): WorkspaceId | null {
  if (readyIds.size === 0) {
    if (value !== null) {
      return workspaceRegistryInvalid();
    }
    return null;
  }
  const workspaceId = validateWorkspaceId(value);
  if (!readyIds.has(workspaceId)) {
    return workspaceRegistryInvalid();
  }
  return workspaceId;
}

function assertUniqueIdentities(
  entries: readonly Readonly<LocalWorkspaceRegistryEntryV1>[],
): void {
  const workspaceIds = new Set<string>();
  const profileIds = new Set<string>();
  for (const entry of entries) {
    if (
      workspaceIds.has(entry.workspaceId) ||
      profileIds.has(entry.lineageIdentity.profileId)
    ) {
      return workspaceRegistryInvalid();
    }
    workspaceIds.add(entry.workspaceId);
    profileIds.add(entry.lineageIdentity.profileId);
  }
}

function isWorkspaceLifecycleState(
  value: unknown,
): value is WorkspaceLifecycleState {
  return value === 'ready' || value === 'recoveryRequired';
}
