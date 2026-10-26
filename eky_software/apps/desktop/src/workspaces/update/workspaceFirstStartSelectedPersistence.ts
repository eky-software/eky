import { isDeepStrictEqual } from 'node:util';

import { assertUpdateJournalAuthority } from '../../update/updateJournalStore.js';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import type { CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import type { WorkspaceSelectorSwitchSettlement } from '../switch/workspaceSelectorSwitchStartup.js';
import {
  parseWorkspaceFirstStartMigrationJournalBytes,
  serializeWorkspaceFirstStartMigrationJournal,
  validateWorkspaceFirstStartMigrationJournal,
} from './workspaceFirstStartMigrationJournalCodec.js';
import { WorkspaceFirstStartMigrationTransitionError } from './workspaceFirstStartMigrationJournalError.js';
import type { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import type { WorkspaceFirstStartMigrationJournalPort, WorkspaceFirstStartMigrationJournalV1,
  WorkspaceFirstStartPreparedCancellation } from './workspaceFirstStartMigrationJournalTypes.js';

export interface WorkspaceFirstStartSelectedPersistenceAuthority {
  readonly registry: ReadOnlyJournalSlots<LocalWorkspaceRegistry>;
  readonly journal: ReadOnlyJournalSlots<WorkspaceFirstStartMigrationJournalV1>;
  assertCurrent(): void;
  // Excludes these two stores, whose in-flight bytes belong to their writers.
  assertExternalSelection(): Promise<void>;
  bindPreparation(journal: Readonly<WorkspaceFirstStartMigrationJournalV1>): Promise<void>;
}

// Only the deferred composition uses these ports. Startup admits the initial
// joint slot order; the existing W6 coordinator still owns semantic transitions.
export function createWorkspaceFirstStartSelectedPersistence(
  stores: Readonly<{ registry: WorkspaceRegistryStore; journal: WorkspaceFirstStartMigrationJournalStore }>,
  authority: WorkspaceFirstStartSelectedPersistenceAuthority,
) {
  let registry = capture(authority.registry, parseWorkspaceRegistryBytes);
  let journal = capture(authority.journal, parseWorkspaceFirstStartMigrationJournalBytes);
  const assertStartup = authority.assertCurrent.bind(authority);
  const assertExternal = authority.assertExternalSelection.bind(authority);
  const bindPreparation = authority.bindPreparation.bind(authority);
  let writing = false;
  let failed = false;

  function assertCurrent() {
    try {
      if (failed) invalid();
      assertUpdateJournalAuthority(assertStartup);
    } catch (error) { failed = true; throw error; }
  }
  async function checked<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
  }
  async function external() {
    await checked(async () => {
      assertCurrent();
      await assertExternal();
      assertCurrent();
    });
  }
  async function inspectRegistry() {
    return checked(async () => {
      await external();
      assertSame(await stores.registry.inspectSlots(), registry);
      await external();
      return structuredClone(registry);
    });
  }
  async function inspectJournal() {
    return checked(async () => {
      await external();
      assertSame(await stores.journal.inspectSlots(), journal);
      await external();
      return structuredClone(journal);
    });
  }
  function selection<T>(slots: ReadOnlyJournalSlots<T>, other: () => Promise<unknown>,
    cancellation?: WorkspaceFirstStartPreparedCancellation): CrashSafeByteSlotSelection {
    const terminalCurrent = cancellation?.assertCurrent.bind(cancellation);
    const terminalExternal = cancellation?.assertExternalSelection.bind(cancellation);
    return {
      expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
      expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
      assertAuthority() { assertCurrent(); assertUpdateJournalAuthority(terminalCurrent); },
      async assertExternalSelection() {
        await external();
        await other();
        await terminalExternal?.();
        await other();
        await external();
      },
    };
  }
  async function mutate<T>(operation: () => Promise<T>): Promise<T> {
    assertCurrent();
    if (failed || writing) invalid();
    writing = true;
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
    finally { writing = false; }
  }
  async function readRegistry() {
    if (hasSides(registry)) {
      await mutate(async () => {
        const retained = registry.current ?? registry.backup;
        if (retained === undefined) invalid();
        const identity = await stores.registry.recoverSelected(selection(registry, inspectJournal));
        const published = currentOnly(retained.bytes, retained.value, identity);
        assertSame(await stores.registry.inspectSlots(), published);
        registry = published;
        await external();
      });
    }
    return (await inspectRegistry()).current?.value;
  }
  async function readJournal() {
    if (hasSides(journal)) {
      await mutate(async () => {
        const retained = journal.current ?? journal.backup ?? journal.next;
        if (retained === undefined) invalid();
        const identity = await stores.journal.recoverSelected(selection(journal, inspectRegistry));
        const published = currentOnly(retained.bytes, retained.value, identity);
        assertSame(await stores.journal.inspectSlots(), published);
        journal = published;
        await external();
      });
    }
    return (await inspectJournal()).current?.value;
  }
  async function removeJournal(operationId: string, state: 'prepared' | 'registryTransitioned',
    cancellation?: WorkspaceFirstStartPreparedCancellation) {
    const selected = selection(journal, inspectRegistry, cancellation);
    if (cancellation !== undefined && !isDeepStrictEqual(structuredClone(cancellation.selected), journal.current)) invalid();
    await mutate(async () => {
      await stores.journal.removeSelected(operationId, state, selected);
      const absent = { current: undefined, next: undefined, backup: undefined };
      assertSame(await stores.journal.inspectSlots(), absent);
      journal = absent;
      await external();
    });
  }
  const journalPort: WorkspaceFirstStartMigrationJournalPort = {
    read: readJournal,
    async inspect() {
      return checked(async () => {
        const observed = await inspectJournal();
        if (hasSides(observed)) invalid();
        return observed.current;
      });
    },
    async write(value) {
      const next = validateWorkspaceFirstStartMigrationJournal(value);
      await mutate(async () => {
        if (journal.current === undefined) {
          if (hasSides(journal) || next.state !== 'prepared') invalid();
          await external();
          await bindPreparation(next);
          await external();
        }
        const identity = await stores.journal.writeSelected(next, selection(journal, inspectRegistry));
        const published = currentOnly(serializeWorkspaceFirstStartMigrationJournal(next), next, identity);
        assertSame(await stores.journal.inspectSlots(), published);
        journal = published;
        await external();
      });
    },
    discardPrepared: (id, cancellation) => removeJournal(id, 'prepared', cancellation),
    removeTransitioned: id => removeJournal(id, 'registryTransitioned'),
  };
  return {
    async settleSelectorRegistry(receipt: WorkspaceSelectorSwitchSettlement) {
      await checked(async () => {
        const { phase } = receipt;
        const before = capture(receipt.before.registrySlots, parseWorkspaceRegistryBytes);
        const after = capture(receipt.after.registrySlots, parseWorkspaceRegistryBytes);
        const assertOwner = receipt.assertCurrent.bind(receipt);
        await mutate(async () => {
          if (phase !== 'startup' || after.current?.value.formatVersion !== 2 ||
              after.current.value.activeWorkspaceId === null || hasSides(after)) invalid();
          assertSame(before, registry);
          const original = registry.current ?? registry.backup;
          if (original === undefined || !Buffer.from(original.bytes).equals(after.current.bytes)) invalid();
          await assertOwner();
          await inspectJournal();
          assertSame(await stores.registry.inspectSlots(), after);
          await assertOwner();
          await external();
          registry = after;
        });
      });
    },
    journal: journalPort,
    registry: {
      read: readRegistry,
      async inspect() {
        return checked(async () => {
          const observed = await inspectRegistry();
          if (hasSides(observed)) invalid();
          return observed.current?.value;
        });
      },
      async write(value: unknown) {
        const next = validateWorkspaceRegistry(value);
        await mutate(async () => {
          const identity = await stores.registry.writeSelected(next, selection(registry, inspectJournal));
          const published = currentOnly(serializeWorkspaceRegistry(next), next, identity);
          assertSame(await stores.registry.inspectSlots(), published);
          registry = published;
          await external();
        });
      },
    },
  };
}

function capture<T>(slots: ReadOnlyJournalSlots<T>, parse: (bytes: Uint8Array) => Readonly<T>): ReadOnlyJournalSlots<T> {
  const copied = structuredClone(slots);
  for (const record of Object.values(copied)) {
    if (record !== undefined && (record.identity === undefined || !isDeepStrictEqual(parse(record.bytes), record.value))) invalid();
  }
  return copied;
}
function currentOnly<T>(bytes: Uint8Array, value: Readonly<T>, identity: Readonly<CrashSafeFileSlotIdentity>): ReadOnlyJournalSlots<T> {
  return { current: { bytes: Uint8Array.from(bytes), value: structuredClone(value), identity: { ...identity } },
    next: undefined, backup: undefined };
}
function hasSides<T>(slots: ReadOnlyJournalSlots<T>): boolean { return slots.next !== undefined || slots.backup !== undefined; }
function assertSame<T>(actual: ReadOnlyJournalSlots<T>, expected: ReadOnlyJournalSlots<T>) {
  if (!isDeepStrictEqual(structuredClone(actual), expected)) invalid();
}
function invalid(): never { throw new WorkspaceFirstStartMigrationTransitionError('recoveryRequired'); }
