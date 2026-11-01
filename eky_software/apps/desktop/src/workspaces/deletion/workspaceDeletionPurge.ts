import type { BigIntStats } from 'node:fs';
import { lstat, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { observeWorkspaceDeletionDirectoryEntries, workspaceDeletionDirectoryReads,
  type WorkspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { sameDeletionInventoryFile } from './workspaceDeletionInventoryFile.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { selectWorkspaceDeletionPayload, type WorkspaceDeletionPayloadAuthority,
  type WorkspaceDeletionPayloadReads } from './workspaceDeletionPayloadSelection.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { readWorkspaceLegacyEntryIdentity, type WorkspaceLegacyEntryIdentity } from './workspaceLegacyRemnantReads.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';
type PurgeEntry = WorkspaceLegacyEntryIdentity & Readonly<{ metadata: BigIntStats }>;
type PurgeFrame = Readonly<{ path: string; entry: PurgeEntry; parent?: PurgeFrame }>;

export interface WorkspaceDeletionPurgeFileSystem extends WorkspaceDeletionPayloadReads {
  readEntry(path: string, assertCurrent: () => void): Promise<PurgeEntry | null>;
  directoryReads: WorkspaceDeletionDirectoryReads;
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  syncParent(path: string, identity: string, assertCurrent: () => void): Promise<void>;
}

export const workspaceDeletionPurgeFileSystem = Object.freeze<WorkspaceDeletionPurgeFileSystem>({
  ancestor: workspaceDeletionQuarantineFileSystem.ancestor,
  entry: workspaceDeletionQuarantineFileSystem.entry,
  readEntry,
  directoryReads: workspaceDeletionDirectoryReads,
  unlink, rmdir,
  syncParent: workspaceDeletionQuarantineFileSystem.syncParent,
});

// One pre-authorized root, never a recursive rm or a registry/journal publisher.
export async function purgeWorkspaceDeletionPayload(
  root: string, journalValue: unknown, recordValue: unknown, authority: WorkspaceDeletionPayloadAuthority,
  fileSystem: WorkspaceDeletionPurgeFileSystem = workspaceDeletionPurgeFileSystem,
): Promise<'purged' | 'alreadyAbsent'> {
  const journal = captureWorkspaceDeletionJournal(journalValue);
  const record = captureDeletionInventoryPayloadRecord(recordValue);
  if (journal.phase !== 'purgeAuthorized') return invalidDeletionData(invalidCode);
  const guard = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = async () => { guard(); await authority.assertSelected(journal, record); guard(); };
  await external();
  const selection = await selectWorkspaceDeletionPayload(root, journal, record, fileSystem, guard, true);
  if (selection.state === 'source') return invalidDeletionData(invalidCode);
  const alreadyAbsent = selection.state === 'absent';

  const requiredEntry = async (path: string) => {
    guard();
    const entry = await fileSystem.readEntry(path, guard);
    guard();
    if (entry === null) return invalidDeletionData(invalidCode);
    return entry;
  };
  const assertFrame = async (frame: PurgeFrame): Promise<void> => {
    const current = await requiredEntry(frame.path);
    if (!sameEntry(frame.entry, current)) return invalidDeletionData(invalidCode);
    if (frame.parent !== undefined) await assertFrame(frame.parent);
  };
  const visit = async (frame: PurgeFrame, remove: boolean): Promise<void> => {
    await assertFrame(frame);
    if (frame.entry.kind === 'directory') {
      // The reader holds bounded name pages; each open/read/close is joined before a name is yielded.
      const names = observeWorkspaceDeletionDirectoryEntries(frame.path, {
        assertAuthority: guard,
        assertExternalSelection: () => assertFrame(frame),
      }, fileSystem.directoryReads);
      for await (const name of names) {
        const path = join(frame.path, name);
        const entry = await requiredEntry(path);
        await assertFrame(frame);
        await visit({ path, entry, parent: frame }, remove);
      }
    }
    await assertFrame(frame);
    if (!remove) return;
    await external();
    await assertFrame(frame);
    await selection.assertState('quarantine');
    await external();
    guard();
    // A newly appeared child makes rmdir fail. There is no retry, force option or recursive fallback.
    if (frame.entry.kind === 'file') await fileSystem.unlink(frame.path);
    else await fileSystem.rmdir(frame.path);
    guard();
    if (await fileSystem.readEntry(frame.path, guard) !== null) return invalidDeletionData(invalidCode);
    guard();
  };

  if (!alreadyAbsent) {
    const entry = await requiredEntry(selection.paths.quarantinePath);
    if (entry.kind !== selection.original?.kind || entry.identity !== record.rootIdentity) return invalidDeletionData(invalidCode);
    const frame = { path: selection.paths.quarantinePath, entry };
    // Reject structurally unsafe contents before this attempt's first mutation. No business DB is opened.
    await visit(frame, false);
    await external();
    await selection.assertState('quarantine');
    await external();
    await visit(frame, true);
  }
  await external();
  await selection.assertState('absent');
  await external();
  guard();
  await fileSystem.syncParent(selection.paths.parentPath, record.parentIdentity, guard);
  guard();
  await external();
  await selection.assertState('absent');
  await external();
  guard();
  return alreadyAbsent ? 'alreadyAbsent' : 'purged';
}

function sameEntry(expected: PurgeEntry, actual: PurgeEntry): boolean {
  return expected.kind === actual.kind && expected.identity === actual.identity &&
    (expected.kind === 'directory' || sameDeletionInventoryFile(expected.metadata, actual.metadata));
}

async function readEntry(path: string, guard: () => void): Promise<PurgeEntry | null> {
  guard();
  let before: BigIntStats;
  try { before = await lstat(path, { bigint: true }); }
  catch (error) {
    guard();
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
  guard();
  const identity = await readWorkspaceLegacyEntryIdentity(path, guard);
  guard();
  if (identity === null) return invalidDeletionData(invalidCode);
  const after = await lstat(path, { bigint: true });
  guard();
  if (before.dev !== after.dev || before.ino !== after.ino ||
      after.isSymbolicLink() ||
      (identity.kind === 'directory' && (!after.isDirectory() || (process.platform !== 'win32' && (after.mode & 0o077n) !== 0n))) ||
      (identity.kind === 'file' && (!after.isFile() || after.nlink !== 1n)) ||
      (identity.kind === 'file' && !sameDeletionInventoryFile(before, after))) return invalidDeletionData(invalidCode);
  return Object.freeze({ ...identity, metadata: after });
}
