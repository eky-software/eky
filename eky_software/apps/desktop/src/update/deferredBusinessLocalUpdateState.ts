import { isDeepStrictEqual } from 'node:util';

import { sameCrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';
import { parseWorkspaceRegistryBytes } from '../workspaces/registry/workspaceRegistryBytes.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryV2 } from '../workspaces/registry/workspaceRegistryTypes.js';
import { planWorkspaceSelectorSwitchSlots } from '../workspaces/switch/workspaceSelectorSwitchSlots.js';
import type { WorkspaceSwitchJournal } from '../workspaces/switch/workspaceSwitchJournal.js';
import {
  assertWorkspaceFirstStartMigrationJournalTransition,
  parseWorkspaceFirstStartMigrationJournalBytes,
} from '../workspaces/update/workspaceFirstStartMigrationJournalCodec.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from '../workspaces/update/workspaceFirstStartMigrationJournalTypes.js';
import {
  calculateWorkspaceRegistrySha256,
  markPassiveWorkspacesRecoveryRequired,
  restoreJournaledPassiveWorkspacesReady,
} from '../workspaces/update/workspaceFirstStartMigrationRegistryTransitions.js';
import {
  parseVersionedAcceptedBuildMetadata,
  type ScopedAcceptedBuildMetadata,
  type VersionedAcceptedBuildMetadata,
} from './acceptedBuildMetadata.js';
import type { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import { assertUpdateJournalAuthority } from './updateJournalStore.js';

type Slot = 'current' | 'next' | 'backup';
const slots = ['current', 'next', 'backup'] as const;

export interface DeferredBusinessLocalUpdateState {
  readonly metadata: ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>;
  readonly legacyMetadata: ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>;
  readonly updateJournal: ReadOnlyJournalSlots<unknown>;
  readonly legacyUpdateJournal: ReadOnlyJournalSlots<unknown>;
  readonly directSetupRecovery: ReadOnlyJournalSlots<unknown>;
  readonly registry: ReadOnlyJournalSlots<LocalWorkspaceRegistry>;
  readonly switchJournal: ReadOnlyJournalSlots<WorkspaceSwitchJournal>;
  readonly firstStartJournal: ReadOnlyJournalSlots<WorkspaceFirstStartMigrationJournalV1>;
  readonly runningBuild: Readonly<{ appVersion: string; buildRevision: string; releaseChannel: 'pilot' }>;
}

export interface DeferredBusinessLocalUpdatePlan {
  readonly metadataSlot: 'current' | 'backup';
  readonly metadata: Readonly<ScopedAcceptedBuildMetadata>;
  readonly selectorMetadata: Readonly<ScopedAcceptedBuildMetadata>;
  readonly registry: Readonly<LocalWorkspaceRegistryV2>;
  readonly sourceRegistry: Readonly<LocalWorkspaceRegistryV2>;
  readonly firstStartJournal: Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined;
  readonly businessAccepted: boolean;
}

export interface DeferredBusinessLocalUpdatePreparation {
  readonly metadataStore: Pick<AcceptedBuildMetadataStore, 'inspectSlots' | 'recoverSelected'>;
  readonly observedMetadata?: ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>;
  // Main supplies non-repairing readers and proves writer absence. This
  // callback must not read metadata while its store is recovering its slots.
  inspectExternalState(): Promise<Omit<DeferredBusinessLocalUpdateState, 'metadata'>>;
  assertAuthority(): void;
}

export interface PreparedDeferredBusinessLocalUpdate extends DeferredBusinessLocalUpdatePlan {
  readonly selectedState: Readonly<DeferredBusinessLocalUpdateState>;
}

export async function prepareDeferredBusinessLocalUpdateState(
  input: DeferredBusinessLocalUpdatePreparation,
): Promise<Readonly<PreparedDeferredBusinessLocalUpdate>> {
  const authority = input.assertAuthority.bind(input);
  const assertAuthority = () => assertUpdateJournalAuthority(authority);
  const inspectExternalState = input.inspectExternalState.bind(input);
  const inspectMetadata = input.metadataStore.inspectSlots.bind(input.metadataStore);
  const recoverMetadata = input.metadataStore.recoverSelected.bind(input.metadataStore);
  const observedMetadata = input.observedMetadata === undefined ? undefined : structuredClone(input.observedMetadata);
  assertAuthority();
  const metadata = observedMetadata ?? structuredClone(await inspectMetadata());
  assertAuthority();
  const external = structuredClone(await inspectExternalState());
  assertAuthority();
  for (const observed of [external.legacyMetadata, external.updateJournal,
    external.legacyUpdateJournal, external.directSetupRecovery, external.registry,
    external.switchJournal, external.firstStartJournal]) {
    for (const slot of slots) {
      if (observed[slot] !== undefined && observed[slot].identity === undefined) invalid();
    }
  }
  const plan = planDeferredBusinessLocalUpdateState({ ...external, metadata });
  const selected = metadata[plan.metadataSlot];
  if (selected?.identity === undefined) invalid();
  const assertExternalSelection = async () => {
    assertAuthority();
    const actual = structuredClone(await inspectExternalState());
    assertAuthority();
    if (!isDeepStrictEqual(actual, external)) invalid();
  };
  const identity = await recoverMetadata({
    expectedSlots: { current: metadata.current?.bytes, next: metadata.next?.bytes, backup: metadata.backup?.bytes },
    expectedIdentities: { current: metadata.current?.identity, next: metadata.next?.identity, backup: metadata.backup?.identity },
    assertAuthority, assertExternalSelection,
  });
  await assertExternalSelection();
  const recovered = await inspectMetadata();
  assertAuthority();
  if (recovered.next !== undefined || recovered.backup !== undefined ||
      recovered.current?.identity === undefined ||
      !sameCrashSafeFileSlotIdentity(recovered.current.identity, identity) ||
      !Buffer.from(recovered.current.bytes).equals(selected.bytes)) invalid();
  await assertExternalSelection();
  // This readback is not business readiness or permission for another mutation.
  return Object.freeze({ ...plan, metadataSlot: 'current',
    selectedState: structuredClone({ ...external, metadata: recovered }) });
}

// Read admission only. Main must preserve these observations and renew its
// ownership/selection inside the existing mutation owners before any repair.
export function planDeferredBusinessLocalUpdateState(
  input: Readonly<DeferredBusinessLocalUpdateState>,
): Readonly<DeferredBusinessLocalUpdatePlan> {
  for (const foreign of [input.legacyMetadata, input.updateJournal,
    input.legacyUpdateJournal, input.directSetupRecovery]) {
    if (hasSlots(foreign)) invalid();
  }
  const metadata = readSlots(input.metadata, bytes => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceRegistryKeys(text);
    const value = parseVersionedAcceptedBuildMetadata(JSON.parse(text));
    if (value.formatVersion !== 2) invalid();
    return value;
  });
  const metadataSlot = metadata.current !== undefined ? 'current' : 'backup';
  const selected = metadata[metadataSlot];
  if (selected === undefined || (metadata.current !== undefined && metadata.next !== undefined && metadata.backup !== undefined)) invalid();
  const selector = selected.acceptanceScope === 'selector' ? selected : metadata.backup;
  if (selector?.acceptanceScope !== 'selector' || !sameBuild(selector.acceptedBuild, input.runningBuild) ||
      selector.acceptedBuild.releaseChannel !== input.runningBuild.releaseChannel) invalid();
  const accepted = selected.acceptanceScope === 'business';
  if (accepted) {
    if (metadataSlot !== 'current' || metadata.next !== undefined || metadata.backup !== selector ||
        !isBusinessSuccessor(selector, selected)) invalid();
  } else {
    if ((metadataSlot === 'current' && metadata.backup !== undefined) ||
        (metadata.next !== undefined && !isBusinessSuccessor(selector, metadata.next))) invalid();
  }

  const registries = readSlots(input.registry, bytes => {
    const value = parseWorkspaceRegistryBytes(bytes);
    if (value.formatVersion !== 2) invalid();
    return value;
  });
  const journals = readSlots(input.firstStartJournal, parseWorkspaceFirstStartMigrationJournalBytes);
  const journal = selectFirstStartJournal(journals);
  let registry: Readonly<LocalWorkspaceRegistryV2>;
  const switchPending = hasSlots(input.switchJournal);
  if (switchPending) {
    const plan = planWorkspaceSelectorSwitchSlots(input.switchJournal, input.registry);
    if (accepted || (plan.mode !== 'validateTarget' && plan.mode !== 'completeSelection')) invalid();
    registry = plan.registry;
    const initialPreparation = journals.current === undefined && journals.backup === undefined &&
      journals.next?.state === 'prepared';
    if (journal !== undefined && (journal.state !== 'prepared' ||
        (hasSideSlots(journals) && !initialPreparation) || hasSideSlots(registries) ||
        hasSideSlots(input.switchJournal) ||
        calculateWorkspaceRegistrySha256(registry) !== journal.sourceRegistrySha256)) invalid();
  } else {
    const selectedRegistry = registries.current ?? registries.backup;
    if (selectedRegistry === undefined || (registries.current !== undefined && registries.next !== undefined && registries.backup !== undefined)) invalid();
    registry = selectedRegistry;
  }
  if (registry.activeWorkspaceId === null ||
      registry.workspaces.find(entry => entry.workspaceId === registry.activeWorkspaceId)?.lifecycleState !== 'ready') invalid();
  if (hasSideSlots(metadata) && (switchPending || hasSideSlots(registries) || hasSideSlots(journals))) invalid();

  let sourceRegistry = registry;
  if (journal === undefined) {
    if (!switchPending && (registries.current === undefined || hasSideSlots(registries))) invalid();
  } else {
    if (!sameBuild(journal.sourceBuild, selector.businessBaseline) ||
        !sameBuild(journal.targetBuild, selector.acceptedBuild) ||
        journal.activeWorkspaceId !== registry.activeWorkspaceId) invalid();
    const hash = calculateWorkspaceRegistrySha256(registry);
    if (hash === journal.transitionedRegistrySha256 && hash !== journal.sourceRegistrySha256) {
      const original = restoreJournaledPassiveWorkspacesReady({ registry,
        expectedActiveWorkspaceId: journal.activeWorkspaceId,
        passiveRecoveryWorkspaceIds: journal.passiveRecoveryWorkspaceIds,
        sourceRegistrySha256: journal.sourceRegistrySha256,
        transitionedRegistrySha256: journal.transitionedRegistrySha256 });
      if (original.formatVersion !== 2) invalid();
      sourceRegistry = original;
    } else if (hash !== journal.sourceRegistrySha256) invalid();
    const transitioned = markPassiveWorkspacesRecoveryRequired(sourceRegistry,
      journal.activeWorkspaceId, journal.passiveRecoveryWorkspaceIds);
    if (calculateWorkspaceRegistrySha256(transitioned) !== journal.transitionedRegistrySha256) invalid();
    for (const value of Object.values(registries)) {
      if (!isDeepStrictEqual(value, sourceRegistry) && !isDeepStrictEqual(value, transitioned)) invalid();
    }
    const assertRegistryEdge = (from: Readonly<LocalWorkspaceRegistryV2>, to: Readonly<LocalWorkspaceRegistryV2>) => {
      if (journal.state === 'registryTransitioned' &&
          !isDeepStrictEqual(sourceRegistry, transitioned) &&
          isDeepStrictEqual(from, sourceRegistry) && isDeepStrictEqual(to, transitioned)) invalid();
    };
    if (registries.backup !== undefined && registries.current !== undefined) {
      assertRegistryEdge(registries.backup, registries.current);
    }
    const selectedRegistry = registries.current ?? registries.backup;
    if (selectedRegistry !== undefined && registries.next !== undefined) {
      assertRegistryEdge(selectedRegistry, registries.next);
    }
    if (journal.state === 'registryTransitioned' && registries.current === undefined &&
        registries.next === undefined && hash !== journal.transitionedRegistrySha256) invalid();
    if (hasSideSlots(registries) && hasSideSlots(journals)) invalid();
    // Preparation must publish before registry mutation; transition publication
    // must settle before source recovery can restore the registry.
    if (journals.current === undefined && journals.backup === undefined &&
        hash !== journal.sourceRegistrySha256) invalid();
    if ((journals.next?.state === 'registryTransitioned' ||
        (journals.current?.state === 'registryTransitioned' && journals.backup !== undefined)) &&
        hash !== journal.transitionedRegistrySha256) invalid();
    if (accepted && (hash !== journal.transitionedRegistrySha256 || hasSideSlots(registries))) invalid();
  }
  return Object.freeze({ metadataSlot, metadata: selected, selectorMetadata: selector,
    registry, sourceRegistry, firstStartJournal: journal, businessAccepted: accepted });
}

function readSlots<T, R>(input: ReadOnlyJournalSlots<T>, parse: (bytes: Uint8Array) => Readonly<R>) {
  const result: Partial<Record<Slot, Readonly<R>>> = {};
  for (const slot of slots) {
    const record = input[slot];
    if (record === undefined) continue;
    const value = parse(record.bytes);
    if (!isDeepStrictEqual(value, record.value)) invalid();
    result[slot] = value;
  }
  return result;
}

function selectFirstStartJournal(values: Partial<Record<Slot, Readonly<WorkspaceFirstStartMigrationJournalV1>>>) {
  const { current, next, backup } = values;
  if (current !== undefined && next !== undefined && backup !== undefined) invalid();
  if (backup !== undefined && current !== undefined) assertWorkspaceFirstStartMigrationJournalTransition(backup, current);
  const selected = current ?? backup;
  if (next !== undefined) assertWorkspaceFirstStartMigrationJournalTransition(selected, next);
  // Existing W6 recovery owns next-only initial preparation too.
  return selected ?? next;
}

function hasSlots(values: ReadOnlyJournalSlots<unknown>): boolean {
  return slots.some(slot => values[slot] !== undefined);
}
function hasSideSlots(values: Partial<Record<Slot, unknown>>): boolean {
  return values.next !== undefined || values.backup !== undefined;
}
function sameBuild(left: Readonly<{ appVersion: string; buildRevision: string }>,
  right: Readonly<{ appVersion: string; buildRevision: string }>): boolean {
  return left.appVersion === right.appVersion && left.buildRevision === right.buildRevision;
}
function isBusinessSuccessor(source: Readonly<ScopedAcceptedBuildMetadata>, target: Readonly<ScopedAcceptedBuildMetadata>): boolean {
  return target.acceptanceScope === 'business' && sameBuild(source.acceptedBuild, target.acceptedBuild) &&
    source.acceptedBuild.releaseChannel === target.acceptedBuild.releaseChannel;
}
function invalid(): never { throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT'); }
