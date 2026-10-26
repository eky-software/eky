import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import { parseVersionedWorkspaceSwitchJournalBytes, type WorkspaceSwitchJournal } from './workspaceSwitchJournalCodec.js';

export interface WorkspaceSelectorSwitchSelection {
  readonly journalSlots: ReadOnlyJournalSlots<WorkspaceSwitchJournal>;
  readonly registrySlots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>;
  readRegistrySlots(): Promise<ReadOnlyJournalSlots<LocalWorkspaceRegistry>>;
  assertAuthority(): void;
}

// Capture before awaiting anything. A caller's mutable observation must not
// silently become a new selection while the store owns the operation.
export function captureWorkspaceSelectorSwitchSelection(selection: WorkspaceSelectorSwitchSelection) {
  const journalSlots = captureSlots(selection.journalSlots, parseVersionedWorkspaceSwitchJournalBytes);
  const registrySlots = captureSlots(selection.registrySlots, parseWorkspaceRegistryBytes);
  const authority = selection.assertAuthority.bind(selection);
  const readRegistrySlots = selection.readRegistrySlots.bind(selection);
  const assertAuthority = () => {
    const result: unknown = authority();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
    }
  };
  const guard: CrashSafeByteSlotSelection = {
    expectedSlots: {
      current: journalSlots.current?.bytes,
      next: journalSlots.next?.bytes,
      backup: journalSlots.backup?.bytes,
    },
    expectedIdentities: {
      current: journalSlots.current?.identity,
      next: journalSlots.next?.identity,
      backup: journalSlots.backup?.identity,
    },
    assertAuthority,
    async assertExternalSelection() {
      assertAuthority();
      const actual = await readRegistrySlots();
      assertAuthority();
      assertSameSlots(registrySlots, actual);
    },
  };
  return {
    journalSlots, registrySlots, guard,
    registryGuard(readJournalSlots: () => Promise<ReadOnlyJournalSlots<WorkspaceSwitchJournal>>): CrashSafeByteSlotSelection {
      return {
        expectedSlots: {
          current: registrySlots.current?.bytes,
          next: registrySlots.next?.bytes,
          backup: registrySlots.backup?.bytes,
        },
        expectedIdentities: {
          current: registrySlots.current?.identity,
          next: registrySlots.next?.identity,
          backup: registrySlots.backup?.identity,
        },
        assertAuthority,
        async assertExternalSelection() {
          assertAuthority();
          const actual = await readJournalSlots();
          assertAuthority();
          assertSameSlots(journalSlots, actual);
        },
      };
    },
    assertJournalSelection(actual: ReadOnlyJournalSlots<WorkspaceSwitchJournal>) {
      assertAuthority();
      assertSameSlots(journalSlots, actual);
    },
  };
}

function assertSameSlots<T>(expectedSlots: ReadOnlyJournalSlots<T>, actual: ReadOnlyJournalSlots<T>): void {
  for (const slot of ['current', 'next', 'backup'] as const) {
    const expected = expectedSlots[slot]?.bytes;
    const bytes = actual[slot]?.bytes;
    if (expected === undefined ? bytes !== undefined : bytes === undefined ||
      expected.byteLength !== bytes.byteLength || !expected.every((value, index) => value === bytes[index])) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
    }
    const identity = expectedSlots[slot]?.identity;
    const actualIdentity = actual[slot]?.identity;
    if (expected !== undefined && (identity === undefined || actualIdentity === undefined ||
      !sameCrashSafeFileSlotIdentity(identity, actualIdentity))) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
}

function captureSlots<T>(values: ReadOnlyJournalSlots<T>, parse: (bytes: Uint8Array) => Readonly<T>): ReadOnlyJournalSlots<T> {
  const captured: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlots<T>['current']> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const slot of ['current', 'next', 'backup'] as const) {
    const bytes = values[slot]?.bytes;
    if (bytes !== undefined) {
      const copy = Uint8Array.from(bytes);
      const identity = values[slot]?.identity;
      if (identity === undefined) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      captured[slot] = Object.freeze({ bytes: copy, value: parse(copy), identity: Object.freeze({ ...identity }) });
    }
  }
  return Object.freeze(captured);
}
