import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { PreparedDeferredBusinessLocalUpdate, DeferredBusinessLocalUpdateState } from '../update/deferredBusinessLocalUpdateState.js';
import type { DeferredBusinessFirstStartAuthority, FirstStartUpdateCoordinator } from '../update/firstStartUpdateCoordinator.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import type { WorkspaceFirstStartMigrationCompositionOptions } from '../workspaces/update/workspaceFirstStartMigrationComposition.js';
import type { WorkspaceFirstStartMigrationOrchestration } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorTypes.js';
import { calculateWorkspaceRegistrySha256, markPassiveWorkspacesRecoveryRequired } from '../workspaces/update/workspaceFirstStartMigrationRegistryTransitions.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import type { WorkspaceSelectorSwitchObservation, WorkspaceSelectorSwitchSettlement, WorkspaceSelectorSwitchStartupAuthority } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import { planWorkspaceSelectorSwitchSlots } from '../workspaces/switch/workspaceSelectorSwitchSlots.js';

export type DesktopDeferredBusinessExternalState = Pick<DeferredBusinessLocalUpdateState,
  'metadata' | 'legacyMetadata' | 'updateJournal' | 'legacyUpdateJournal' | 'directSetupRecovery' | 'switchJournal'>;

export type DesktopSelectorTerminalRequest = Parameters<WorkspaceSelectorSwitchStartupAuthority['proveTerminal']>[0];
export interface DesktopSelectorRuntimeTerminalProof {
  assertCurrent(): void;
  assertExternal(): Promise<void>;
}

// Main's scoped connection between the admitted startup records, W6 and
// FirstStart. Persistence and semantic transitions stay with their owners.
export function createDesktopDeferredBusinessStartup(input: Readonly<{
  prepared: PreparedDeferredBusinessLocalUpdate;
  assertCurrent(): void;
  inspectExternal(includeMetadata: boolean): Promise<Omit<DesktopDeferredBusinessExternalState, 'metadata'> &
    Partial<Pick<DesktopDeferredBusinessExternalState, 'metadata'>>>;
}>) {
  const prepared = structuredClone(input.prepared);
  const original = prepared.selectedState;
  const hasSelectorSwitch = Object.values(original.switchJournal).some(slot => slot !== undefined);
  const assertStartup = input.assertCurrent.bind(input);
  const inspectExternal = input.inspectExternal.bind(input);
  let metadata = original.metadata;
  let failed = false;
  let publishing = false;
  let accepted = prepared.businessAccepted;
  let firstStartBound = false;
  let preparationBound = false;
  let acceptanceStarted = false;
  let selectorStage: 'none' | 'admitted' | 'settled' | 'cleared' = 'none';
  let selectorHandoffPending = false;
  let terminalState: 'unused' | 'proving' | 'issued' = 'unused';
  let terminalPurpose: DesktopSelectorTerminalRequest['purpose'] | undefined;
  let selectorSelection: WorkspaceSelectorSwitchObservation = {
    registrySlots: original.registry, journalSlots: original.switchJournal,
  };
  const operationId = randomUUID();

  function assertCurrent() {
    try {
      if (failed) invalid();
      assertUpdateJournalAuthority(assertStartup);
    } catch (error) { failed = true; throw error; }
  }
  async function checked<T>(action: () => Promise<T>): Promise<T> {
    try { assertCurrent(); const value = await action(); assertCurrent(); return value; }
    catch (error) { failed = true; throw error; }
  }
  async function assertExternal() {
    await checked(async () => {
      const actual = await inspectExternal(!publishing);
      for (const name of ['legacyMetadata', 'updateJournal', 'legacyUpdateJournal', 'directSetupRecovery'] as const) {
        if (!isDeepStrictEqual(actual[name], original[name])) invalid();
      }
      if (!isDeepStrictEqual(actual.switchJournal, selectorSelection.journalSlots)) invalid();
      // FirstStart alone owns metadata publication and checks its captured
      // identity within that write. Never inspect its in-flight slot files.
      if (!publishing && !isDeepStrictEqual(actual.metadata, metadata)) invalid();
    });
  }
  const authority: NonNullable<WorkspaceFirstStartMigrationCompositionOptions['deferredBusiness']> = {
    acceptedBuild: prepared.selectorMetadata,
    assertCurrent: assertExternal,
    persistence: {
      registry: original.registry, journal: original.firstStartJournal, assertCurrent,
      assertExternalSelection: assertExternal,
      async bindPreparation(journal) {
        await checked(async () => {
          if (preparationBound || accepted || publishing || selectorHandoffPending || terminalState !== 'unused' ||
              (hasSelectorSwitch && selectorStage !== 'settled') || journal.operationId !== operationId ||
              journal.activeWorkspaceId !== prepared.sourceRegistry.activeWorkspaceId ||
              journal.sourceBuild.appVersion !== prepared.selectorMetadata.businessBaseline.appVersion ||
              journal.sourceBuild.buildRevision !== prepared.selectorMetadata.businessBaseline.buildRevision ||
              journal.targetBuild.appVersion !== prepared.selectorMetadata.acceptedBuild.appVersion ||
              journal.targetBuild.buildRevision !== prepared.selectorMetadata.acceptedBuild.buildRevision ||
              journal.sourceRegistrySha256 !== calculateWorkspaceRegistrySha256(prepared.sourceRegistry) ||
              journal.transitionedRegistrySha256 !== calculateWorkspaceRegistrySha256(markPassiveWorkspacesRecoveryRequired(
                prepared.sourceRegistry, journal.activeWorkspaceId, journal.passiveRecoveryWorkspaceIds))) invalid();
          preparationBound = true;
          await assertExternal();
        });
      },
    },
  };
  return {
    authority,
    operationIdFactory: () => operationId,
    assertCurrent: assertExternal,
    async admitSelectorSelection(observation: WorkspaceSelectorSwitchObservation) {
      const selected = structuredClone(observation);
      await checked(async () => {
        if (selectorStage !== 'none' || firstStartBound || accepted || selectorHandoffPending ||
            !hasSelectorSwitch ||
            !isDeepStrictEqual(selected, selectorSelection)) invalid();
        selectorStage = 'admitted';
        await assertExternal();
      });
    },
    async settleSelectorSelection(receipt: WorkspaceSelectorSwitchSettlement,
      w6: Pick<WorkspaceFirstStartMigrationOrchestration, 'settleSelectorRegistry'>) {
      const { phase } = receipt;
      const before = structuredClone(receipt.before);
      const after = structuredClone(receipt.after);
      const assertOwner = receipt.assertCurrent.bind(receipt);
      const settleRegistry = w6.settleSelectorRegistry.bind(w6);
      await checked(async () => {
        if (selectorHandoffPending || accepted || publishing || acceptanceStarted || terminalPurpose === 'selectorReturn' ||
            !isDeepStrictEqual(before, selectorSelection)) invalid();
        selectorHandoffPending = true;
        if (phase === 'startup') {
          if (selectorStage !== 'admitted' || preparationBound || firstStartBound) invalid();
          const plan = planWorkspaceSelectorSwitchSlots(after.journalSlots, after.registrySlots);
          if (plan.mode !== 'validateTarget' || after.registrySlots.next !== undefined ||
              after.registrySlots.backup !== undefined || after.journalSlots.next !== undefined ||
              after.journalSlots.backup !== undefined || !isDeepStrictEqual(plan.registry, prepared.sourceRegistry)) invalid();
        } else if (phase === 'acceptedTarget') {
          if (selectorStage !== 'settled' || !firstStartBound ||
              !isDeepStrictEqual(before.registrySlots, after.registrySlots) ||
              Object.values(after.journalSlots).some(slot => slot !== undefined)) invalid();
        } else invalid();
        await assertOwner();
        selectorSelection = after;
        await assertExternal();
        if (phase === 'startup') await settleRegistry({ phase, before: structuredClone(before),
          after: structuredClone(after), assertCurrent: assertOwner });
        await assertOwner();
        await assertExternal();
        selectorStage = phase === 'startup' ? 'settled' : 'cleared';
        selectorHandoffPending = false;
      });
    },
    async proveSelectorTerminal(request: DesktopSelectorTerminalRequest,
      w6: Pick<WorkspaceFirstStartMigrationOrchestration, 'cancelBeforeSelectorReturn' | 'assertDeferredBusinessReady'>,
      proveRuntime: (request: DesktopSelectorTerminalRequest) => Promise<Readonly<DesktopSelectorRuntimeTerminalProof>>,
    ): Promise<Readonly<{ assertCurrent(): void }>> {
      const selected = structuredClone(request);
      const cancel = w6.cancelBeforeSelectorReturn.bind(w6);
      const assertW6 = w6.assertDeferredBusinessReady.bind(w6);
      return checked(async () => {
        if (terminalState !== 'unused' || selectorStage !== 'settled' || selectorHandoffPending ||
            accepted || publishing || acceptanceStarted || !hasSelectorSwitch ||
            !isDeepStrictEqual(selected.journal, selectorSelection.journalSlots.current?.value) ||
            !isDeepStrictEqual(selected.registry, prepared.sourceRegistry) ||
            (selected.purpose !== 'selectorReturn' && selected.purpose !== 'acceptedTarget') ||
            (selected.purpose === 'acceptedTarget' && !firstStartBound)) invalid();
        terminalState = 'proving';
        terminalPurpose = selected.purpose;
        const assertProving = () => {
          assertCurrent();
          if (terminalState !== 'proving') invalid();
        };
        await assertExternal();
        const runtime = await proveRuntime(selected);
        const assertRuntime = runtime.assertCurrent.bind(runtime);
        const assertRuntimeExternal = runtime.assertExternal.bind(runtime);
        const assertTerminalCurrent = () => {
          assertProving();
          assertUpdateJournalAuthority(assertRuntime);
        };
        const assertTerminal = async () => {
          assertTerminalCurrent();
          await assertRuntimeExternal();
          assertTerminalCurrent();
        };
        await assertTerminal();
        await assertExternal();
        if (selected.purpose === 'selectorReturn') {
          await cancel({ assertCurrent: assertTerminalCurrent, assertTerminal });
        } else await assertW6('beforeMigrations');
        await assertTerminal();
        await assertExternal();
        terminalState = 'issued';
        // Switch now owns its selected registry/journal writes. The returned
        // proof retains lifetime authority, not the pre-write slot snapshot.
        return Object.freeze({ assertCurrent() {
          try {
            assertCurrent();
            if (terminalState !== 'issued') invalid();
            assertUpdateJournalAuthority(assertRuntime);
          } catch (error) { failed = true; throw error; }
        } });
      });
    },
    async firstStartAuthority(w6: Pick<WorkspaceFirstStartMigrationOrchestration, 'assertDeferredBusinessReady'>,
      migrationChainIdentity: string): Promise<DeferredBusinessFirstStartAuthority> {
      const assertW6 = w6.assertDeferredBusinessReady.bind(w6);
      return checked(async () => {
        if (accepted || firstStartBound || selectorHandoffPending || terminalState !== 'unused' ||
            (hasSelectorSwitch && selectorStage !== 'settled') || !/^[0-9a-f]{64}$/.test(migrationChainIdentity)) invalid();
        firstStartBound = true;
        await assertExternal();
        await assertW6('beforeMigrations');
        return Object.freeze({ acceptedBuild: prepared.selectorMetadata, migrationChainIdentity,
          assertGenerationCurrent: assertCurrent,
          async assertCurrent() {
            await checked(async () => {
              await assertExternal();
              await assertW6(publishing ? 'beforeAcceptance' : 'beforeMigrations');
              await assertExternal();
            });
          },
        });
      });
    },
    async accept(firstStart: Pick<FirstStartUpdateCoordinator, 'acceptAfterBackendReady'>,
      w6: Pick<WorkspaceFirstStartMigrationOrchestration, 'assertDeferredBusinessReady'>) {
      const assertW6 = w6.assertDeferredBusinessReady.bind(w6);
      const acceptFirstStart = firstStart.acceptAfterBackendReady.bind(firstStart);
      await checked(async () => {
        if (!firstStartBound || accepted || acceptanceStarted || selectorHandoffPending || terminalPurpose === 'selectorReturn' ||
            (hasSelectorSwitch && selectorStage !== 'cleared')) invalid();
        acceptanceStarted = true;
        await assertExternal();
        await assertW6('beforeAcceptance');
        publishing = true;
        const record = await acceptFirstStart();
        if (record?.identity === undefined || record.value.formatVersion !== 2 ||
            record.value.acceptanceScope !== 'business' ||
            record.value.acceptedBuild.appVersion !== prepared.selectorMetadata.acceptedBuild.appVersion ||
            record.value.acceptedBuild.buildRevision !== prepared.selectorMetadata.acceptedBuild.buildRevision) invalid();
        metadata = { current: structuredClone(record), next: undefined, backup: undefined };
        publishing = false;
        await assertExternal();
        accepted = true;
      });
    },
  };
}

function invalid(): never { throw new WorkspaceManagementRecoveryRequiredError(); }
