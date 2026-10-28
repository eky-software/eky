import { rmdir } from 'node:fs/promises';
import { createNodeCrashSafeFileSlotFileSystem, sameCrashSafeFileSlotIdentity,
  type CrashSafeFileSlotFileSystem, type CrashSafeFileSlotIdentity, type CrashSafeFileSlotMutationGuard } from '../persistence/crashSafeFileSlot.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { deletionInventoryFileIdentity, inspectDeletionInventoryFile, sameDeletionInventoryFile,
  workspaceDeletionInventoryDirectoryReads, type WorkspaceDeletionInventoryDirectoryReads } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore, workspaceDeletionInventoryFileName,
  type WorkspaceDeletionInventoryAuthority } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes,
  serializeWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { inspectWorkspaceDeletionJournal } from './workspaceDeletionJournalSlots.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';

const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

interface InventoryRetirementFileSystem {
  readonly journal?: CrashSafeFileSlotFileSystem;
  readonly inventory?: CrashSafeFileSlotFileSystem;
  readonly parent?: CrashSafeFileSlotFileSystem;
  readonly directories?: WorkspaceDeletionInventoryDirectoryReads;
  readonly removeDirectory?: (path: string) => Promise<void>;
}

// This only retires technical inventory bytes. It never removes payloads, parent directories, or the journal.
export async function retireWorkspaceDeletionInventory(
  userDataRoot: string, value: unknown, authority: WorkspaceDeletionInventoryAuthority,
  fileSystems: InventoryRetirementFileSystem = {},
): Promise<void> {
  const expected = captureWorkspaceDeletionJournal(value);
  if (expected.phase !== 'registryPublished') return invalidDeletionData(invalidCode);
  const paths = createWorkspaceDeletionInventoryPaths(userDataRoot, expected.target.operationId);
  const journal = fileSystems.journal ?? createNodeCrashSafeFileSlotFileSystem(
    createWorkspaceDeletionJournalPaths(userDataRoot), maximumWorkspaceDeletionJournalBytes);
  const inventory = fileSystems.inventory ?? createNodeCrashSafeFileSlotFileSystem(paths, Number.MAX_SAFE_INTEGER);
  const parent = fileSystems.parent ?? createNodeCrashSafeFileSlotFileSystem({ ...paths, directoryPath: paths.parentPath }, 1);
  const directories = fileSystems.directories ?? workspaceDeletionInventoryDirectoryReads;
  const assertAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const expectedBytes = serializeWorkspaceDeletionJournal(expected);
  let journalIdentity: CrashSafeFileSlotIdentity | undefined;
  let journalBytes: Uint8Array | undefined;
  const assertExternal = async () => {
    assertAuthority();
    await authority.assertExternalSelection();
    assertAuthority();
  };
  const assertTerminal = async () => {
    await assertExternal();
    const observed = await inspectWorkspaceDeletionJournal(journal, assertAuthority);
    if (observed.plan.mode !== 'published' || !observed.plan.terminalOnly || observed.slots.current?.identity === undefined ||
        !serializeWorkspaceDeletionJournal(observed.plan.selected).equals(expectedBytes)) return invalidDeletionData(invalidCode);
    const current = observed.slots.current;
    if (journalIdentity !== undefined && (!sameCrashSafeFileSlotIdentity(current.identity!, journalIdentity) ||
        !Buffer.from(current.bytes).equals(journalBytes!))) return invalidDeletionData(invalidCode);
    journalIdentity ??= Object.freeze({ ...current.identity! });
    journalBytes ??= Uint8Array.from(current.bytes);
    await assertExternal();
  };
  const inspectDirectories = async (allowAbsent: boolean): Promise<boolean> => {
    if (await directories.identity(paths.parentPath, assertAuthority) !== expected.operationParentIdentity) return invalidDeletionData(invalidCode);
    try {
      if (await directories.identity(paths.directoryPath, assertAuthority) !== expected.operationRootIdentity) return invalidDeletionData(invalidCode);
      return true;
    } catch (error) {
      assertAuthority();
      if (allowAbsent && (error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
      throw error;
    }
  };
  const rootGuard: CrashSafeFileSlotMutationGuard = { assertAuthority, beforeMutation: async () => {
    await assertTerminal();
    await inspectDirectories(false);
    await assertTerminal();
  } };
  const parentGuard: CrashSafeFileSlotMutationGuard = { assertAuthority, beforeMutation: async () => {
    await assertTerminal();
    if (await inspectDirectories(true)) return invalidDeletionData(invalidCode);
    await assertTerminal();
  } };
  const readNames = async () => {
    await rootGuard.beforeMutation();
    const names = await directories.names(paths.directoryPath);
    assertAuthority();
    await assertTerminal();
    return names;
  };

  await assertTerminal();
  const rootPresent = await inspectDirectories(true);
  await assertTerminal();
  if (rootPresent) {
    const names = await readNames();
    if (names.length === 1 && names[0] === workspaceDeletionInventoryFileName) {
      const before = await inspectDeletionInventoryFile(paths.currentPath, assertAuthority);
      if (deletionInventoryFileIdentity(before) !== expected.inventoryFileIdentity) return invalidDeletionData(invalidCode);
      const selection = inventorySelection(expected);
      await new WorkspaceDeletionInventoryStore(userDataRoot, expected.target.operationId).inspect(selection,
        { assertAuthority, assertExternalSelection: assertTerminal });
      const removeGuard = { assertAuthority, beforeMutation: async () => {
        await rootGuard.beforeMutation();
        const currentNames = await readNames();
        const actual = await inspectDeletionInventoryFile(paths.currentPath, assertAuthority);
        if (currentNames.length !== 1 || currentNames[0] !== workspaceDeletionInventoryFileName ||
            !sameDeletionInventoryFile(before, actual)) return invalidDeletionData(invalidCode);
        await assertTerminal();
      } };
      if (!await inventory.removeSlot('current', removeGuard)) return invalidDeletionData(invalidCode);
      assertAuthority();
    } else if (names.length !== 0) return invalidDeletionData(invalidCode);
    await inventory.syncDirectory(rootGuard);
    if ((await readNames()).length !== 0) return invalidDeletionData(invalidCode);
    await rootGuard.beforeMutation();
    // Revalidate the source after the guard's journal awaits, as slot mutation does.
    await inspectDirectories(false);
    assertAuthority();
    await (fileSystems.removeDirectory ?? rmdir)(paths.directoryPath);
    assertAuthority();
  }
  await parent.syncDirectory(parentGuard);
  await parentGuard.beforeMutation();
}

// An absence port for journal-last cleanup; absence is evidence, not permission to remove anything.
export async function assertWorkspaceDeletionInventoryRetired(
  userDataRoot: string, value: unknown, authority: WorkspaceDeletionInventoryAuthority,
): Promise<void> {
  const expected = captureWorkspaceDeletionJournal(value);
  if (expected.phase !== 'registryPublished') return invalidDeletionData(invalidCode);
  const paths = createWorkspaceDeletionInventoryPaths(userDataRoot, expected.target.operationId);
  const assertAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  assertAuthority();
  await authority.assertExternalSelection();
  assertAuthority();
  if (await workspaceDeletionInventoryDirectoryReads.identity(paths.parentPath, assertAuthority) !== expected.operationParentIdentity) {
    return invalidDeletionData(invalidCode);
  }
  try {
    await workspaceDeletionInventoryDirectoryReads.identity(paths.directoryPath, assertAuthority);
    return invalidDeletionData(invalidCode);
  } catch (error) {
    assertAuthority();
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  await authority.assertExternalSelection();
  assertAuthority();
}

function inventorySelection(value: WorkspaceDeletionJournalV1) {
  return { target: value.target, inventory: value.inventory, inventoryFileIdentity: value.inventoryFileIdentity,
    operationRootIdentity: value.operationRootIdentity, operationParentIdentity: value.operationParentIdentity };
}
