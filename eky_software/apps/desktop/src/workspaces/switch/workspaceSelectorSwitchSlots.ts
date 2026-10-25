import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryV2 } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import {
  assertWorkspaceSwitchTransition, parseVersionedWorkspaceSwitchJournalBytes,
  type WorkspaceSwitchJournal, type WorkspaceSwitchJournalV2,
} from './workspaceSwitchJournalCodec.js';
import {
  classifyWorkspaceSelectorSwitch, classifyWorkspaceSelectorSwitchRegistry,
  type WorkspaceSelectorSwitchMode,
} from './workspaceSelectorSwitchState.js';

type Slots<T> = Partial<Record<'current' | 'next' | 'backup', Readonly<T>>>;
export interface WorkspaceSelectorSwitchSlotPlan {
  readonly mode: WorkspaceSelectorSwitchMode | 'unpublishedPreparation';
  readonly journal: Readonly<WorkspaceSwitchJournalV2>;
  readonly registry: Readonly<LocalWorkspaceRegistryV2>;
}

// A pure read-admission plan. Mutating owners must revalidate these exact
// selections and their live authority inside each write/repair/clear boundary.
export function planWorkspaceSelectorSwitchSlots(
  journalSlots: ReadOnlyJournalSlots<WorkspaceSwitchJournal>,
  registrySlots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>,
): Readonly<WorkspaceSelectorSwitchSlotPlan> {
  const journals: Slots<WorkspaceSwitchJournalV2> = {};
  const registries: Slots<LocalWorkspaceRegistryV2> = {};
  for (const slot of ['current', 'next', 'backup'] as const) {
    const journalBytes = journalSlots[slot]?.bytes;
    const registryBytes = registrySlots[slot]?.bytes;
    if (journalBytes !== undefined) {
      const value = parseVersionedWorkspaceSwitchJournalBytes(journalBytes);
      if (value.formatVersion !== 2) invalid();
      journals[slot] = value;
    }
    if (registryBytes !== undefined) {
      const value = parseWorkspaceRegistryBytes(registryBytes);
      if (value.formatVersion !== 2) invalid();
      registries[slot] = value;
    }
  }
  const selectedJournal = selectPublished(journals, assertWorkspaceSwitchTransition);
  const journal = selectedJournal ?? journals.next;
  if (journal === undefined) invalid();
  const registryKind = (value: Readonly<LocalWorkspaceRegistryV2>) =>
    classifyWorkspaceSelectorSwitchRegistry(journal, value);
  for (const registry of Object.values(registries)) registryKind(registry);
  const selectedRegistry = selectPublished(registries, (from, to) => {
    const source = registryKind(from);
    const target = registryKind(to);
    if (source === target) return;
    if (source === 'before' && target === 'selected' && journal.state === 'prepared') return;
    if (source === 'selected' && target === 'before' &&
      (journal.state === 'prepared' || journal.state === 'targetSelected')) return;
    if (source === 'selected' && target === 'rejected' && journal.state === 'targetSelected') return;
    invalid();
  });
  if (selectedRegistry === undefined || (hasUnsettledSlots(journals) && hasUnsettledSlots(registries))) invalid();

  const assertPublicationOrder = (from: Readonly<WorkspaceSwitchJournalV2>, to: Readonly<WorkspaceSwitchJournalV2>) => {
    if (from.state === to.state) return;
    const kind = registryKind(selectedRegistry);
    if (to.state === 'targetSelected' && kind !== 'selected') invalid();
    if (to.state === 'rollbackSelected' && (kind === 'selected' ||
      (from.state === 'prepared' && kind !== 'before'))) invalid();
    if (to.state === 'recoveryRequired') classifyWorkspaceSelectorSwitch(from, selectedRegistry);
  };
  if (journals.current !== undefined && journals.backup !== undefined) {
    assertPublicationOrder(journals.backup, journals.current);
  }
  if (journals.next !== undefined && selectedJournal !== undefined) {
    assertPublicationOrder(selectedJournal, journals.next);
  }
  if (selectedJournal === undefined) {
    if (journal.state !== 'prepared' || registryKind(selectedRegistry) !== 'before' || hasUnsettledSlots(registries)) invalid();
    return Object.freeze({ mode: 'unpublishedPreparation', journal, registry: selectedRegistry });
  }
  return Object.freeze({
    mode: classifyWorkspaceSelectorSwitch(selectedJournal, selectedRegistry),
    journal: selectedJournal, registry: selectedRegistry,
  });
}

function selectPublished<T>(slots: Slots<T>, follows: (from: Readonly<T>, to: Readonly<T>) => void): Readonly<T> | undefined {
  const { current, next, backup } = slots;
  if (current !== undefined) {
    if (next !== undefined && backup !== undefined) invalid();
    if (backup !== undefined) follows(backup, current);
    if (next !== undefined) follows(current, next);
    return current;
  }
  if (backup !== undefined) {
    if (next !== undefined) follows(backup, next);
    return backup;
  }
  return undefined;
}

function hasUnsettledSlots<T>(slots: Slots<T>): boolean {
  return slots.current === undefined || slots.next !== undefined || slots.backup !== undefined;
}

function invalid(): never {
  throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
}
