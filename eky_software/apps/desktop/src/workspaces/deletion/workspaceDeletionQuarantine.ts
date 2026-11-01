import { open, rename } from 'node:fs/promises';
import { createWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord, type WorkspaceDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { readWorkspaceLegacyEntryIdentity, readWorkspaceLegacyRuntimeIdentity,
  type WorkspaceLegacyEntryIdentity } from './workspaceLegacyRemnantReads.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export interface WorkspaceDeletionQuarantineAuthority {
  assertAuthority(): void;
  // The executor proves published journal selection, inventory membership, registry and writer absence.
  // This must remain valid after a move; C's unchanged-source census is not this authority.
  assertSelected(journal: WorkspaceDeletionJournalV1, record: WorkspaceDeletionInventoryPayloadRecord): Promise<void>;
}

export interface WorkspaceDeletionQuarantineFileSystem {
  ancestor(path: string, legacyRuntime: boolean, assertCurrent: () => void): Promise<string | null>;
  entry(path: string, legacyEntry: boolean, assertCurrent: () => void): Promise<WorkspaceLegacyEntryIdentity | null>;
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
  root: string, journalValue: unknown, recordValue: unknown, authority: WorkspaceDeletionQuarantineAuthority,
  fileSystem: WorkspaceDeletionQuarantineFileSystem = workspaceDeletionQuarantineFileSystem,
): Promise<'moved' | 'alreadyMoved'> {
  const journal = captureWorkspaceDeletionJournal(journalValue);
  const record = captureDeletionInventoryPayloadRecord(recordValue);
  if (journal.phase !== 'authorized') return invalidDeletionData(invalidCode);
  const guard = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = async () => { guard(); await authority.assertSelected(journal, record); guard(); };
  const candidates = deriveWorkspaceDeletionPayloadPaths(root, journal.target, record);
  const observe = async () => {
    const observations = [];
    for (const paths of candidates) {
      const ancestors: (string | null)[] = [];
      let missing = false;
      for (const path of paths.ancestors) {
        guard();
        const value = await fileSystem.ancestor(path, paths.legacyEntry && path === paths.parentPath, guard);
        guard();
        if (value === null) { if (path === root) return invalidDeletionData(invalidCode); missing = true; }
        else if (missing) return invalidDeletionData(invalidCode);
        ancestors.push(value);
      }
      guard();
      const source = await fileSystem.entry(paths.sourcePath, paths.legacyEntry, guard);
      guard();
      const quarantine = await fileSystem.entry(paths.quarantinePath, paths.legacyEntry, guard);
      guard();
      for (let index = paths.ancestors.length - 1; index >= 0; index--) {
        const path = paths.ancestors[index]!;
        const value = await fileSystem.ancestor(path, paths.legacyEntry && path === paths.parentPath, guard);
        guard();
        if (value !== ancestors[index]) return invalidDeletionData(invalidCode);
      }
      if (source !== null && quarantine !== null) return invalidDeletionData(invalidCode);
      const entry = source ?? quarantine;
      if (entry !== null && (missing || entry.identity !== record.rootIdentity || ancestors.at(-1) !== record.parentIdentity)) {
        return invalidDeletionData(invalidCode);
      }
      observations.push({ paths, ancestors, source, quarantine });
    }
    if (observations.filter(row => row.source !== null || row.quarantine !== null).length !== 1) {
      return invalidDeletionData(invalidCode);
    }
    return observations;
  };
  await external();
  const baseline = await observe();
  const selectedIndex = baseline.findIndex(row => row.source !== null || row.quarantine !== null);
  const selected = baseline[selectedIndex]!;
  const original = selected.source ?? selected.quarantine!;
  const assertState = async (moved: boolean) => {
    const fresh = await observe();
    for (let index = 0; index < baseline.length; index++) {
      const before = baseline[index]!, after = fresh[index]!;
      if (before.ancestors.some((value, position) => value !== after.ancestors[position])) return invalidDeletionData(invalidCode);
      if (index === selectedIndex) {
        const entry = moved ? after.quarantine : after.source;
        const absent = moved ? after.source : after.quarantine;
        if (absent !== null || entry?.identity !== original.identity || entry.kind !== original.kind) return invalidDeletionData(invalidCode);
      } else if (after.source !== null || after.quarantine !== null) return invalidDeletionData(invalidCode);
    }
  };
  const alreadyMoved = selected.quarantine !== null;
  await external();
  await assertState(alreadyMoved);
  await external();
  guard();
  if (!alreadyMoved) {
    // Absence is checked under the owner's exclusion. Never retry or replace a failed rename with copying.
    await fileSystem.move(selected.paths.sourcePath, selected.paths.quarantinePath);
    guard();
  }
  await external();
  await assertState(true);
  await external();
  guard();
  await fileSystem.syncParent(selected.paths.parentPath, record.parentIdentity, guard);
  guard();
  await external();
  await assertState(true);
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
