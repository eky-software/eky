import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  CrashSafeFileSlot,
  CrashSafeFileSlotFileSystem,
  CrashSafeFileSlotNextWriter,
} from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import {
  assertWorkspaceFirstStartMigrationJournalTransition,
  parseWorkspaceFirstStartMigrationJournalBytes,
  serializeWorkspaceFirstStartMigrationJournal,
  validateWorkspaceFirstStartMigrationJournal,
  WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES,
} from './workspaceFirstStartMigrationJournalCodec.js';
import {
  WorkspaceFirstStartMigrationJournalValidationError,
} from './workspaceFirstStartMigrationJournalError.js';
import { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from './workspaceFirstStartMigrationJournalTypes.js';

const activeWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const passiveWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const anotherPassiveWorkspaceId = validateWorkspaceId(
  '33333333-3333-4333-8333-333333333333',
);

describe('workspace first-start migration journal codec', () => {
  it('serializes a closed canonical v1 journal and round-trips it', () => {
    const value = journal();
    const bytes = serializeWorkspaceFirstStartMigrationJournal(value);

    expect(new TextDecoder().decode(bytes)).toBe(
      `${JSON.stringify(value)}\n`,
    );
    expect(parseWorkspaceFirstStartMigrationJournalBytes(bytes)).toEqual(
      value,
    );
  });

  it.each([
    ['unknown key', { ...journal(), unexpected: true }],
    ['wrong version', { ...journal(), formatVersion: 2 }],
    ['invalid operation id', { ...journal(), operationId: 'operation' }],
    [
      'unsorted passive ids',
      {
        ...journal(),
        passiveRecoveryWorkspaceIds: [
          anotherPassiveWorkspaceId,
          passiveWorkspaceId,
        ],
      },
    ],
    [
      'duplicate passive id',
      {
        ...journal(),
        passiveRecoveryWorkspaceIds: [
          passiveWorkspaceId,
          passiveWorkspaceId,
        ],
      },
    ],
    [
      'active workspace in passive ids',
      { ...journal(), passiveRecoveryWorkspaceIds: [activeWorkspaceId] },
    ],
    ['unknown state', { ...journal(), state: 'completed' }],
    [
      'non-increasing build',
      { ...journal(), targetBuild: journal().sourceBuild },
    ],
    [
      'invalid source hash',
      { ...journal(), sourceRegistrySha256: 'a'.repeat(63) },
    ],
    [
      'updated before creation',
      { ...journal(), updatedAt: '2026-08-20T23:59:59.000Z' },
    ],
  ])('rejects %s', (_name, value) => {
    expect(() => validateWorkspaceFirstStartMigrationJournal(value)).toThrow(
      WorkspaceFirstStartMigrationJournalValidationError,
    );
  });

  it('rejects duplicate JSON keys and oversized bytes', () => {
    const source = JSON.stringify(journal()).replace(
      '"formatVersion":1',
      '"formatVersion":1,"formatVersion":1',
    );

    expect(() =>
      parseWorkspaceFirstStartMigrationJournalBytes(
        new TextEncoder().encode(source),
      ),
    ).toThrow(WorkspaceFirstStartMigrationJournalValidationError);
    expect(() =>
      parseWorkspaceFirstStartMigrationJournalBytes(
        new Uint8Array(
          WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES + 1,
        ),
      ),
    ).toThrow(WorkspaceFirstStartMigrationJournalValidationError);
  });

  it('allows only an exact idempotent write or prepared-to-transitioned move', () => {
    const prepared = journal();
    const transitioned = journal({
      state: 'registryTransitioned',
      updatedAt: '2026-08-21T00:00:01.000Z',
    });

    expect(() =>
      assertWorkspaceFirstStartMigrationJournalTransition(undefined, prepared),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceFirstStartMigrationJournalTransition(prepared, prepared),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceFirstStartMigrationJournalTransition(
        prepared,
        transitioned,
      ),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceFirstStartMigrationJournalTransition(
        transitioned,
        prepared,
      ),
    ).toThrow(WorkspaceFirstStartMigrationJournalValidationError);
    expect(() =>
      assertWorkspaceFirstStartMigrationJournalTransition(
        prepared,
        journal({ updatedAt: '2026-08-21T00:00:01.000Z' }),
      ),
    ).toThrow(WorkspaceFirstStartMigrationJournalValidationError);
  });
});

describe('WorkspaceFirstStartMigrationJournalStore', () => {
  it.each<{
    expected: string;
    initial: Partial<Record<CrashSafeFileSlot, Uint8Array>>;
    name: string;
  }>([
    {
      name: 'current',
      expected: 'current',
      initial: {
        current: serialized(journal({ operationId: operationId('1') })),
        next: serialized(journal({ operationId: operationId('2') })),
        backup: serialized(journal({ operationId: operationId('3') })),
      },
    },
    {
      name: 'backup',
      expected: 'backup',
      initial: {
        backup: serialized(journal({ operationId: operationId('3') })),
        next: serialized(journal({ operationId: operationId('2') })),
      },
    },
    {
      name: 'next',
      expected: 'next',
      initial: {
        next: serialized(journal({ operationId: operationId('2') })),
      },
    },
  ])('recovers the valid $name slot before returning', async ({
    expected,
    initial,
  }) => {
    const fileSystem = createMemoryFileSystem(initial);
    const store = new WorkspaceFirstStartMigrationJournalStore({
      userDataPath: resolve('workspace-first-start-test'),
      fileSystem,
    });

    const value = await store.read();

    const expectedOperation =
      expected === 'current'
        ? operationId('1')
        : expected === 'backup'
          ? operationId('3')
          : operationId('2');
    expect(value?.operationId).toBe(expectedOperation);
    expect(Object.keys(fileSystem.values())).toEqual(['current']);
  });

  it('writes the two allowed states and removes only a matching terminal state', async () => {
    const fileSystem = createMemoryFileSystem();
    const store = new WorkspaceFirstStartMigrationJournalStore({
      userDataPath: resolve('workspace-first-start-test'),
      fileSystem,
    });
    const prepared = journal();
    await store.write(prepared);
    await expect(store.removeTransitioned(prepared.operationId)).rejects.toThrow(
      WorkspaceFirstStartMigrationJournalValidationError,
    );
    await store.write(
      journal({
        state: 'registryTransitioned',
        updatedAt: '2026-08-21T00:00:01.000Z',
      }),
    );

    await store.removeTransitioned(prepared.operationId);

    await expect(store.read()).resolves.toBeUndefined();
  });

  it('does not mutate torn recovery slots when journal validation fails', async () => {
    const invalid = new TextEncoder().encode('{"formatVersion":1}\n');
    const fileSystem = createMemoryFileSystem({
      backup: invalid,
      next: serialized(journal()),
    });
    const before = fileSystem.values();
    const store = new WorkspaceFirstStartMigrationJournalStore({
      userDataPath: resolve('workspace-first-start-test'),
      fileSystem,
    });

    await expect(store.read()).rejects.toThrow(
      WorkspaceFirstStartMigrationJournalValidationError,
    );
    expect(fileSystem.values()).toEqual(before);
  });
});

function journal(
  overrides: Partial<WorkspaceFirstStartMigrationJournalV1> = {},
): WorkspaceFirstStartMigrationJournalV1 {
  return {
    formatVersion: 1,
    operationId: operationId('0'),
    state: 'prepared',
    sourceBuild: { appVersion: '0.2.6', buildRevision: 'a'.repeat(40) },
    targetBuild: { appVersion: '0.2.7', buildRevision: 'b'.repeat(40) },
    activeWorkspaceId,
    passiveRecoveryWorkspaceIds: [
      passiveWorkspaceId,
      anotherPassiveWorkspaceId,
    ],
    sourceRegistrySha256: 'c'.repeat(64),
    transitionedRegistrySha256: 'd'.repeat(64),
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

function operationId(lastCharacter: string): string {
  return `00000000-0000-4000-8000-00000000000${lastCharacter}`;
}

function serialized(value: WorkspaceFirstStartMigrationJournalV1): Uint8Array {
  return serializeWorkspaceFirstStartMigrationJournal(value);
}

interface MemoryFileSystem extends CrashSafeFileSlotFileSystem {
  values(): Partial<Record<CrashSafeFileSlot, Uint8Array>>;
}

function createMemoryFileSystem(
  initial: Partial<Record<CrashSafeFileSlot, Uint8Array>> = {},
): MemoryFileSystem {
  const slots = new Map<CrashSafeFileSlot, Uint8Array>(
    Object.entries(initial) as [CrashSafeFileSlot, Uint8Array][],
  );
  let nextBytes: Uint8Array | undefined;
  return {
    async prepareDirectory() {},
    async readSlot(slot) {
      return slots.get(slot)?.slice();
    },
    async createNextWriter(): Promise<CrashSafeFileSlotNextWriter> {
      let closed = false;
      return {
        async write(bytes) {
          nextBytes = bytes.slice();
          return bytes.byteLength;
        },
        async sync() {},
        async close() {
          if (closed) return;
          closed = true;
          if (nextBytes !== undefined) slots.set('next', nextBytes);
        },
      };
    },
    async moveSlot(source, destination) {
      const value = slots.get(source);
      if (value === undefined || slots.has(destination)) {
        throw new Error('MOVE_FAILED');
      }
      slots.set(destination, value);
      slots.delete(source);
    },
    async removeSlot(slot) {
      return slots.delete(slot);
    },
    async syncDirectory() {},
    values() {
      return Object.fromEntries(
        [...slots.entries()].map(([slot, value]) => [slot, value.slice()]),
      );
    },
  };
}
