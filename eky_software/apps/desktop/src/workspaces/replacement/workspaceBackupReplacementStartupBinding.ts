import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingAuthority } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlot, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { validateWorkspaceBackupReplacementOperationId } from './workspaceBackupReplacementOperationId.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import type { ActiveWorkspaceStartupMode } from '../runtime/resolveActiveWorkspaceStartup.js';

interface StartupBindingInput {
  readonly userDataRoot: string;
  readonly operationId: unknown;
  readonly workspaceId: unknown;
  readonly lineageIdentity: unknown;
  readonly switchContext?: Readonly<{ operationId: unknown; sourceWorkspaceId: unknown; targetWorkspaceId: unknown }>;
}

type BindingSelection = Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>;
const activationOwners = ['workspaceReplacement', 'workspaceActivationMigration'] as const;
type ActivationOwner = (typeof activationOwners)[number];

/** Pins this startup's observation only; never publishes, repairs or grants deletion. */
export async function captureWorkspaceBackupReplacementStartupBinding(input: StartupBindingInput, authority: WorkspaceRemnantBindingAuthority,
fileSystems?: Readonly<Partial<Record<ActivationOwner, CrashSafeFileSlotFileSystem>>>) {
  const operationId = validateWorkspaceBackupReplacementOperationId(input.operationId);
  const workspaceId = validateWorkspaceId(input.workspaceId);
  const lineage = input.lineageIdentity === undefined ? undefined : validateWorkspaceLineage(input.lineageIdentity);
  const context = input.switchContext;
  const switchContext = context === undefined ? undefined : Object.freeze({
    operationId: validateWorkspaceBackupReplacementOperationId(context.operationId),
    sourceWorkspaceId: context.sourceWorkspaceId === null ? null : validateWorkspaceId(context.sourceWorkspaceId),
    targetWorkspaceId: validateWorkspaceId(context.targetWorkspaceId),
  });
  const stores = activationOwners.map(owner => ({ owner, store: new WorkspaceRemnantBindingStore(input.userDataRoot,
    { owner, operationId }, fileSystems?.[owner]) }));
  const observe = async (owner: WorkspaceRemnantBindingAuthority) => {
    const assertCurrent = captureSynchronousGuard(owner.assertAuthority.bind(owner));
    const assertExternal = owner.assertExternalSelection.bind(owner);
    const selections: BindingSelection[] = [];
    let mode: ActivationOwner | 'legacyUnbound' = 'legacyUnbound';
    for (const { owner: bindingOwner, store } of stores) {
      const selection = await store.inspect({ assertAuthority: assertCurrent,
        async assertExternalSelection() { assertCurrent(); await assertExternal(); assertCurrent(); } });
      assertCurrent();
      if (selection.mode === 'published') {
        if (mode !== 'legacyUnbound' || lineage === undefined) throw required();
        const expected = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: bindingOwner,
          operationId, workspaceId, lineageIdentity: lineage });
        if (!serializeWorkspaceRemnantBinding(selection.value).equals(serializeWorkspaceRemnantBinding(expected))) throw required();
        if (bindingOwner === 'workspaceActivationMigration' &&
            (switchContext === undefined || switchContext.operationId !== operationId ||
              switchContext.targetWorkspaceId !== workspaceId || switchContext.sourceWorkspaceId === workspaceId)) throw required();
        mode = bindingOwner;
      }
      selections.push(selection);
    }
    assertCurrent();
    return { mode, selections };
  };
  const initial = await observe(authority);
  const pinned = initial.selections.map(selection => copySlots(selection.slots));
  let active = false;
  let failed = false;
  return Object.freeze({
    mode: initial.mode,
    async assertCurrent(owner: WorkspaceRemnantBindingAuthority): Promise<void> {
      if (active || failed) throw required();
      active = true;
      try {
        const selected = await observe(owner);
        if (selected.mode !== initial.mode) throw required();
        for (let index = 0; index < pinned.length; index++) {
          assertSameSlots(pinned[index]!, selected.selections[index]!.slots);
        }
      } catch (error) { failed = true; throw error; }
      finally { active = false; }
    },
  });
}

/** The caller owns time, I/O settlement and leases; this only pins readonly metadata. */
export async function captureWorkspaceBackupReplacementStartupSelection(
  input: StartupBindingInput & { readonly mode: ActiveWorkspaceStartupMode },
  assertAuthority: () => void,
  sources: Readonly<{
    registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
    switchJournal: Pick<WorkspaceSwitchJournalStore, 'inspectSlots'>;
  }>,
) {
  const workspaceId = validateWorkspaceId(input.workspaceId);
  const lineage = input.lineageIdentity === undefined ? undefined : validateWorkspaceLineage(input.lineageIdentity);
  const context = input.switchContext;
  const captured = Object.freeze({ userDataRoot: input.userDataRoot,
    operationId: validateWorkspaceBackupReplacementOperationId(input.operationId), workspaceId,
    lineageIdentity: lineage, mode: input.mode,
    ...(context === undefined ? {} : { switchContext: Object.freeze({
      operationId: validateWorkspaceBackupReplacementOperationId(context.operationId),
      sourceWorkspaceId: context.sourceWorkspaceId === null ? null : validateWorkspaceId(context.sourceWorkspaceId),
      targetWorkspaceId: validateWorkspaceId(context.targetWorkspaceId),
    }) }),
  });
  const readRegistry = sources.registry.inspectSlots.bind(sources.registry);
  const readSwitch = sources.switchJournal.inspectSlots.bind(sources.switchJournal);
  let pinned: Readonly<{ registry: ReturnType<typeof copySlots>; journal: ReturnType<typeof copySlots> }> | undefined;
  let closed = false;
  const owner = (assertPhaseCurrent: () => void): WorkspaceRemnantBindingAuthority => {
    const assertPhase = captureSynchronousGuard(assertPhaseCurrent);
    const assertCurrent = () => { if (closed) throw required(); assertPhase(); };
    return Object.freeze({
      assertAuthority: assertCurrent,
      async assertExternalSelection() {
        assertCurrent();
        let failure: { readonly cause: unknown } | undefined;
        const assertReading = () => {
          if (failure !== undefined) throw failure.cause;
          try { assertCurrent(); }
          catch (cause) { failure ??= { cause }; throw cause; }
        };
        const read = async <T>(inspect: (guard: () => void) => Promise<T>): Promise<T> => {
          try {
            assertReading();
            const value = await inspect(assertReading);
            assertReading();
            return value;
          } catch (cause) { failure ??= { cause }; throw cause; }
        };
        // Independent readonly stores share one guard; join both original reads, including closes.
        const [registryResult, journalResult] = await Promise.allSettled([read(readRegistry), read(readSwitch)]);
        if (failure !== undefined) throw failure.cause;
        if (registryResult.status !== 'fulfilled' || journalResult.status !== 'fulfilled') throw required();
        const registry = registryResult.value;
        const journal = journalResult.value;
        assertCurrent();
        if (pinned === undefined) {
          const selected = (registry.current ?? registry.backup ?? registry.next)?.value;
          if (lineage !== undefined) {
            const entry = selected?.workspaces.find(value => value.workspaceId === workspaceId);
            if (selected?.activeWorkspaceId !== workspaceId || entry?.lifecycleState !== 'ready' ||
                entry.lineageIdentity.profileId !== lineage.profileId) throw required();
          }
          const selectedSwitch = (journal.current ?? journal.backup ?? journal.next)?.value;
          const expected = captured.switchContext;
          if (expected === undefined ? selectedSwitch !== undefined
            : selectedSwitch === undefined || selectedSwitch.operationId !== expected.operationId ||
              selectedSwitch.sourceWorkspaceId !== expected.sourceWorkspaceId ||
              selectedSwitch.targetWorkspaceId !== expected.targetWorkspaceId ||
              (captured.mode === 'targetValidation' ? selectedSwitch.state !== 'targetSelected'
                : captured.mode !== 'rollbackValidation' || selectedSwitch.state !== 'rollbackSelected')) throw required();
          pinned = Object.freeze({ registry: copySlots(registry), journal: copySlots(journal) });
        } else {
          assertSameSlots(pinned.registry, registry);
          assertSameSlots(pinned.journal, journal);
        }
        assertCurrent();
      },
    });
  };
  // One readonly observation has no publication between its two binding reads.
  // Bracket it with fresh metadata; retain the phase guard inside every read.
  const observe = async <T>(assertPhaseCurrent: () => void,
    read: (authority: WorkspaceRemnantBindingAuthority) => Promise<T>): Promise<T> => {
    const authority = owner(assertPhaseCurrent);
    await authority.assertExternalSelection();
    const result = await read({ assertAuthority: authority.assertAuthority,
      async assertExternalSelection() { authority.assertAuthority(); } });
    await authority.assertExternalSelection();
    return result;
  };
  const binding = await observe(assertAuthority,
    authority => captureWorkspaceBackupReplacementStartupBinding(captured, authority));
  if (pinned === undefined) throw required();
  let active = false;
  let failed = false;
  return Object.freeze({
    mode: binding.mode,
    async assertCurrent(assertPhaseCurrent: () => void): Promise<void> {
      if (active || failed || closed) throw required();
      active = true;
      try { await observe(assertPhaseCurrent, authority => binding.assertCurrent(authority)); }
      catch (error) { failed = true; throw error; }
      finally { active = false; }
    },
    close() { closed = true; },
  });
}

function copySlots<T>(slots: ReadOnlyJournalSlots<T>) {
  const result: Record<CrashSafeFileSlot, { bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> | undefined } | undefined> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const slot of ['current', 'next', 'backup'] as const) {
    const record = slots[slot];
    result[slot] = record === undefined ? undefined : {
      bytes: Uint8Array.from(record.bytes),
      identity: record.identity === undefined ? undefined : Object.freeze({ ...record.identity }),
    };
  }
  return result;
}

function assertSameSlots<T>(expected: ReturnType<typeof copySlots>, actual: ReadOnlyJournalSlots<T>): void {
  for (const slot of ['current', 'next', 'backup'] as const) {
    const before = expected[slot];
    const after = actual[slot];
    if (before === undefined && after === undefined) continue;
    if (before === undefined || after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) ||
        before.bytes.byteLength !== after.bytes.byteLength || !before.bytes.every((value, index) => value === after.bytes[index])) {
      throw required();
    }
  }
}

function captureSynchronousGuard(assertCurrent: () => void): () => void {
  return () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => {});
      throw required();
    }
  };
}

function required(): Error { return new Error('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED'); }
