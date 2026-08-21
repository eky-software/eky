import { createHash } from 'node:crypto';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { WorkspaceFirstStartMigrationTransitionError } from './workspaceFirstStartMigrationJournalError.js';
import { validateWorkspaceFirstStartMigrationSha256 } from './workspaceFirstStartMigrationJournalCodec.js';

export function calculateWorkspaceRegistrySha256(
  registry: Readonly<LocalWorkspaceRegistryV1>,
): string {
  return createHash('sha256')
    .update(serializeWorkspaceRegistry(registry))
    .digest('hex');
}

export function markPassiveWorkspacesRecoveryRequired(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  expectedActiveWorkspaceId: WorkspaceId,
  passiveRecoveryWorkspaceIds: readonly WorkspaceId[],
): Readonly<LocalWorkspaceRegistryV1> {
  try {
    validateWorkspaceRegistry(registry);
    const activeWorkspaceId = validateWorkspaceId(expectedActiveWorkspaceId);
    const passiveIds = validatePassiveWorkspaceIds(
      passiveRecoveryWorkspaceIds,
      activeWorkspaceId,
    );
    if (registry.activeWorkspaceId !== activeWorkspaceId) {
      return invalidTransition();
    }
    if (passiveIds.length === 0) return registry;

    const passiveIdSet = new Set<WorkspaceId>(passiveIds);
    for (const workspaceId of passiveIds) {
      const entry = registry.workspaces.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (entry === undefined || entry.lifecycleState !== 'ready') {
        return invalidTransition();
      }
    }
    const workspaces = registry.workspaces.map((entry) =>
      passiveIdSet.has(entry.workspaceId)
        ? freezeEntryWithLifecycle(entry, 'recoveryRequired')
        : entry,
    );
    return validateWorkspaceRegistry({
      formatVersion: 1,
      activeWorkspaceId: registry.activeWorkspaceId,
      workspaces,
    });
  } catch (error) {
    if (error instanceof WorkspaceFirstStartMigrationTransitionError) {
      throw error;
    }
    return invalidTransition();
  }
}

export function restoreJournaledPassiveWorkspacesReady(input: {
  readonly registry: Readonly<LocalWorkspaceRegistryV1>;
  readonly expectedActiveWorkspaceId: WorkspaceId;
  readonly passiveRecoveryWorkspaceIds: readonly WorkspaceId[];
  readonly sourceRegistrySha256: string;
  readonly transitionedRegistrySha256: string;
}): Readonly<LocalWorkspaceRegistryV1> {
  try {
    validateWorkspaceRegistry(input.registry);
    const activeWorkspaceId = validateWorkspaceId(
      input.expectedActiveWorkspaceId,
    );
    const passiveIds = validatePassiveWorkspaceIds(
      input.passiveRecoveryWorkspaceIds,
      activeWorkspaceId,
    );
    const sourceSha256 = validateWorkspaceFirstStartMigrationSha256(
      input.sourceRegistrySha256,
    );
    const transitionedSha256 = validateWorkspaceFirstStartMigrationSha256(
      input.transitionedRegistrySha256,
    );
    if (
      input.registry.activeWorkspaceId !== activeWorkspaceId ||
      calculateWorkspaceRegistrySha256(input.registry) !== transitionedSha256
    ) {
      return recoveryRequired();
    }

    const passiveIdSet = new Set<WorkspaceId>(passiveIds);
    for (const workspaceId of passiveIds) {
      const entry = input.registry.workspaces.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (entry?.lifecycleState !== 'recoveryRequired') {
        return recoveryRequired();
      }
    }
    const workspaces = input.registry.workspaces.map((entry) =>
      passiveIdSet.has(entry.workspaceId)
        ? freezeEntryWithLifecycle(entry, 'ready')
        : entry,
    );
    const restored = validateWorkspaceRegistry({
      formatVersion: 1,
      activeWorkspaceId: input.registry.activeWorkspaceId,
      workspaces,
    });
    if (calculateWorkspaceRegistrySha256(restored) !== sourceSha256) {
      return recoveryRequired();
    }
    return restored;
  } catch (error) {
    if (error instanceof WorkspaceFirstStartMigrationTransitionError) {
      throw error;
    }
    return invalidTransition();
  }
}

function validatePassiveWorkspaceIds(
  values: readonly WorkspaceId[],
  activeWorkspaceId: WorkspaceId,
): readonly WorkspaceId[] {
  if (!Array.isArray(values) || values.length > 63) {
    return invalidTransition();
  }
  const validated = values.map(validateWorkspaceId);
  for (let index = 0; index < validated.length; index += 1) {
    const current = validated[index]!;
    if (
      current === activeWorkspaceId ||
      (index > 0 && validated[index - 1]! >= current)
    ) {
      return invalidTransition();
    }
  }
  return validated;
}

function freezeEntryWithLifecycle(
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
  lifecycleState: 'ready' | 'recoveryRequired',
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    workspaceId: entry.workspaceId,
    workspaceLabel: entry.workspaceLabel,
    lineageIdentity: entry.lineageIdentity,
    layoutVersion: 1,
    lifecycleState,
    createdAt: entry.createdAt,
  });
}

function invalidTransition(): never {
  throw new WorkspaceFirstStartMigrationTransitionError('invalid');
}

function recoveryRequired(): never {
  throw new WorkspaceFirstStartMigrationTransitionError('recoveryRequired');
}
