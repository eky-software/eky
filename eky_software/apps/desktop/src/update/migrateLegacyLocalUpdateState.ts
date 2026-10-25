import { isDeepStrictEqual } from 'node:util';

import type { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import { readAcceptedApplicationBuild, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { assertUpdateJournalAuthority, type UpdateJournalStore } from './updateJournalStore.js';
import type { UpdateJournal } from './updateJournal.js';
import type { ReadOnlyJournalSlotRecord, ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import type { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../workspaces/registry/workspaceRegistryTypes.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';

interface StateStore<T> {
  clear(): Promise<void>;
  read(): Promise<Readonly<T> | undefined>;
  write(value: Readonly<T>): Promise<void>;
}

export interface LegacyLocalUpdateStateStores {
  acceptedBuild: {
    current: Pick<AcceptedBuildMetadataStore, 'read' | 'write'>;
    legacy: Pick<AcceptedBuildMetadataStore, 'clear' | 'read'>;
  };
  journal: {
    current: Pick<UpdateJournalStore, 'read' | 'write'>;
    legacy: Pick<UpdateJournalStore, 'clear' | 'read'>;
  };
}

export async function migrateLegacyLocalUpdateState(
  stores: LegacyLocalUpdateStateStores,
): Promise<void> {
  await migrateStateValue<VersionedAcceptedBuildMetadata>(
    stores.acceptedBuild.current,
    stores.acceptedBuild.legacy,
  );
  await migrateStateValue(stores.journal.current, stores.journal.legacy);
}

async function migrateStateValue<T>(
  current: Pick<StateStore<T>, 'read' | 'write'>,
  legacy: Pick<StateStore<T>, 'clear' | 'read'>,
): Promise<void> {
  const currentValue = await current.read();
  const legacyValue = await legacy.read();

  if (currentValue !== undefined) {
    if (
      legacyValue !== undefined &&
      serialize(currentValue) !== serialize(legacyValue)
    ) {
      throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
    }
    if (legacyValue !== undefined) {
      await legacy.clear();
    }
    return;
  }

  if (legacyValue === undefined) {
    return;
  }

  await current.write(legacyValue);
  const verified = await current.read();
  if (verified === undefined || serialize(verified) !== serialize(legacyValue)) {
    throw new Error('LOCAL_UPDATE_STATE_MIGRATION_FAILED');
  }
  await legacy.clear();
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

export interface SelectorLocalUpdateStateContext {
  acceptedBuild: {
    current: Pick<AcceptedBuildMetadataStore, 'inspectSlots' | 'write' | 'confirmSelected'>;
    legacy: Pick<AcceptedBuildMetadataStore, 'inspectSlots' | 'clearSelected' | 'confirmAbsent'>;
  };
  journal: {
    current: Pick<UpdateJournalStore, 'inspectSlots' | 'createSelected' | 'clearSelected' | 'confirmAbsent' | 'confirmSelected'>;
    legacy: Pick<UpdateJournalStore, 'inspectSlots' | 'clearSelected' | 'confirmAbsent'>;
  };
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertAuthority(): void;
  // The installation owner proves writer absence and the other recovery owners.
  assertRecoveryAuthority(): Promise<void>;
  // Admission uses the exact metadata captured after terminal-journal validation.
  assertBuildAdmission(metadata: Readonly<VersionedAcceptedBuildMetadata>): Promise<void>;
}

interface SelectorStateSelection {
  metadata: ReadOnlyJournalSlotRecord<VersionedAcceptedBuildMetadata> | undefined;
  legacyMetadata: ReadOnlyJournalSlotRecord<VersionedAcceptedBuildMetadata> | undefined;
  journal: ReadOnlyJournalSlotRecord<UpdateJournal> | undefined;
  legacyJournal: ReadOnlyJournalSlotRecord<UpdateJournal> | undefined;
  registry: ReadOnlyJournalSlotRecord<LocalWorkspaceRegistry> | undefined;
}
const selectionNames = ['metadata', 'legacyMetadata', 'journal', 'legacyJournal', 'registry'] as const;

// This named branch must run before repairing reads. It prepares installation
// state, not business health or a reusable permission to publish the selector.
export async function prepareSelectorLocalUpdateState(context: SelectorLocalUpdateStateContext): Promise<void> {
  const assertAuthority = () => assertUpdateJournalAuthority(context.assertAuthority);
  let expected = await inspectSelectorSelection(context);
  async function change<K extends keyof SelectorStateSelection>(
    name: K, value: SelectorStateSelection[K], operation: () => Promise<void>,
  ) {
    assertUnchangedSelection(expected, await inspectSelectorSelection(context));
    await operation();
    const actual = await inspectSelectorSelection(context);
    for (const other of selectionNames) {
      if (other !== name) assertSameRecord(expected[other], actual[other]);
    }
    if (!isDeepStrictEqual(actual[name]?.value, value?.value)) {
      throw new Error('LOCAL_UPDATE_STATE_MIGRATION_FAILED');
    }
    expected = actual;
  }

  if (expected.legacyMetadata !== undefined) {
    const legacy = expected.legacyMetadata;
    if (expected.metadata === undefined) {
      await change('metadata', legacy, () => context.acceptedBuild.current.write(legacy.value, {
        expectedBytes: undefined, assertAuthority,
      }));
    }
    if (expected.metadata === undefined) throw new Error('LOCAL_UPDATE_STATE_MIGRATION_FAILED');
    await context.acceptedBuild.current.confirmSelected({ expectedBytes: expected.metadata.bytes, assertAuthority });
    await change('legacyMetadata', undefined, () => context.acceptedBuild.legacy.clearSelected({
      expectedBytes: legacy.bytes, assertAuthority,
    }));
  }
  if (expected.legacyJournal !== undefined) {
    const legacy = expected.legacyJournal;
    if (expected.journal === undefined) {
      await change('journal', legacy, () => context.journal.current.createSelected(legacy.value, assertAuthority));
    }
    if (expected.journal === undefined) throw new Error('LOCAL_UPDATE_STATE_MIGRATION_FAILED');
    await context.journal.current.confirmSelected({ expectedBytes: expected.journal.bytes, assertAuthority });
    await change('legacyJournal', undefined, () => context.journal.legacy.clearSelected({
      expectedBytes: legacy.bytes, assertAuthority,
    }));
  }
  if (expected.journal !== undefined) {
    const selected = expected.journal;
    await change('journal', undefined, () => context.journal.current.clearSelected({
      expectedBytes: selected.bytes, assertAuthority,
    }));
  }

  // A previous lost clear acknowledgement may have removed the file without
  // completing its sync. Re-establish that boundary without creating old dirs.
  for (const store of [context.acceptedBuild.legacy, context.journal.legacy, context.journal.current]) {
    assertUnchangedSelection(expected, await inspectSelectorSelection(context));
    await store.confirmAbsent(assertAuthority);
  }
  assertUnchangedSelection(expected, await inspectSelectorSelection(context));
  assertAuthority();
}

async function inspectSelectorSelection(context: SelectorLocalUpdateStateContext): Promise<SelectorStateSelection> {
  const assertAuthority = () => assertUpdateJournalAuthority(context.assertAuthority);
  assertAuthority();
  await context.assertRecoveryAuthority();
  assertAuthority();
  async function inspect<T>(store: { inspectSlots(): Promise<ReadOnlyJournalSlots<T>> }) {
    assertAuthority();
    const slots = await store.inspectSlots();
    assertAuthority();
    if (slots.next !== undefined || slots.backup !== undefined) {
      throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
    }
    if (slots.current === undefined) return undefined;
    try {
      // Reuse the existing duplicate-key scanner on the captured bytes. Do not
      // tighten legacy repairing reads or lose ambiguity through JSON.parse.
      assertNoDuplicateWorkspaceRegistryKeys(new TextDecoder('utf-8', { fatal: true }).decode(slots.current.bytes));
    } catch (error) { throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT', { cause: error }); }
    return Object.freeze({ bytes: Buffer.from(slots.current.bytes), value: slots.current.value });
  }
  const selection: SelectorStateSelection = {
    metadata: await inspect(context.acceptedBuild.current),
    legacyMetadata: await inspect(context.acceptedBuild.legacy),
    journal: await inspect(context.journal.current),
    legacyJournal: await inspect(context.journal.legacy),
    registry: await inspect(context.registry),
  };
  for (const [current, legacy] of [[selection.metadata, selection.legacyMetadata],
    [selection.journal, selection.legacyJournal]] as const) {
    if (current !== undefined && legacy !== undefined && !isDeepStrictEqual(current.value, legacy.value)) {
      throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
    }
  }
  const metadata = selection.metadata ?? selection.legacyMetadata;
  if (metadata === undefined || selection.registry?.value.activeWorkspaceId !== null) {
    throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
  }
  const journal = selection.journal ?? selection.legacyJournal;
  if (journal !== undefined) {
    const application = readAcceptedApplicationBuild(metadata.value);
    const state = journal.value.state;
    const accepted = state === 'accepted';
    if ((!accepted && state !== 'installerNotApplied' && state !== 'rolledBack') ||
        application.appVersion !== (accepted ? journal.value.targetVersion : journal.value.currentVersion) ||
        application.buildRevision !== (accepted ? journal.value.candidatePackageIdentity : journal.value.currentPackageIdentity).buildRevision ||
        application.releaseChannel !== journal.value.releaseChannel) {
      throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
    }
  }
  await context.assertBuildAdmission(metadata.value);
  await context.assertRecoveryAuthority();
  assertAuthority();
  return selection;
}

function assertUnchangedSelection(expected: SelectorStateSelection, actual: SelectorStateSelection): void {
  for (const name of selectionNames) assertSameRecord(expected[name], actual[name]);
}

function assertSameRecord(
  expected: ReadOnlyJournalSlotRecord<unknown> | undefined,
  actual: ReadOnlyJournalSlotRecord<unknown> | undefined,
): void {
  if (expected === undefined ? actual !== undefined :
    actual === undefined || !Buffer.from(expected.bytes).equals(actual.bytes)) {
    throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
  }
}
