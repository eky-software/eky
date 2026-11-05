import { isDeepStrictEqual } from 'node:util';

import { parseDesktopBuildInfo, type DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import { parseDesktopReleaseInfo, type DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { sameCrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import { readOnlyJournalSlots, type ReadOnlyJournalSlotRecord, type ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';
import { parseVersionedAcceptedBuildMetadata, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import { parseDirectSetupMigrationRecovery, type DirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import { maximumDirectSetupMigrationRecoveryBytes } from './directSetupMigrationRecoveryStore.js';
import type { LocalUpdateRuntimePaths } from './localUpdateRuntimePaths.js';
import { classifyPreWorkspaceBuildAdmission, PreWorkspaceBuildAdmissionError } from './preWorkspaceBuildAdmission.js';
import { assertTerminalLocalUpdateJournal } from './terminalLocalUpdateJournal.js';
import { parseUpdateJournal, type UpdateJournal } from './updateJournal.js';
import { assertUpdateJournalAuthority, maximumUpdateJournalBytes } from './updateJournalStore.js';

interface DeletionLocalUpdateReaders {
  metadata(): Promise<ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>>;
  legacyMetadata(): Promise<ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>>;
  journal(): Promise<ReadOnlyJournalSlots<UpdateJournal>>;
  legacyJournal(): Promise<ReadOnlyJournalSlots<UpdateJournal>>;
  directSetup(): Promise<ReadOnlyJournalSlots<DirectSetupMigrationRecovery>>;
}
const names = ['metadata', 'legacyMetadata', 'journal', 'legacyJournal', 'directSetup'] as const;
function conflict(): never { throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT'); }

// Paths come from main's existing installation-path owner, never a journal or renderer.
export function createWorkspaceDeletionLocalUpdateReaders(paths: Readonly<LocalUpdateRuntimePaths>): DeletionLocalUpdateReaders {
  const metadata = new AcceptedBuildMetadataStore(paths.acceptedBuildMetadataPath);
  const legacyMetadata = new AcceptedBuildMetadataStore(paths.legacyAcceptedBuildMetadataPath);
  const slots = (currentPath: string) => Object.freeze({ currentPath, nextPath: `${currentPath}.next`, backupPath: `${currentPath}.backup` });
  const journal = slots(paths.journalPath), legacyJournal = slots(paths.legacyJournalPath);
  const directSetup = slots(paths.directSetupMigrationRecoveryPath);
  return Object.freeze({
    metadata: () => metadata.inspectSlots(), legacyMetadata: () => legacyMetadata.inspectSlots(),
    journal: () => readOnlyJournalSlots(journal, maximumUpdateJournalBytes, parseUpdateJournal, { includeIdentity: true }),
    legacyJournal: () => readOnlyJournalSlots(legacyJournal, maximumUpdateJournalBytes, parseUpdateJournal, { includeIdentity: true }),
    directSetup: () => readOnlyJournalSlots(directSetup, maximumDirectSetupMigrationRecoveryBytes, parseDirectSetupMigrationRecovery, { includeIdentity: true }),
  });
}

// Read-only observation, not deletion admission, an atomic snapshot or repair authority.
export async function captureWorkspaceDeletionLocalUpdateSelection(input: {
  readers: DeletionLocalUpdateReaders;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  assertCurrent(): void;
  assertOwned(): Promise<void>;
}) {
  const readers = {
    metadata: input.readers.metadata.bind(input.readers), legacyMetadata: input.readers.legacyMetadata.bind(input.readers),
    journal: input.readers.journal.bind(input.readers), legacyJournal: input.readers.legacyJournal.bind(input.readers),
    directSetup: input.readers.directSetup.bind(input.readers),
  };
  const release = input.releaseInfo === undefined ? conflict() : parseDesktopReleaseInfo(input.releaseInfo);
  const build = parseDesktopBuildInfo(input.buildInfo);
  const check = input.assertCurrent.bind(input), owned = input.assertOwned.bind(input);
  let active = true, firstFailure: { cause: unknown } | undefined;
  const retain = (cause: unknown) => { firstFailure ??= { cause }; return firstFailure.cause; };
  const assertCurrent = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    try { if (!active) conflict(); assertUpdateJournalAuthority(check); }
    catch (cause) { throw retain(cause); }
  };
  const checked = async <T>(work: () => Promise<T>) => {
    try { assertCurrent(); const result = await work(); assertCurrent(); return result; }
    catch (cause) { throw retain(cause); }
  };
  async function read<T>(reader: () => Promise<ReadOnlyJournalSlots<T>>, parse: (value: unknown) => Readonly<T>) {
    const slots = await checked(reader);
    if (slots.next !== undefined || slots.backup !== undefined) return conflict();
    const slot = slots.current;
    if (slot === undefined) return undefined;
    if (slot.identity === undefined) return conflict();
    const bytes = Uint8Array.from(slot.bytes);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceRegistryKeys(source);
    return Object.freeze({ bytes, identity: Object.freeze({ ...slot.identity }), value: parse(JSON.parse(source)) });
  }
  const inspect = async () => {
    await checked(owned);
    const selected = {
      metadata: await read(readers.metadata, parseVersionedAcceptedBuildMetadata),
      legacyMetadata: await read(readers.legacyMetadata, parseVersionedAcceptedBuildMetadata),
      journal: await read(readers.journal, parseUpdateJournal),
      legacyJournal: await read(readers.legacyJournal, parseUpdateJournal),
      directSetup: await read(readers.directSetup, parseDirectSetupMigrationRecovery),
    };
    for (const [current, legacy] of [[selected.metadata, selected.legacyMetadata], [selected.journal, selected.legacyJournal]] as const) {
      if (current !== undefined && legacy !== undefined && !isDeepStrictEqual(current.value, legacy.value)) conflict();
    }
    const metadata = selected.metadata?.value ?? selected.legacyMetadata?.value;
    const journal = selected.journal?.value ?? selected.legacyJournal?.value;
    assertTerminalLocalUpdateJournal(metadata, journal);
    if (selected.directSetup !== undefined && selected.directSetup.value.state !== 'accepted') conflict();
    // The validated C terminal has no outstanding target. Direct Setup is
    // deliberately retained: its accepted cut can precede build acceptance.
    const result = classifyPreWorkspaceBuildAdmission({ acceptedBuild: metadata, buildInfo: build,
      directSetupRecovery: selected.directSetup?.value, journal: undefined, releaseInfo: release });
    if (result.status === 'rejected') throw new PreWorkspaceBuildAdmissionError(result.reason);
    if (result.admission !== 'exactAcceptedBuild' && result.admission !== 'authorizedNewerBuild') conflict();
    if (selected.directSetup !== undefined && result.admission !== 'exactAcceptedBuild') conflict();
    const admission = result.admission;
    await checked(owned);
    return { selected, admission };
  };
  try {
    const captured = await checked(inspect);
    const assertSelected = () => checked(async () => {
      const current = await inspect();
      for (const name of names) assertSameRecord(captured.selected[name], current.selected[name]);
      assertCurrent();
    });
    await assertSelected();
    return Object.freeze({ admission: captured.admission, assertCurrent, assertSelected, revoke() { active = false; } });
  } catch (cause) { active = false; throw retain(cause); }
}

function assertSameRecord(expected: ReadOnlyJournalSlotRecord<unknown> | undefined, actual: ReadOnlyJournalSlotRecord<unknown> | undefined): void {
  if (expected === undefined ? actual !== undefined : actual === undefined || expected.identity === undefined || actual.identity === undefined ||
      !sameCrashSafeFileSlotIdentity(expected.identity, actual.identity) || !Buffer.from(expected.bytes).equals(actual.bytes)) conflict();
}
