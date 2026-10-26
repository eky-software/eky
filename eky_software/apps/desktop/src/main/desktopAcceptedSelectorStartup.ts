import { isDeepStrictEqual } from 'node:util';

import { parseVersionedAcceptedBuildMetadata, readAcceptedBusinessBuild } from '../update/acceptedBuildMetadata.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { parseUpdateJournal, type UpdateJournal } from '../update/updateJournal.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';
import { planWorkspaceSelectorSwitchSlots } from '../workspaces/switch/workspaceSelectorSwitchSlots.js';
import type { WorkspaceSelectorSwitchObservation, WorkspaceSelectorSwitchStartupAuthority } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from '../workspaces/update/workspaceFirstStartMigrationJournalTypes.js';
import type { DesktopDeferredBusinessExternalState, DesktopSelectorRuntimeTerminalProof, DesktopSelectorTerminalRequest } from './desktopDeferredBusinessStartup.js';

type External = Omit<DesktopDeferredBusinessExternalState, 'switchJournal' | 'updateJournal'> & {
  readonly updateJournal: ReadOnlyJournalSlots<UpdateJournal>;
  readonly firstStartJournal: ReadOnlyJournalSlots<WorkspaceFirstStartMigrationJournalV1>;
};

// A normal accepted-build opening, not a deferred business acceptance. Bound
// readers preserve conflicting slots; switch/runtime retain their own writes.
export async function prepareDesktopAcceptedSelectorStartup(input: Readonly<{
  selection: WorkspaceSelectorSwitchObservation;
  inspectSelection(): Promise<WorkspaceSelectorSwitchObservation>;
  inspectExternal(): Promise<External>;
  assertCurrent(): void;
  assertMainOwned(): Promise<void>;
  assertBuildAdmission(metadata: External['metadata']['current'], journal: External['updateJournal']['current']): Promise<void>;
}>) {
  let selected = structuredClone(input.selection);
  const initial = planWorkspaceSelectorSwitchSlots(selected.journalSlots, selected.registrySlots);
  if (initial.mode !== 'validateTarget' && initial.mode !== 'completeSelection') invalid();
  let failed = false;
  let stage: 'initial' | 'admitted' | 'settled' | 'cleared' = 'initial';
  let terminal: 'unused' | 'proving' | 'issued' = 'unused';
  let terminalPurpose: DesktopSelectorTerminalRequest['purpose'] | undefined;
  let runtimeProof: Readonly<DesktopSelectorRuntimeTerminalProof> | undefined;
  const assertCurrent = () => {
    try { if (failed) invalid(); assertUpdateJournalAuthority(input.assertCurrent); }
    catch (error) { failed = true; throw error; }
  };
  const checked = async <T>(action: () => Promise<T>): Promise<T> => {
    try { assertCurrent(); const result = await action(); assertCurrent(); return result; }
    catch (error) { failed = true; throw error; }
  };
  await input.assertMainOwned();
  const original = structuredClone(await input.inspectExternal());
  const record = original.metadata.current;
  if (record?.identity === undefined || original.metadata.next !== undefined || original.metadata.backup !== undefined) invalid();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(record.bytes);
  assertNoDuplicateWorkspaceRegistryKeys(text);
  const metadata = parseVersionedAcceptedBuildMetadata(JSON.parse(text));
  const build = readAcceptedBusinessBuild(metadata);
  if (build === undefined || !isDeepStrictEqual(metadata, record.value)) invalid();
  for (const key of ['legacyMetadata', 'legacyUpdateJournal', 'directSetupRecovery', 'firstStartJournal'] as const) {
    if (Object.values(original[key]).some(slot => slot !== undefined)) invalid();
  }
  const update = original.updateJournal;
  if (update.current !== undefined) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(update.current.bytes);
    assertNoDuplicateWorkspaceRegistryKeys(text);
    if (!isDeepStrictEqual(parseUpdateJournal(JSON.parse(text)), update.current.value)) invalid();
  }
  if (update.next !== undefined || update.backup !== undefined ||
      (update.current !== undefined && (update.current.identity === undefined || update.current.value.state !== 'accepted' ||
        update.current.value.targetVersion !== build.appVersion ||
        update.current.value.candidatePackageIdentity.buildRevision !== build.buildRevision))) invalid();
  await input.assertBuildAdmission(record, update.current);

  // FirstStart requests its three readers concurrently. Share only an in-flight
  // observation, never a completed result or a repairing store read.
  let observing: Promise<void> | undefined;
  function assertExternal(): Promise<void> {
    assertCurrent();
    return observing ??= checked(async () => {
      if (stage !== 'cleared') await runtimeProof?.assertExternal();
      if (!isDeepStrictEqual(await input.inspectExternal(), original)) invalid();
      if (stage !== 'cleared') await runtimeProof?.assertExternal();
    }).finally(() => { observing = undefined; });
  }
  async function assertSelection() {
    await assertExternal();
    if (!isDeepStrictEqual(await input.inspectSelection(), selected)) invalid();
    await assertExternal();
  }
  await checked(assertSelection);
  await input.assertMainOwned();
  assertCurrent();

  return Object.freeze({
    assertCurrent: assertExternal,
    async readAcceptedBuild() { await assertExternal(); return structuredClone(metadata); },
    async readUpdateJournal() { await assertExternal(); return structuredClone(update.current?.value); },
    async readDirectSetupRecovery() { await assertExternal(); return undefined; },
    async readFirstStartJournal(): Promise<Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined> {
      await assertExternal(); return undefined;
    },
    async rejectWrite(): Promise<never> { failed = true; return invalid(); },
    createSwitchAuthority(
      proveRuntime: (request: DesktopSelectorTerminalRequest) => Promise<Readonly<DesktopSelectorRuntimeTerminalProof>>,
    ): WorkspaceSelectorSwitchStartupAuthority {
      return {
        assertCurrent,
        assertExternal,
        async admitSelection(observation) {
          await checked(async () => {
            if (stage !== 'initial' || !isDeepStrictEqual(observation, selected)) invalid();
            await assertSelection();
            stage = 'admitted';
          });
        },
        async didSettleSelection(receipt) {
          await checked(async () => {
            if (!isDeepStrictEqual(receipt.before, selected)) invalid();
            if (receipt.phase === 'startup') {
              if (stage !== 'admitted' || terminal !== 'unused') invalid();
              const plan = planWorkspaceSelectorSwitchSlots(receipt.after.journalSlots, receipt.after.registrySlots);
              if (plan.mode !== 'validateTarget' || !isDeepStrictEqual(plan.registry, initial.registry) ||
                  !isDeepStrictEqual(plan.journal, { ...initial.journal, state: 'targetSelected' })) invalid();
            } else if (stage !== 'settled' || terminal !== 'issued' || terminalPurpose !== 'acceptedTarget' ||
                !isDeepStrictEqual(receipt.before.registrySlots, receipt.after.registrySlots) ||
                Object.values(receipt.after.journalSlots).some(slot => slot !== undefined)) invalid();
            await receipt.assertCurrent();
            selected = structuredClone(receipt.after);
            await assertSelection();
            await receipt.assertCurrent();
            stage = receipt.phase === 'startup' ? 'settled' : 'cleared';
          });
        },
        async proveTerminal(request) {
          return checked(async () => {
            if (stage !== 'settled' || terminal !== 'unused' ||
                !isDeepStrictEqual(request.registry, initial.registry) ||
                !isDeepStrictEqual(request.journal, selected.journalSlots.current?.value)) invalid();
            terminal = 'proving';
            terminalPurpose = request.purpose;
            await assertSelection();
            const runtime = await proveRuntime(structuredClone(request));
            await runtime.assertExternal();
            runtimeProof = runtime;
            assertUpdateJournalAuthority(runtime.assertCurrent.bind(runtime));
            await assertSelection();
            assertUpdateJournalAuthority(runtime.assertCurrent.bind(runtime));
            terminal = 'issued';
            return Object.freeze({ assertCurrent() {
              assertCurrent();
              if (terminal !== 'issued') invalid();
              assertUpdateJournalAuthority(runtime.assertCurrent.bind(runtime));
            } });
          });
        },
      };
    },
  });
}

function invalid(): never { throw new WorkspaceManagementRecoveryRequiredError(); }
