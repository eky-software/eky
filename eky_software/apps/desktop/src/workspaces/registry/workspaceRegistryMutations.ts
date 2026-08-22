import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from './workspaceRegistryTypes.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from './workspaceRegistryValidation.js';

export type WorkspaceRegistryMutationFailure =
  | 'activeWorkspaceChanged'
  | 'capacityExceeded'
  | 'lineageExists'
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
    throw new WorkspaceRegistryMutationError('capacityExceeded');
  }
  if (registry.workspaces.some((entry) => entry.workspaceId === workspaceId)) {
    throw new WorkspaceRegistryMutationError('workspaceIdExists');
  }
}

export function assertWorkspaceLineageAvailable(
  registry: Readonly<LocalWorkspaceRegistryV1>,
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
  registry: Readonly<LocalWorkspaceRegistryV1>,
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
): Readonly<LocalWorkspaceRegistryV1> {
  assertWorkspaceIdAvailable(registry, entry.workspaceId);
  assertWorkspaceLineageAvailable(registry, entry.lineageIdentity);
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

export function assertActiveWorkspaceUnchanged(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  expectedActiveWorkspaceId: WorkspaceId | null,
): void {
  if (registry.activeWorkspaceId !== expectedActiveWorkspaceId) {
    throw new WorkspaceRegistryMutationError('activeWorkspaceChanged');
  }
}

export function selectActiveWorkspace(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  expectedActiveWorkspaceId: WorkspaceId,
  targetWorkspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryV1> {
  assertActiveWorkspaceUnchanged(registry, expectedActiveWorkspaceId);
  const target = findWorkspaceEntry(registry, targetWorkspaceId);
  if (target === undefined) {
    throw new WorkspaceRegistryMutationError('workspaceNotFound');
  }
  if (target.lifecycleState !== 'ready') {
    throw new WorkspaceRegistryMutationError('workspaceNotReady');
  }
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId: target.workspaceId,
    workspaces: registry.workspaces,
  });
}

export function selectSourceAndRequireTargetRecovery(input: {
  readonly registry: Readonly<LocalWorkspaceRegistryV1>;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
}): Readonly<LocalWorkspaceRegistryV1> {
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
    formatVersion: 1,
    activeWorkspaceId: input.sourceWorkspaceId,
    workspaces: Object.freeze(workspaces),
  });
}

export function renameWorkspaceLabel(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
  workspaceLabel: string,
): Readonly<LocalWorkspaceRegistryV1> {
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
  const workspaces = [...registry.workspaces];
  workspaces[targetIndex] = Object.freeze({ ...current, workspaceLabel });
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId: registry.activeWorkspaceId,
    workspaces: Object.freeze(workspaces),
  });
}
