import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { PreparedDeferredBusinessLocalUpdate, DeferredBusinessLocalUpdateState } from '../update/deferredBusinessLocalUpdateState.js';
import type { DeferredBusinessFirstStartAuthority, FirstStartUpdateCoordinator } from '../update/firstStartUpdateCoordinator.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import type { WorkspaceFirstStartMigrationCompositionOptions } from '../workspaces/update/workspaceFirstStartMigrationComposition.js';
import type { WorkspaceFirstStartMigrationOrchestration } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorTypes.js';
import { calculateWorkspaceRegistrySha256, markPassiveWorkspacesRecoveryRequired } from '../workspaces/update/workspaceFirstStartMigrationRegistryTransitions.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';

export type DesktopDeferredBusinessExternalState = Pick<DeferredBusinessLocalUpdateState,
  'metadata' | 'legacyMetadata' | 'updateJournal' | 'legacyUpdateJournal' | 'directSetupRecovery' | 'switchJournal'>;

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
  const assertStartup = input.assertCurrent.bind(input);
  const inspectExternal = input.inspectExternal.bind(input);
  let metadata = original.metadata;
  let failed = false;
  let publishing = false;
  let accepted = prepared.businessAccepted;
  let firstStartBound = false;
  let preparationBound = false;
  let acceptanceStarted = false;
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
      for (const name of ['legacyMetadata', 'updateJournal', 'legacyUpdateJournal', 'directSetupRecovery', 'switchJournal'] as const) {
        if (!isDeepStrictEqual(actual[name], original[name])) invalid();
      }
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
          if (preparationBound || accepted || publishing || journal.operationId !== operationId ||
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
    async firstStartAuthority(w6: Pick<WorkspaceFirstStartMigrationOrchestration, 'assertDeferredBusinessReady'>,
      migrationChainIdentity: string): Promise<DeferredBusinessFirstStartAuthority> {
      const assertW6 = w6.assertDeferredBusinessReady.bind(w6);
      return checked(async () => {
        if (accepted || firstStartBound || !/^[0-9a-f]{64}$/.test(migrationChainIdentity)) invalid();
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
        if (!firstStartBound || accepted || acceptanceStarted) invalid();
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
