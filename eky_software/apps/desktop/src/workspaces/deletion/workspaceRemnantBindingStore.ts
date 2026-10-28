import { CrashSafeByteSlotStore, type CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlot, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { checkedDeletionAuthority, deletionDigest, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceRemnantBinding, captureWorkspaceRemnantBindingKey, maximumWorkspaceRemnantBindingBytes,
  parseWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256,
  workspaceRemnantBindingInvalidCode as invalidCode,
  type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { inspectWorkspaceRemnantBindingDirectory } from './workspaceRemnantBindingDirectory.js';

export interface WorkspaceRemnantBindingAuthority {
  assertAuthority(): void;
  // The owner checks its exact target/lineage and the live installation reservation.
  assertExternalSelection(): Promise<void>;
}

export interface WorkspaceRemnantBindingCleanup extends WorkspaceRemnantBindingAuthority {
  readonly mode: 'owner' | 'deletionPurged';
  readonly bindingSha256: string;
  // All roots and all writers, not just the journal or current inspection copy.
  assertPayloadsAbsent(): Promise<void>;
  // For deletionPurged, assertExternalSelection also proves the selected purged journal,
  // complete committed inventory and exact after-registry; this method only removes metadata.
}

export class WorkspaceRemnantBindingStore {
  private readonly key: ReturnType<typeof captureWorkspaceRemnantBindingKey>;
  private readonly fileSystem: CrashSafeFileSlotFileSystem;
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(private readonly userDataRoot: string, key: unknown, fileSystem?: CrashSafeFileSlotFileSystem,
    private readonly readDirectoryIdentity = readDeletionInventoryDirectoryIdentity) {
    this.key = captureWorkspaceRemnantBindingKey(key);
    const paths = createWorkspaceRemnantBindingPaths(userDataRoot, this.key);
    this.fileSystem = fileSystem ?? createNodeCrashSafeFileSlotFileSystem(
      paths, maximumWorkspaceRemnantBindingBytes);
    this.byteStore = new CrashSafeByteSlotStore(this.fileSystem);
  }

  inspect(authority: WorkspaceRemnantBindingAuthority) {
    return this.exclusive(async () => {
      const selected = await this.observe(authority);
      const records = Object.values(selected.slots).filter(value => value !== undefined);
      if (records.length === 0) return Object.freeze({ mode: 'absent' as const, slots: selected.slots });
      if (selected.slots.current === undefined) return invalidDeletionData(invalidCode);
      const value = selected.slots.current.value;
      this.assertSameValues(selected.slots, value);
      return Object.freeze({ mode: 'published' as const, value, bindingSha256: workspaceRemnantBindingSha256(value), slots: selected.slots });
    });
  }

  publish(value: unknown, authority: WorkspaceRemnantBindingAuthority) {
    return this.exclusive(async () => {
      const binding = this.captureBinding(value);
      const selected = await this.observe(authority);
      if (Object.values(selected.slots).some(record => record !== undefined)) return invalidDeletionData(invalidCode);
      await createNodeCrashSafeFileSlotFileSystem(createWorkspaceDeletionJournalPaths(this.userDataRoot), 1)
        .prepareDirectory({ assertAuthority: selected.guard.assertAuthority, beforeMutation: selected.guard.assertExternalSelection });
      const identity = await this.byteStore.replaceSelected(serializeWorkspaceRemnantBinding(binding), selected.guard);
      return Object.freeze({ value: binding, bindingSha256: workspaceRemnantBindingSha256(binding), identity });
    });
  }

  clearAfterPayloadsAbsent(value: unknown, proof: WorkspaceRemnantBindingCleanup) {
    return this.exclusive(async () => {
      const expected = this.captureBinding(value);
      const mode = proof.mode;
      if ((mode !== 'owner' && mode !== 'deletionPurged') ||
          deletionDigest(proof.bindingSha256, invalidCode) !== workspaceRemnantBindingSha256(expected)) {
        return invalidDeletionData(invalidCode);
      }
      const external = proof.assertExternalSelection.bind(proof);
      const absent = proof.assertPayloadsAbsent.bind(proof);
      const assertAuthority = checkedDeletionAuthority(proof.assertAuthority.bind(proof), invalidCode);
      const authority = { assertAuthority, assertExternalSelection: async () => {
        assertAuthority();
        await external();
        assertAuthority();
        await absent();
        assertAuthority();
        await external();
        assertAuthority();
      } };
      const selected = await this.observe(authority);
      this.assertSameValues(selected.slots, expected);
      if (mode === 'owner' && selected.slots.current === undefined &&
          (selected.slots.next !== undefined || selected.slots.backup !== undefined)) return invalidDeletionData(invalidCode);
      if (Object.values(selected.slots).every(record => record === undefined)) {
        const before = await inspectWorkspaceRemnantBindingDirectory(this.userDataRoot, this.key, assertAuthority, this.readDirectoryIdentity);
        if (!before.present) {
          const fresh = await this.observe(authority);
          const after = await inspectWorkspaceRemnantBindingDirectory(this.userDataRoot, this.key, assertAuthority, this.readDirectoryIdentity);
          if (Object.values(fresh.slots).some(record => record !== undefined) || after.present ||
              after.ancestorPath !== before.ancestorPath || after.ancestorIdentity !== before.ancestorIdentity) {
            return invalidDeletionData(invalidCode);
          }
          await selected.guard.assertExternalSelection();
          return;
        }
      }
      await this.byteStore.clearSelected(selected.guard);
    });
  }

  private captureBinding(value: unknown) {
    const binding = captureWorkspaceRemnantBinding(value);
    if (JSON.stringify(workspaceRemnantBindingKey(binding)) !== JSON.stringify(this.key)) return invalidDeletionData(invalidCode);
    return binding;
  }

  private assertSameValues(slots: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>, expected: WorkspaceRemnantBindingV1) {
    const bytes = serializeWorkspaceRemnantBinding(expected);
    if (Object.values(slots).some(record => record !== undefined && !serializeWorkspaceRemnantBinding(record.value).equals(bytes))) {
      invalidDeletionData(invalidCode);
    }
  }

  private async observe(authority: WorkspaceRemnantBindingAuthority) {
    const assertAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
    const external = authority.assertExternalSelection.bind(authority);
    const assertExternalSelection = async () => { assertAuthority(); await external(); assertAuthority(); };
    await assertExternalSelection();
    const slots: Record<CrashSafeFileSlot, ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>['current']> = {
      current: undefined, next: undefined, backup: undefined,
    };
    for (const slot of ['current', 'next', 'backup'] as const) {
      assertAuthority();
      let identity: CrashSafeFileSlotIdentity | undefined;
      const bytes = await this.fileSystem.readSlot(slot, value => { identity = value; });
      assertAuthority();
      if (bytes === undefined) continue;
      if (identity === undefined) return invalidDeletionData(invalidCode);
      slots[slot] = Object.freeze({ bytes: Uint8Array.from(bytes), value: this.captureBinding(parseWorkspaceRemnantBinding(bytes)),
        identity: Object.freeze({ ...identity }) });
    }
    await assertExternalSelection();
    const guard: CrashSafeByteSlotSelection = { assertAuthority, assertExternalSelection,
      expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
      expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity } };
    return Object.freeze({ slots: Object.freeze(slots), guard });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeOperation) return invalidDeletionData(invalidCode);
    this.activeOperation = true;
    try { return await work(); } finally { this.activeOperation = false; }
  }
}
