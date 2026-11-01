import { isAbsolute, join, resolve } from 'node:path';
import { CrashSafeByteSlotStore, type CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import {
  captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, parseWorkspaceDeletionJournalBytes,
  sameWorkspaceDeletionJournalBinding, serializeWorkspaceDeletionJournal, workspaceDeletionPhases,
  type WorkspaceDeletionJournalV1,
} from './workspaceDeletionJournalCodec.js';
import { inspectWorkspaceDeletionJournal, planWorkspaceDeletionJournalSlots } from './workspaceDeletionJournalSlots.js';

export const workspaceDeletionJournalFileName = 'workspace-deletion-journal-v1.json';
const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export interface WorkspaceDeletionJournalSelection {
  readonly slots: ReadOnlyJournalSlots<WorkspaceDeletionJournalV1>;
  assertAuthority(): void;
  // The owner revalidates inventory, target/registry and writer absence, not these changing journal slots.
  assertExternalSelection(): Promise<void>;
}

export function createWorkspaceDeletionJournalPaths(userDataRoot: string) {
  if (typeof userDataRoot !== 'string' || userDataRoot.includes('\0') ||
      !isAbsolute(userDataRoot) || resolve(userDataRoot) !== userDataRoot) return invalidDeletionData(invalidCode);
  const directoryPath = join(userDataRoot, 'workspace-state');
  const currentPath = join(directoryPath, workspaceDeletionJournalFileName);
  return Object.freeze({ directoryPath, currentPath, nextPath: `${currentPath}.next`, backupPath: `${currentPath}.backup` });
}

export class WorkspaceDeletionJournalStore {
  private readonly fileSystem: CrashSafeFileSlotFileSystem;
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(userDataRoot: string, fileSystem?: CrashSafeFileSlotFileSystem) {
    const paths = createWorkspaceDeletionJournalPaths(userDataRoot);
    this.fileSystem = fileSystem ?? createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceDeletionJournalBytes);
    this.byteStore = new CrashSafeByteSlotStore(this.fileSystem);
  }

  inspect(assertCurrent: () => void) {
    return this.exclusive(() => inspectWorkspaceDeletionJournal(this.fileSystem, checkedDeletionAuthority(assertCurrent, invalidCode)));
  }

  publish(value: unknown, selection: WorkspaceDeletionJournalSelection, assertPublicationCurrent?: () => Promise<void>) {
    return this.exclusive(async () => {
      const next = captureWorkspaceDeletionJournal(value);
      const selected = captureSelection(selection);
      if (selected.plan.mode !== 'absent' || next.phase !== 'authorized') return invalidDeletionData(invalidCode);
      const store = assertPublicationCurrent === undefined ? this.byteStore :
        new CrashSafeByteSlotStore(publicationFileSystem(this.fileSystem, assertPublicationCurrent));
      return store.replaceSelected(serializeWorkspaceDeletionJournal(next), selected.guard);
    });
  }

  advance(value: unknown, selection: WorkspaceDeletionJournalSelection) {
    return this.exclusive(async () => {
      const next = captureWorkspaceDeletionJournal(value);
      const selected = captureSelection(selection);
      if (selected.plan.mode !== 'published' || selected.slots.current === undefined ||
          selected.slots.backup !== undefined || selected.slots.next !== undefined ||
          !sameWorkspaceDeletionJournalBinding(selected.plan.selected, next) ||
          workspaceDeletionPhases.indexOf(next.phase) !== workspaceDeletionPhases.indexOf(selected.plan.selected.phase) + 1) {
        return invalidDeletionData(invalidCode);
      }
      return this.byteStore.replaceSelected(serializeWorkspaceDeletionJournal(next), selected.guard);
    });
  }

  recover(selection: WorkspaceDeletionJournalSelection) {
    return this.exclusive(async () => {
      const selected = captureSelection(selection);
      if (selected.plan.mode !== 'published') return invalidDeletionData(invalidCode);
      return this.byteStore.recoverSelected(selected.guard);
    });
  }

  clearTerminal(selection: WorkspaceDeletionJournalSelection, terminal: Readonly<{
    assertInventoryAndOperationRootAbsent(): Promise<void>;
  }>) {
    return this.exclusive(async () => {
      const selected = captureSelection(selection);
      if (selected.plan.mode !== 'published' || !selected.plan.terminalOnly) return invalidDeletionData(invalidCode);
      const assertAbsent = terminal.assertInventoryAndOperationRootAbsent.bind(terminal);
      const assertExternalSelection = selected.guard.assertExternalSelection;
      await this.byteStore.clearSelected({ ...selected.guard, assertExternalSelection: async () => {
        await assertExternalSelection();
        selected.guard.assertAuthority();
        await assertAbsent();
        selected.guard.assertAuthority();
        await assertExternalSelection();
      } });
    });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeOperation) return invalidDeletionData(invalidCode);
    this.activeOperation = true;
    try { return await work(); } finally { this.activeOperation = false; }
  }
}

// The complete source/backup comparison belongs to initial publication, not every slot I/O.
function publicationFileSystem(
  fileSystem: CrashSafeFileSlotFileSystem, assertPublicationCurrent: () => Promise<void>,
): CrashSafeFileSlotFileSystem {
  return {
    prepareDirectory: fileSystem.prepareDirectory.bind(fileSystem),
    readSlot: fileSystem.readSlot.bind(fileSystem),
    createNextWriter: fileSystem.createNextWriter.bind(fileSystem),
    removeSlot: fileSystem.removeSlot.bind(fileSystem),
    syncDirectory: fileSystem.syncDirectory.bind(fileSystem),
    async moveSlot(source, destination, guard) {
      if (source !== 'next' || destination !== 'current' || guard === undefined) return invalidDeletionData(invalidCode);
      await guard.beforeMutation();
      await assertPublicationCurrent();
      // The long comparison can outlive the selection of any of the three slots.
      await guard.beforeMutation();
      guard.assertAuthority();
      await fileSystem.moveSlot(source, destination, guard);
    },
  };
}

function captureSelection(selection: WorkspaceDeletionJournalSelection) {
  const assertAuthority = checkedDeletionAuthority(selection.assertAuthority.bind(selection), invalidCode);
  const slots = { current: undefined, next: undefined, backup: undefined } as Record<
    'current' | 'next' | 'backup', ReadOnlyJournalSlots<WorkspaceDeletionJournalV1>['current']>;
  for (const name of ['current', 'next', 'backup'] as const) {
    const record = selection.slots[name];
    if (record === undefined) continue;
    const bytes = Uint8Array.from(record.bytes);
    const value = parseWorkspaceDeletionJournalBytes(bytes);
    if (!serializeWorkspaceDeletionJournal(value).equals(serializeWorkspaceDeletionJournal(record.value)) ||
        record.identity === undefined) return invalidDeletionData(invalidCode);
    slots[name] = Object.freeze({ bytes, value, identity: Object.freeze({ ...record.identity }) });
  }
  const captured = Object.freeze(slots);
  const guard: CrashSafeByteSlotSelection = {
    expectedSlots: { current: captured.current?.bytes, next: captured.next?.bytes, backup: captured.backup?.bytes },
    expectedIdentities: { current: captured.current?.identity, next: captured.next?.identity, backup: captured.backup?.identity },
    assertAuthority, assertExternalSelection: selection.assertExternalSelection.bind(selection),
  };
  return { slots: captured, plan: planWorkspaceDeletionJournalSlots(captured), guard };
}
