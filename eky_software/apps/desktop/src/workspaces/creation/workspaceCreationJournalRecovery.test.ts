import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_CREATION_JOURNAL_BUSY,
  WORKSPACE_CREATION_JOURNAL_INVALID,
  WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
} from './workspaceCreationJournalError.js';
import {
  WorkspaceCreationJournalFileSystemError,
  type WorkspaceCreationJournalFileSystem,
  type WorkspaceCreationJournalNextWriter,
  type WorkspaceCreationJournalSlot,
} from './workspaceCreationJournalFileSystem.js';
import { WORKSPACE_CREATION_JOURNAL_FILE_NAME } from './workspaceCreationJournalPaths.js';
import { parseWorkspaceCreationJournalBytes } from './workspaceCreationJournalBytes.js';
import { serializeWorkspaceCreationJournal } from './workspaceCreationJournalSerializer.js';
import { WorkspaceCreationJournalStore } from './workspaceCreationJournalStore.js';
import type {
  WorkspaceCreationJournalState,
  WorkspaceCreationJournalV1,
} from './workspaceCreationTypes.js';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('workspace creation journal interrupted writes', () => {
  it.each([
    ['directory preparation', 'prepareDirectory', 'throw'],
    ['next file creation', 'createNextWriter', 'throw'],
    ['short next file write', 'writerWrite', 'shortWrite'],
    ['next file sync', 'writerSync', 'throw'],
    ['next file close', 'writerClose', 'throw'],
    ['current to backup rename', 'move:current:backup', 'throw'],
  ] as const)(
    'preserves current when %s fails before publication',
    async (_description, operation, behavior) => {
      const current = createJournal('prepared');
      const fileSystem = new ControlledJournalFileSystem({ current });
      fileSystem.inject(operation, behavior);
      const store = createStore(fileSystem);

      await expect(store.write(createJournal('candidateRootCreated')))
        .rejects.toThrow(WORKSPACE_CREATION_JOURNAL_UNAVAILABLE);

      expect(fileSystem.journalIn('current')).toEqual(current);
      expect(fileSystem.has('next')).toBe(false);
      expect(fileSystem.has('backup')).toBe(false);
    },
  );

  it('maps disk-full details to the closed unavailable error', async () => {
    const sensitiveDetail = 'C:\\private\\company-name\\journal.json';
    const fileSystem = new ControlledJournalFileSystem({
      current: createJournal('prepared'),
    });
    fileSystem.inject(
      'writerWrite',
      'throw',
      Object.assign(new Error(sensitiveDetail), { code: 'ENOSPC' }),
    );
    const store = createStore(fileSystem);

    try {
      await store.write(createJournal('candidateRootCreated'));
      throw new Error('Expected journal write to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
      );
      expect(String(error)).not.toContain(sensitiveDetail);
      expect(String(error)).not.toContain('Oma yritys');
    }
  });

  it('restores current when publishing next fails', async () => {
    const current = createJournal('prepared');
    const fileSystem = new ControlledJournalFileSystem({ current });
    fileSystem.inject('move:next:current', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(createJournal('candidateRootCreated')))
      .rejects.toThrow(WORKSPACE_CREATION_JOURNAL_UNAVAILABLE);

    expect(fileSystem.journalIn('current')).toEqual(current);
    expect(fileSystem.has('next')).toBe(false);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('recovers backup after restart when immediate restoration also fails', async () => {
    const current = createJournal('prepared');
    const fileSystem = new ControlledJournalFileSystem({ current });
    fileSystem.inject('move:next:current', 'throw');
    fileSystem.inject('move:backup:current', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(createJournal('candidateRootCreated')))
      .rejects.toThrow(WORKSPACE_CREATION_JOURNAL_UNAVAILABLE);
    expect(fileSystem.has('current')).toBe(false);
    expect(fileSystem.journalIn('backup')).toEqual(current);

    await expect(store.read()).resolves.toEqual(current);
    expect(fileSystem.journalIn('current')).toEqual(current);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('keeps a published state recoverable when directory sync fails', async () => {
    const replacement = createJournal('candidateRootCreated');
    const fileSystem = new ControlledJournalFileSystem({
      current: createJournal('prepared'),
    });
    fileSystem.inject('syncDirectory:1', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(replacement)).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
    );
    expect(fileSystem.journalIn('current')).toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(true);

    await expect(store.read()).resolves.toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('cleans stale recovery slots deterministically on restart', async () => {
    const replacement = createJournal('candidateRootCreated');
    const fileSystem = new ControlledJournalFileSystem({
      current: createJournal('prepared'),
    });
    fileSystem.inject('remove:backup', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(replacement)).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
    );
    expect(fileSystem.journalIn('current')).toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(true);

    await expect(store.read()).resolves.toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('fails closed instead of promoting an incomplete first-write slot', async () => {
    const fileSystem = new ControlledJournalFileSystem();
    fileSystem.setRaw('next', new Uint8Array());
    const store = createStore(fileSystem);

    await expect(store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
    expect(fileSystem.has('current')).toBe(false);
    expect(fileSystem.has('next')).toBe(true);
  });
});

describe('workspace creation journal operation serialization', () => {
  it('rejects concurrent reads and writes while a write is active', async () => {
    const fileSystem = new ControlledJournalFileSystem({
      current: createJournal('prepared'),
    });
    const barrier = fileSystem.blockOnce('read:current');
    const store = createStore(fileSystem);
    const firstWrite = store.write(createJournal('candidateRootCreated'));
    await barrier.started;

    await expect(store.read()).rejects.toThrow(WORKSPACE_CREATION_JOURNAL_BUSY);
    await expect(store.write(createJournal('candidateRootCreated')))
      .rejects.toThrow(WORKSPACE_CREATION_JOURNAL_BUSY);

    barrier.release();
    await expect(firstWrite).resolves.toBeUndefined();
  });

  it('maps invalid filesystem state to the closed validation error', async () => {
    const fileSystem = new ControlledJournalFileSystem();
    fileSystem.inject(
      'read:current',
      'throw',
      new WorkspaceCreationJournalFileSystemError('invalid'),
    );

    await expect(createStore(fileSystem).read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
  });
});

type FaultBehavior = 'throw' | 'shortWrite';
type InjectedFault = Readonly<{ behavior: FaultBehavior; error: unknown }>;

class ControlledJournalFileSystem
implements WorkspaceCreationJournalFileSystem {
  private readonly slots = new Map<WorkspaceCreationJournalSlot, Uint8Array>();
  private readonly faults = new Map<string, InjectedFault[]>();
  private readonly barriers = new Map<string, OperationBarrier>();
  private directorySyncCount = 0;

  constructor(initial?: Readonly<Partial<Record<WorkspaceCreationJournalSlot, unknown>>>) {
    for (const slot of ['current', 'next', 'backup'] as const) {
      const value = initial?.[slot];
      if (value !== undefined) {
        this.slots.set(slot, serializeWorkspaceCreationJournal(value));
      }
    }
  }

  inject(
    operation: string,
    behavior: FaultBehavior,
    error: unknown = new Error(`Injected failure at ${operation}`),
  ): void {
    const faults = this.faults.get(operation) ?? [];
    faults.push({ behavior, error });
    this.faults.set(operation, faults);
  }

  blockOnce(operation: string): Readonly<{
    started: Promise<void>;
    release: () => void;
  }> {
    const started = createDeferred<void>();
    const released = createDeferred<void>();
    this.barriers.set(operation, {
      started: () => started.resolve(),
      released: released.promise,
    });
    return {
      started: started.promise,
      release: () => released.resolve(),
    };
  }

  has(slot: WorkspaceCreationJournalSlot): boolean {
    return this.slots.has(slot);
  }

  journalIn(slot: WorkspaceCreationJournalSlot): unknown {
    const bytes = this.slots.get(slot);
    return bytes === undefined
      ? undefined
      : parseWorkspaceCreationJournalBytes(bytes);
  }

  setRaw(slot: WorkspaceCreationJournalSlot, bytes: Uint8Array): void {
    this.slots.set(slot, new Uint8Array(bytes));
  }

  async prepareDirectory(): Promise<void> {
    await this.before('prepareDirectory');
  }

  async readSlot(
    slot: WorkspaceCreationJournalSlot,
  ): Promise<Uint8Array | undefined> {
    await this.before(`read:${slot}`);
    const bytes = this.slots.get(slot);
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  async createNextWriter(): Promise<WorkspaceCreationJournalNextWriter> {
    await this.before('createNextWriter');
    if (this.slots.has('next')) {
      throw new WorkspaceCreationJournalFileSystemError('unavailable');
    }
    this.slots.set('next', new Uint8Array());
    return new ControlledNextWriter(this);
  }

  async moveSlot(
    source: WorkspaceCreationJournalSlot,
    destination: WorkspaceCreationJournalSlot,
  ): Promise<void> {
    await this.before(`move:${source}:${destination}`);
    const bytes = this.slots.get(source);
    if (bytes === undefined || this.slots.has(destination)) {
      throw new WorkspaceCreationJournalFileSystemError('unavailable');
    }
    this.slots.set(destination, bytes);
    this.slots.delete(source);
  }

  async removeSlot(slot: WorkspaceCreationJournalSlot): Promise<boolean> {
    if (!this.slots.has(slot)) return false;
    await this.before(`remove:${slot}`);
    return this.slots.delete(slot);
  }

  async syncDirectory(): Promise<void> {
    this.directorySyncCount += 1;
    await this.before(`syncDirectory:${this.directorySyncCount}`);
  }

  async writeNext(bytes: Uint8Array): Promise<number> {
    const fault = this.takeFault('writerWrite');
    if (fault?.behavior === 'throw') throw fault.error;
    const writtenLength = fault?.behavior === 'shortWrite'
      ? Math.max(0, bytes.byteLength - 1)
      : bytes.byteLength;
    this.slots.set('next', bytes.slice(0, writtenLength));
    return writtenLength;
  }

  async syncNext(): Promise<void> {
    await this.before('writerSync');
  }

  async closeNext(): Promise<void> {
    await this.before('writerClose');
  }

  private async before(operation: string): Promise<void> {
    const barrier = this.barriers.get(operation);
    if (barrier !== undefined) {
      this.barriers.delete(operation);
      barrier.started();
      await barrier.released;
    }
    const fault = this.takeFault(operation);
    if (fault?.behavior === 'throw') throw fault.error;
    if (fault?.behavior === 'shortWrite') {
      throw new Error('shortWrite is only valid for writerWrite');
    }
  }

  private takeFault(operation: string): InjectedFault | undefined {
    const faults = this.faults.get(operation);
    const fault = faults?.shift();
    if (faults?.length === 0) this.faults.delete(operation);
    return fault;
  }
}

class ControlledNextWriter implements WorkspaceCreationJournalNextWriter {
  private closed = false;

  constructor(private readonly fileSystem: ControlledJournalFileSystem) {}

  write(bytes: Uint8Array): Promise<number> {
    this.assertOpen();
    return this.fileSystem.writeNext(bytes);
  }

  sync(): Promise<void> {
    this.assertOpen();
    return this.fileSystem.syncNext();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.fileSystem.closeNext();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new WorkspaceCreationJournalFileSystemError('unavailable');
    }
  }
}

interface OperationBarrier {
  readonly started: () => void;
  readonly released: Promise<void>;
}

function createDeferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromiseInner) => {
    resolvePromise = resolvePromiseInner;
  });
  return { promise, resolve: resolvePromise };
}

function createStore(
  fileSystem: WorkspaceCreationJournalFileSystem,
): WorkspaceCreationJournalStore {
  const installationRoot = resolve('.workspace-creation-journal-controlled');
  return new WorkspaceCreationJournalStore({
    installationRoot,
    filePath: join(
      installationRoot,
      WORKSPACE_CREATION_JOURNAL_FILE_NAME,
    ),
    fileSystem,
  });
}

function createJournal(
  state: WorkspaceCreationJournalState,
): Readonly<WorkspaceCreationJournalV1> {
  const hasLineage = [
    'bootstrapCompleted',
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(state);
  return {
    formatVersion: 1,
    operationId: operationId as WorkspaceCreationJournalV1['operationId'],
    workspaceId: workspaceId as WorkspaceCreationJournalV1['workspaceId'],
    workspaceLabel: 'Oma yritys',
    previousActiveWorkspaceId: null,
    state,
    createdAt: '2026-08-18T10:00:00.000Z',
    lineageIdentity: hasLineage
      ? { formatVersion: 1, profileId: 'a'.repeat(64) }
      : null,
  };
}
