import { isDeepStrictEqual } from 'node:util';

import type { AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
import { parseVersionedAcceptedBuildMetadata, type VersionedAcceptedBuildMetadata } from '../update/acceptedBuildMetadata.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import type { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';
import type { LocalWorkspaceRegistry } from '../workspaces/registry/workspaceRegistryTypes.js';
import { assertSelectorReturnRecoveryConflictsFromRoot } from '../workspaces/runtime/workspaceColdRecoveryAdmissionComposition.js';
import { planWorkspaceSelectorSwitchSlots } from '../workspaces/switch/workspaceSelectorSwitchSlots.js';
import { resolveWorkspaceSelectorSwitchStartup, type WorkspaceSelectorSwitchObservation } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import type { WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';

// Startup-only composition of existing selected switch recovery and main's
// reservation. It never launches a runtime or manufactures a health receipt.
export async function recoverDesktopSelectorReturn(input: Readonly<{
  userDataRoot: string;
  registry: WorkspaceRegistryStore;
  journal: WorkspaceSwitchJournalStore;
  metadata: AcceptedBuildMetadataStore;
  selection: WorkspaceSelectorSwitchObservation;
  expectedRegistry: Readonly<LocalWorkspaceRegistry>;
  assertCurrent(): void;
  assertMainOwned(): Promise<void>;
  assertBuildAdmission(metadata: Readonly<VersionedAcceptedBuildMetadata>): Promise<void>;
  assertNoUpdateRecovery(): Promise<void>;
}>): Promise<void> {
  let usable = true;
  let admitted = false;
  let terminalIssued = false;
  let selected = structuredClone(input.selection);
  const plan = planWorkspaceSelectorSwitchSlots(selected.journalSlots, selected.registrySlots);
  if (plan.registry.activeWorkspaceId !== null || plan.mode === 'recoveryRequired' ||
      !isDeepStrictEqual(plan.registry, input.expectedRegistry)) invalid();
  const assertCurrent = () => {
    if (!usable) invalid();
    try { assertUpdateJournalAuthority(input.assertCurrent); }
    catch (error) { usable = false; throw error; }
  };
  try {
    assertCurrent();
    const metadata = await input.metadata.inspectSlots();
    if (metadata.current?.identity === undefined || metadata.next !== undefined || metadata.backup !== undefined) invalid();
    const metadataText = new TextDecoder('utf-8', { fatal: true }).decode(metadata.current.bytes);
    assertNoDuplicateWorkspaceRegistryKeys(metadataText);
    if (!isDeepStrictEqual(parseVersionedAcceptedBuildMetadata(JSON.parse(metadataText)), metadata.current.value)) invalid();
    await input.assertBuildAdmission(metadata.current.value);
    const assertExternalAuthority = async () => {
      assertCurrent();
      await input.assertMainOwned();
      await input.assertNoUpdateRecovery();
      await assertSelectorReturnRecoveryConflictsFromRoot(input.userDataRoot, plan.registry);
      if (!isDeepStrictEqual(await input.metadata.inspectSlots(), metadata)) invalid();
      await input.assertMainOwned();
      assertCurrent();
    };
    const assertExternal = async () => {
      await assertExternalAuthority();
      if (!isDeepStrictEqual(await input.registry.inspectSlots(), selected.registrySlots) ||
          !isDeepStrictEqual(await input.journal.inspectSlots(), selected.journalSlots)) invalid();
      await assertExternalAuthority();
    };
    // No repairing reader or selected writer runs before all other owners and
    // the current installation's absence proof have admitted this return.
    await assertExternal();
    const result = await resolveWorkspaceSelectorSwitchStartup({
      registry: input.registry, journal: input.journal,
      selection: { ...selected, readRegistrySlots: () => input.registry.inspectSlots(), assertAuthority: assertCurrent },
      authority: {
        assertCurrent,
        assertExternal: assertExternalAuthority,
        async admitSelection(observation) {
          if (admitted || !isDeepStrictEqual(observation, selected)) invalid();
          admitted = true;
          await assertExternal();
        },
        async didSettleSelection(receipt) {
          if (!admitted || terminalIssued || receipt.phase !== 'startup' ||
              !isDeepStrictEqual(receipt.before, selected)) invalid();
          const after = planWorkspaceSelectorSwitchSlots(receipt.after.journalSlots, receipt.after.registrySlots);
          if (!isDeepStrictEqual(after.registry, plan.registry) || !isDeepStrictEqual(after.journal, plan.journal)) invalid();
          await receipt.assertCurrent();
          selected = structuredClone(receipt.after);
          await assertExternal();
          await receipt.assertCurrent();
        },
        async proveTerminal(request) {
          if (!admitted || terminalIssued || request.purpose !== 'selectorReturn' ||
              !isDeepStrictEqual(request.registry, plan.registry) ||
              !isDeepStrictEqual(request.journal, plan.journal)) invalid();
          await assertExternal();
          terminalIssued = true;
          return Object.freeze({ assertCurrent });
        },
      },
    });
    if (result.mode !== 'selector' || !terminalIssued) invalid();
    await result.assertCurrent();
    if (!isDeepStrictEqual(await input.metadata.inspectSlots(), metadata)) invalid();
    await input.assertNoUpdateRecovery();
    await input.assertMainOwned();
    await result.assertCurrent();
  } finally { usable = false; }
}

function invalid(): never { throw new WorkspaceManagementRecoveryRequiredError(); }
