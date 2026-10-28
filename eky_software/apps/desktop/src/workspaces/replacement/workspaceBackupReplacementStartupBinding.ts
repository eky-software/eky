import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingAuthority } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlot, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { WorkspaceRemnantBindingV1 } from '../deletion/workspaceRemnantBindingCodec.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { validateWorkspaceBackupReplacementOperationId } from './workspaceBackupReplacementOperationId.js';

type BindingSelection = Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>;
const activationOwners = ['workspaceReplacement', 'workspaceActivationMigration'] as const;
type ActivationOwner = (typeof activationOwners)[number];

/** Pins this startup's observation only; never publishes, repairs or grants deletion. */
export async function captureWorkspaceBackupReplacementStartupBinding(input: Readonly<{
  userDataRoot: string;
  operationId: unknown;
  workspaceId: unknown;
  lineageIdentity: unknown;
  switchContext?: Readonly<{ operationId: unknown; sourceWorkspaceId: unknown; targetWorkspaceId: unknown }>;
}>, authority: WorkspaceRemnantBindingAuthority,
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

function copySlots(slots: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>) {
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

function assertSameSlots(expected: ReturnType<typeof copySlots>, actual: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>): void {
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
