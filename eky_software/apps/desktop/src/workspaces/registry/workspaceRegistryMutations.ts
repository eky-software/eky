import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistry,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from './workspaceRegistryTypes.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from './workspaceRegistryValidation.js';
import { hasWorkspaceLabelConflict } from './workspaceLabelComparison.js';
import { validateWorkspaceLabel } from './workspaceLabelValidation.js';

export type WorkspaceRegistryMutationFailure =
  | 'activeWorkspaceChanged'
  | 'capacityExceeded'
  | 'lineageExists'
  | 'workspaceLabelExists'
  | 'workspaceNotFound'
  | 'workspaceNotReady'
  | 'workspaceIdExists';

export class WorkspaceRegistryMutationError extends Error {
  constructor(readonly failure: WorkspaceRegistryMutationFailure) {
    super('WORKSPACE_REGISTRY_MUTATION_REJECTED');
    this.name = 'WorkspaceRegistryMutationError';
  }
}

export function readWorkspaceRegistry(
  value: Readonly<LocalWorkspaceRegistry> | undefined,
): Readonly<LocalWorkspaceRegistry> {
  return value ?? Object.freeze({
    formatVersion: 1 as const,
    activeWorkspaceId: null,
    workspaces: Object.freeze([]),
  });
}

export function assertWorkspaceIdAvailable(
  registry: Readonly<LocalWorkspaceRegistry>,
  workspaceId: WorkspaceId,
): void {
  if (registry.workspaces.length >= WORKSPACE_REGISTRY_MAX_ENTRIES) {
    throw new WorkspaceRegistryMutationError('capacityExceeded');
  }
  if (registry.workspaces.some((entry) => entry.workspaceId === workspaceId)) {
    throw new WorkspaceRegistryMutationError('workspaceIdExists');
  }
}

export function assertWorkspaceLineageAvailable(
  registry: Readonly<LocalWorkspaceRegistry>,
  lineageIdentity: Readonly<WorkspaceLineageIdentityV1>,
): void {
  if (
    registry.workspaces.some(
      (entry) =>
        entry.lineageIdentity.profileId === lineageIdentity.profileId,
    )
  ) {
    throw new WorkspaceRegistryMutationError('lineageExists');
  }
}

export function appendReadyWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistry>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistry> {
  const next = appendIdentityCheckedWorkspaceEntry(registry, entry);
  assertWorkspaceLabelAvailable(registry, entry.workspaceLabel);
  return next;
}

// The recovery owner must first prove the journal-bound root and its contents.
// A historical label collision must not strand that already published root.
export function appendRecoveredWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistry>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistry> {
  return appendIdentityCheckedWorkspaceEntry(registry, entry);
}

function appendIdentityCheckedWorkspaceEntry(
  registry: Readonly<LocalWorkspaceRegistry>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistry> {
  assertWorkspaceIdAvailable(registry, entry.workspaceId);
  assertWorkspaceLineageAvailable(registry, entry.lineageIdentity);
  return Object.freeze({
    formatVersion: registry.formatVersion,
    activeWorkspaceId: workspaceSelectionAfterPublication(
      registry.formatVersion, registry.activeWorkspaceId, entry.workspaceId,
    ),
    workspaces: Object.freeze([...registry.workspaces, entry]),
  });
}

export function workspaceSelectionAfterPublication(
  formatVersion: LocalWorkspaceRegistry['formatVersion'],
  previousActiveWorkspaceId: WorkspaceId | null,
  publishedWorkspaceId: WorkspaceId,
): WorkspaceId | null {
  return formatVersion === 1
    ? previousActiveWorkspaceId ?? publishedWorkspaceId
    : previousActiveWorkspaceId;
}

export function assertWorkspaceLabelAvailable(
  registry: Readonly<LocalWorkspaceRegistry>,
  workspaceLabel: string,
  exceptWorkspaceId?: WorkspaceId,
): void {
  if (hasWorkspaceLabelConflict(registry.workspaces, workspaceLabel, exceptWorkspaceId)) {
    throw new WorkspaceRegistryMutationError('workspaceLabelExists');
  }
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
  registry: Readonly<LocalWorkspaceRegistry>,
  workspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> | undefined {
  return registry.workspaces.find((entry) => entry.workspaceId === workspaceId);
}

export function assertActiveWorkspaceUnchanged(
  registry: Readonly<LocalWorkspaceRegistry>,
  expectedActiveWorkspaceId: WorkspaceId | null,
): void {
  if (registry.activeWorkspaceId !== expectedActiveWorkspaceId) {
    throw new WorkspaceRegistryMutationError('activeWorkspaceChanged');
  }
}

export function selectActiveWorkspace(
  registry: Readonly<LocalWorkspaceRegistry>,
  expectedActiveWorkspaceId: WorkspaceId,
  targetWorkspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistry> {
  assertActiveWorkspaceUnchanged(registry, expectedActiveWorkspaceId);
  const target = findWorkspaceEntry(registry, targetWorkspaceId);
  if (target === undefined) {
    throw new WorkspaceRegistryMutationError('workspaceNotFound');
  }
  if (target.lifecycleState !== 'ready') {
    throw new WorkspaceRegistryMutationError('workspaceNotReady');
  }
  return Object.freeze({
    formatVersion: registry.formatVersion,
    activeWorkspaceId: target.workspaceId,
    workspaces: registry.workspaces,
  });
}

export function selectSourceAndRequireTargetRecovery(input: {
  readonly registry: Readonly<LocalWorkspaceRegistry>;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
}): Readonly<LocalWorkspaceRegistry> {
  assertActiveWorkspaceUnchanged(
    input.registry,
    input.targetWorkspaceId,
  );
  const source = findWorkspaceEntry(
    input.registry,
    input.sourceWorkspaceId,
  );
  const targetIndex = input.registry.workspaces.findIndex(
    (entry) => entry.workspaceId === input.targetWorkspaceId,
  );
  if (source === undefined || targetIndex === -1) {
    throw new WorkspaceRegistryMutationError('workspaceNotFound');
  }
  if (
    source.lifecycleState !== 'ready' ||
    input.registry.workspaces[targetIndex]!.lifecycleState !== 'ready'
  ) {
    throw new WorkspaceRegistryMutationError('workspaceNotReady');
  }
  const workspaces = [...input.registry.workspaces];
  workspaces[targetIndex] = Object.freeze({
    ...workspaces[targetIndex]!,
    lifecycleState: 'recoveryRequired',
  });
  return Object.freeze({
    formatVersion: input.registry.formatVersion,
    activeWorkspaceId: input.sourceWorkspaceId,
    workspaces: Object.freeze(workspaces),
  });
}

export function renameWorkspaceLabel(
  registry: Readonly<LocalWorkspaceRegistry>,
  workspaceId: WorkspaceId,
  workspaceLabel: string,
): Readonly<LocalWorkspaceRegistry> {
  validateWorkspaceLabel(workspaceLabel);
  const targetIndex = registry.workspaces.findIndex(
    (entry) => entry.workspaceId === workspaceId,
  );
  if (targetIndex === -1) {
    throw new WorkspaceRegistryMutationError('workspaceNotFound');
  }
  const current = registry.workspaces[targetIndex]!;
  if (current.workspaceLabel === workspaceLabel) {
    return registry;
  }
  assertWorkspaceLabelAvailable(registry, workspaceLabel, workspaceId);
  const workspaces = [...registry.workspaces];
  workspaces[targetIndex] = Object.freeze({ ...current, workspaceLabel });
  return Object.freeze({
    formatVersion: registry.formatVersion,
    activeWorkspaceId: registry.activeWorkspaceId,
    workspaces: Object.freeze(workspaces),
  });
}
