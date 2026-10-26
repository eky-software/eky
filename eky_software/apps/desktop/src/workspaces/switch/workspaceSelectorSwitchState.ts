import { createHash } from 'node:crypto';

import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistryV2, WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import { validateVersionedWorkspaceSwitchJournal, type WorkspaceSwitchJournalV2 } from './workspaceSwitchJournalCodec.js';

export type WorkspaceSelectorSwitchRegistryKind = 'before' | 'selected' | 'rejected';
export type WorkspaceSelectorSwitchMode =
  | 'selectorUncommitted' | 'completeSelection' | 'validateTarget'
  | 'completeReturn' | 'selectorReturned' | 'recoveryRequired';

export function createWorkspaceSelectorSwitchJournal(
  value: unknown, targetWorkspaceId: WorkspaceId, operationId: string, createdAt: string,
): Readonly<WorkspaceSwitchJournalV2> {
  const registry = validateWorkspaceRegistry(value);
  if (registry.formatVersion !== 2 || registry.activeWorkspaceId !== null ||
    !registry.workspaces.some(entry => entry.workspaceId === targetWorkspaceId && entry.lifecycleState === 'ready')) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  const variants = createWorkspaceSelectorSwitchRegistryVariants(registry, targetWorkspaceId);
  const journal = validateVersionedWorkspaceSwitchJournal({
    formatVersion: 2, operationId, sourceWorkspaceId: null, targetWorkspaceId,
    state: 'prepared', createdAt,
    registryBeforeSha256: digest(variants.before),
    registrySelectedSha256: digest(variants.selected),
    registryRejectedSha256: digest(variants.rejected),
  });
  if (journal.formatVersion !== 2) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  return journal;
}

// These are the three permitted projections, not proof of runtime exit or
// permission to publish a selection or mark a workspace invalid.
export function createWorkspaceSelectorSwitchRegistryVariants(value: unknown, target: WorkspaceId) {
  const registry = validateWorkspaceRegistry(value);
  if (registry.formatVersion !== 2 || (registry.activeWorkspaceId !== null && registry.activeWorkspaceId !== target) ||
    !registry.workspaces.some(entry => entry.workspaceId === target)) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  const before = requireV2({ ...registry, activeWorkspaceId: null, workspaces: registry.workspaces.map(entry =>
    entry.workspaceId === target ? { ...entry, lifecycleState: 'ready' } : entry) });
  const selected = requireV2({ ...before, activeWorkspaceId: target });
  const rejected = requireV2({ ...before, workspaces: before.workspaces.map(entry =>
    entry.workspaceId === target ? { ...entry, lifecycleState: 'recoveryRequired' } : entry) });
  return Object.freeze({ before, selected, rejected });
}

export function classifyWorkspaceSelectorSwitchRegistry(
  journal: Readonly<WorkspaceSwitchJournalV2>, registry: Readonly<LocalWorkspaceRegistryV2>,
): WorkspaceSelectorSwitchRegistryKind {
  const variants = createWorkspaceSelectorSwitchRegistryVariants(registry, journal.targetWorkspaceId);
  if (journal.registryBeforeSha256 !== digest(variants.before) ||
    journal.registrySelectedSha256 !== digest(variants.selected) ||
    journal.registryRejectedSha256 !== digest(variants.rejected)) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  const actual = digest(registry);
  if (actual === journal.registryBeforeSha256) return 'before';
  if (actual === journal.registrySelectedSha256) return 'selected';
  if (actual === journal.registryRejectedSha256) return 'rejected';
  throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
}

export function classifyWorkspaceSelectorSwitch(
  journal: Readonly<WorkspaceSwitchJournalV2>, registry: Readonly<LocalWorkspaceRegistryV2>,
): WorkspaceSelectorSwitchMode {
  const kind = classifyWorkspaceSelectorSwitchRegistry(journal, registry);
  if (journal.state === 'recoveryRequired') return 'recoveryRequired';
  if (journal.state === 'prepared' && kind === 'before') return 'selectorUncommitted';
  if (journal.state === 'prepared' && kind === 'selected') return 'completeSelection';
  if (journal.state === 'targetSelected') return kind === 'selected' ? 'validateTarget' : 'completeReturn';
  if (journal.state === 'rollbackSelected' && kind !== 'selected') return 'selectorReturned';
  throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
}

function requireV2(value: unknown): Readonly<LocalWorkspaceRegistryV2> {
  const registry = validateWorkspaceRegistry(value);
  if (registry.formatVersion !== 2) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  return registry;
}

function digest(registry: Readonly<LocalWorkspaceRegistryV2>): string {
  return createHash('sha256').update(serializeWorkspaceRegistry(registry)).digest('hex');
}
