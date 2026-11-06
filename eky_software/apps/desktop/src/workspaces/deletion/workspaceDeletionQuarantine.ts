import { open, rename } from 'node:fs/promises';
import { createWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { selectWorkspaceDeletionPayload, type WorkspaceDeletionPayloadAuthority,
  type WorkspaceDeletionPayloadReads } from './workspaceDeletionPayloadSelection.js';
import { readWorkspaceLegacyEntryIdentity, readWorkspaceLegacyRuntimeIdentity } from './workspaceLegacyRemnantReads.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export interface WorkspaceDeletionQuarantineFileSystem extends WorkspaceDeletionPayloadReads {
  move(source: string, destination: string): Promise<void>;
  syncParent(path: string, identity: string, assertCurrent: () => void): Promise<void>;
}

async function directoryIdentity(path: string, assertCurrent: () => void): Promise<string | null> {
  try { return await readDeletionInventoryDirectoryIdentity(path, assertCurrent); }
  catch (error) {
    assertCurrent();
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

export const workspaceDeletionQuarantineFileSystem = Object.freeze<WorkspaceDeletionQuarantineFileSystem>({
  ancestor: (path, legacy, guard) => legacy ? readWorkspaceLegacyRuntimeIdentity(path, guard) : directoryIdentity(path, guard),
  async entry(path, legacy, guard) {
    if (legacy) return readWorkspaceLegacyEntryIdentity(path, guard);
    const identity = await directoryIdentity(path, guard);
    return identity === null ? null : Object.freeze({ kind: 'directory' as const, identity });
  },
  move: rename,
  syncParent,
});

// One row only, under the executor's exclusive reservation. It never publishes a phase or removes bytes.
export async function quarantineWorkspaceDeletionPayload(
  root: string, journalValue: unknown, recordValue: unknown, authority: WorkspaceDeletionPayloadAuthority,
  fileSystem: WorkspaceDeletionQuarantineFileSystem = workspaceDeletionQuarantineFileSystem,
): Promise<'moved' | 'alreadyMoved'> {
  const journal = captureWorkspaceDeletionJournal(journalValue);
  const record = captureDeletionInventoryPayloadRecord(recordValue);
  if (journal.phase !== 'authorized') return invalidDeletionData(invalidCode);
  const guard = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = async () => { guard(); await authority.assertSelected(journal, record); guard(); };
  await external();
  const selected = await selectWorkspaceDeletionPayload(root, journal, record, fileSystem, guard, false);
  const alreadyMoved = selected.state === 'quarantine';
  await external();
  await selected.assertState(selected.state);
  await external();
  guard();
  if (!alreadyMoved) {
    // Absence is checked under the owner's exclusion. Never retry or replace a failed rename with copying.
    await fileSystem.move(selected.paths.sourcePath, selected.paths.quarantinePath);
    guard();
  }
  await external();
  await selected.assertState('quarantine');
  await external();
  guard();
  await fileSystem.syncParent(selected.paths.parentPath, record.parentIdentity, guard);
  guard();
  await external();
  await selected.assertState('quarantine');
  await external();
  guard();
  return alreadyMoved ? 'alreadyMoved' : 'moved';
}

async function syncParent(path: string, identity: string, guard: () => void): Promise<void> {
  guard();
  // Matches the existing crash-safe slot contract; Windows directory fsync is not available here.
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  let failed = false;
  let failure: unknown;
  try {
    guard();
    const metadata = await directory.stat({ bigint: true });
    guard();
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || createWorkspaceProcessReservationIdentity(metadata) !== identity) {
      return invalidDeletionData(invalidCode);
    }
    await directory.sync();
    guard();
  } catch (error) { failed = true; failure = error; }
  try { await directory.close(); }
  catch (error) {
    if (failed) throw new AggregateError([failure, error], invalidCode);
    throw error;
  }
  if (failed) throw failure;
  guard();
}
