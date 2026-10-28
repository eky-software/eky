import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingAuthority } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlot, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { WorkspaceRemnantBindingV1 } from '../deletion/workspaceRemnantBindingCodec.js';

type BindingSelection = Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>;

/** Pins this startup's observation only; never publishes, repairs or grants deletion. */
export async function captureWorkspaceBackupReplacementStartupBinding(input: Readonly<{
  userDataRoot: string;
  operationId: unknown;
  workspaceId: unknown;
  lineageIdentity: unknown;
}>, authority: WorkspaceRemnantBindingAuthority, fileSystem?: CrashSafeFileSlotFileSystem) {
  const expected = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceReplacement',
    operationId: input.operationId, workspaceId: input.workspaceId, lineageIdentity: input.lineageIdentity });
  const expectedBytes = serializeWorkspaceRemnantBinding(expected);
  const store = new WorkspaceRemnantBindingStore(input.userDataRoot, workspaceRemnantBindingKey(expected), fileSystem);
  const observe = async (owner: WorkspaceRemnantBindingAuthority): Promise<BindingSelection> => {
    const assertCurrent = captureSynchronousGuard(owner.assertAuthority.bind(owner));
    const assertExternal = owner.assertExternalSelection.bind(owner);
    const selection = await store.inspect({ assertAuthority: assertCurrent,
      async assertExternalSelection() { assertCurrent(); await assertExternal(); assertCurrent(); } });
    assertCurrent();
    if (selection.mode === 'published' && !serializeWorkspaceRemnantBinding(selection.value).equals(expectedBytes)) throw required();
    return selection;
  };
  const initial = await observe(authority);
  const pinned = copySlots(initial.slots);
  let active = false;
  let failed = false;
  return Object.freeze({
    async assertCurrent(owner: WorkspaceRemnantBindingAuthority): Promise<void> {
      if (active || failed) throw required();
      active = true;
      try {
        const selected = await observe(owner);
        if (selected.mode !== initial.mode) throw required();
        assertSameSlots(pinned, selected.slots);
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
