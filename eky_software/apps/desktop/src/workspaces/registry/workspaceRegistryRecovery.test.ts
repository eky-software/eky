import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_REGISTRY_INVALID } from './workspaceRegistryError.js';
import {
  WorkspaceRegistryFileSystemError,
  type WorkspaceRegistryFileSystem,
  type WorkspaceRegistryNextWriter,
  type WorkspaceRegistrySlot,
} from './workspaceRegistryFileSystem.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from './workspaceRegistryPaths.js';
import { parseWorkspaceRegistryBytes } from './workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from './workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from './workspaceRegistryStore.js';
import {
  WORKSPACE_REGISTRY_BUSY,
  WORKSPACE_REGISTRY_UNAVAILABLE,
} from './workspaceRegistryStoreError.js';

const firstWorkspaceId = '11111111-1111-4111-8111-111111111111';
const secondWorkspaceId = '22222222-2222-4222-8222-222222222222';

describe('workspace registry interrupted writes', () => {
  it.each([
    ['registry directory preparation', 'prepareDirectory', 'throw'],
    ['next file creation', 'createNextWriter', 'throw'],
    ['short next file write', 'writerWrite', 'shortWrite'],
    ['next file sync', 'writerSync', 'throw'],
    ['next file close', 'writerClose', 'throw'],
    ['current to backup rename', 'move:current:backup', 'throw'],
  ] as const)(
    'preserves current when %s fails before publication',
    async (_description, operation, behavior) => {
      const current = createRegistry('Current company');
      const fileSystem = new ControlledWorkspaceRegistryFileSystem({ current });
      fileSystem.inject(operation, behavior);
      const store = createStore(fileSystem);

      await expect(
        store.write(createRegistry('Replacement company', secondWorkspaceId)),
      ).rejects.toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);

      expect(fileSystem.registryIn('current')).toEqual(current);
      expect(fileSystem.has('next')).toBe(false);
      expect(fileSystem.has('backup')).toBe(false);
    },
  );

  it('preserves current when the disk fills during the next file write', async () => {
    const current = createRegistry('Current company');
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({ current });
    fileSystem.inject(
      'writerWrite',
      'throw',
      Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
    );
    const store = createStore(fileSystem);

    await expect(
      store.write(createRegistry('Replacement company', secondWorkspaceId)),
    ).rejects.toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);

    expect(fileSystem.registryIn('current')).toEqual(current);
    expect(fileSystem.has('next')).toBe(false);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('restores current when publishing next fails after current moved to backup', async () => {
    const current = createRegistry('Current company');
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({ current });
    fileSystem.inject('move:next:current', 'throw');
    const store = createStore(fileSystem);

    await expect(
      store.write(createRegistry('Replacement company', secondWorkspaceId)),
    ).rejects.toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);

    expect(fileSystem.registryIn('current')).toEqual(current);
    expect(fileSystem.has('next')).toBe(false);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('recovers backup on restart when immediate backup restoration also fails', async () => {
    const current = createRegistry('Current company');
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({ current });
    fileSystem.inject('move:next:current', 'throw');
    fileSystem.inject('move:backup:current', 'throw');
    const store = createStore(fileSystem);

    await expect(
      store.write(createRegistry('Replacement company', secondWorkspaceId)),
    ).rejects.toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);

    expect(fileSystem.has('current')).toBe(false);
    expect(fileSystem.has('next')).toBe(false);
    expect(fileSystem.registryIn('backup')).toEqual(current);
    await expect(store.read()).resolves.toEqual(current);
    expect(fileSystem.registryIn('current')).toEqual(current);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('keeps the published value recoverable when directory sync fails', async () => {
    const replacement = createRegistry('Replacement company', secondWorkspaceId);
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({
      current: createRegistry('Current company'),
    });
    fileSystem.inject('syncDirectory:1', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(replacement)).rejects.toThrow(
      WORKSPACE_REGISTRY_UNAVAILABLE,
    );

    expect(fileSystem.registryIn('current')).toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(true);
    await expect(store.read()).resolves.toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('cleans a stale backup on restart when backup removal fails after publication', async () => {
    const replacement = createRegistry('Replacement company', secondWorkspaceId);
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({
      current: createRegistry('Current company'),
    });
    fileSystem.inject('remove:backup', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(replacement)).rejects.toThrow(
      WORKSPACE_REGISTRY_UNAVAILABLE,
    );

    expect(fileSystem.registryIn('current')).toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(true);
    await expect(store.read()).resolves.toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(false);
  });

  it('keeps the published value when the final directory sync fails', async () => {
    const replacement = createRegistry('Replacement company', secondWorkspaceId);
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({
      current: createRegistry('Current company'),
    });
    fileSystem.inject('syncDirectory:2', 'throw');
    const store = createStore(fileSystem);

    await expect(store.write(replacement)).rejects.toThrow(
      WORKSPACE_REGISTRY_UNAVAILABLE,
    );

    expect(fileSystem.registryIn('current')).toEqual(replacement);
    expect(fileSystem.has('backup')).toBe(false);
    await expect(store.read()).resolves.toEqual(replacement);
  });

  it('removes a stale next slot on restart after cleanup failed', async () => {
    const current = createRegistry('Current company');
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({ current });
    fileSystem.inject('writerSync', 'throw');
    fileSystem.inject('remove:next', 'throw');
    const store = createStore(fileSystem);

    await expect(
      store.write(createRegistry('Replacement company', secondWorkspaceId)),
    ).rejects.toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);

    expect(fileSystem.registryIn('current')).toEqual(current);
    expect(fileSystem.has('next')).toBe(true);
    await expect(store.read()).resolves.toEqual(current);
    expect(fileSystem.has('next')).toBe(false);
  });

  it('fails closed on an incomplete first-write next slot', async () => {
    const fileSystem = new ControlledWorkspaceRegistryFileSystem();
    fileSystem.setRaw('next', new Uint8Array());
    const store = createStore(fileSystem);

    await expect(store.read()).rejects.toThrow(WORKSPACE_REGISTRY_INVALID);
    expect(fileSystem.has('current')).toBe(false);
    expect(fileSystem.has('next')).toBe(true);
  });
});

describe('workspace registry operation serialization', () => {
  it('rejects a concurrent write and read while a write is active', async () => {
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({
      current: createRegistry('Current company'),
    });
    const barrier = fileSystem.blockOnce('read:current');
    const store = createStore(fileSystem);
    const firstWrite = store.write(
      createRegistry('Replacement company', secondWorkspaceId),
    );
    await barrier.started;

    await expect(store.write(createRegistry('Third company'))).rejects.toThrow(
      WORKSPACE_REGISTRY_BUSY,
    );
    await expect(store.read()).rejects.toThrow(WORKSPACE_REGISTRY_BUSY);

    barrier.release();
    await expect(firstWrite).resolves.toBeUndefined();
  });

  it('rejects a concurrent write while a read is active', async () => {
    const current = createRegistry('Current company');
    const fileSystem = new ControlledWorkspaceRegistryFileSystem({ current });
    const barrier = fileSystem.blockOnce('read:current');
    const store = createStore(fileSystem);
    const firstRead = store.read();
    await barrier.started;

    await expect(
      store.write(createRegistry('Replacement company', secondWorkspaceId)),
    ).rejects.toThrow(WORKSPACE_REGISTRY_BUSY);

    barrier.release();
    await expect(firstRead).resolves.toEqual(current);
  });
});

describe('workspace registry safe failures', () => {
  it('maps raw I/O details to the allowlisted unavailable error', async () => {
    const sensitiveDetail = 'C:\\private\\customer-name\\registry.json';
    const fileSystem = new ControlledWorkspaceRegistryFileSystem();
    fileSystem.inject(
      'createNextWriter',
      'throw',
      Object.assign(new Error(sensitiveDetail), { code: 'ENOSPC' }),
    );
    const store = createStore(fileSystem);

    try {
      await store.write(createRegistry('Sensitive company name'));
      throw new Error('Expected write to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(WORKSPACE_REGISTRY_UNAVAILABLE);
      expect(String(error)).not.toContain(sensitiveDetail);
      expect(String(error)).not.toContain('Sensitive company name');
    }
  });

  it('maps an invalid filesystem slot to the allowlisted validation error', async () => {
    const fileSystem = new ControlledWorkspaceRegistryFileSystem();
    fileSystem.inject(
      'read:current',
      'throw',
      new WorkspaceRegistryFileSystemError('invalid'),
    );
    const store = createStore(fileSystem);

    await expect(store.read()).rejects.toThrow(WORKSPACE_REGISTRY_INVALID);
  });
});

type FaultBehavior = 'throw' | 'shortWrite';
type InjectedFault = Readonly<{
  behavior: FaultBehavior;
  error: unknown;
}>;

class ControlledWorkspaceRegistryFileSystem
implements WorkspaceRegistryFileSystem {
  private readonly slots = new Map<WorkspaceRegistrySlot, Uint8Array>();
  private readonly faults = new Map<string, InjectedFault[]>();
  private readonly barriers = new Map<string, OperationBarrier>();
  private directorySyncCount = 0;

  constructor(initial?: Readonly<Partial<Record<WorkspaceRegistrySlot, unknown>>>) {
    for (const slot of ['current', 'next', 'backup'] as const) {
      const value = initial?.[slot];
      if (value !== undefined) {
        this.slots.set(slot, serializeWorkspaceRegistry(value));
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

  has(slot: WorkspaceRegistrySlot): boolean {
    return this.slots.has(slot);
  }

  registryIn(slot: WorkspaceRegistrySlot): unknown {
    const bytes = this.slots.get(slot);
    return bytes === undefined ? undefined : parseWorkspaceRegistryBytes(bytes);
  }

  setRaw(slot: WorkspaceRegistrySlot, bytes: Uint8Array): void {
    this.slots.set(slot, new Uint8Array(bytes));
  }

  async prepareDirectory(): Promise<void> {
    await this.before('prepareDirectory');
  }

  async readSlot(slot: WorkspaceRegistrySlot): Promise<Uint8Array | undefined> {
    await this.before(`read:${slot}`);
    const bytes = this.slots.get(slot);
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  async createNextWriter(): Promise<WorkspaceRegistryNextWriter> {
    await this.before('createNextWriter');
    if (this.slots.has('next')) {
      throw new WorkspaceRegistryFileSystemError('unavailable');
    }
    this.slots.set('next', new Uint8Array());
    return new ControlledNextWriter(this);
  }

  async moveSlot(
    source: WorkspaceRegistrySlot,
    destination: WorkspaceRegistrySlot,
  ): Promise<void> {
    await this.before(`move:${source}:${destination}`);
    const bytes = this.slots.get(source);
    if (bytes === undefined || this.slots.has(destination)) {
      throw new WorkspaceRegistryFileSystemError('unavailable');
    }
    this.slots.set(destination, bytes);
    this.slots.delete(source);
  }

  async removeSlot(slot: WorkspaceRegistrySlot): Promise<boolean> {
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

class ControlledNextWriter implements WorkspaceRegistryNextWriter {
  private closed = false;

  constructor(private readonly fileSystem: ControlledWorkspaceRegistryFileSystem) {}

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
      throw new WorkspaceRegistryFileSystemError('unavailable');
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
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createStore(fileSystem: WorkspaceRegistryFileSystem): WorkspaceRegistryStore {
  const installationRoot = resolve('.workspace-registry-controlled-test');
  return new WorkspaceRegistryStore({
    installationRoot,
    filePath: join(installationRoot, WORKSPACE_REGISTRY_FILE_NAME),
    fileSystem,
  });
}

function createRegistry(
  workspaceLabel: string,
  workspaceId = firstWorkspaceId,
) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        workspaceId,
        workspaceLabel,
        lineageIdentity: {
          formatVersion: 1,
          profileId: workspaceId === firstWorkspaceId
            ? 'a'.repeat(64)
            : 'b'.repeat(64),
        },
        layoutVersion: 1,
        lifecycleState: 'ready',
        createdAt: '2026-08-18T10:00:00.000Z',
      },
    ],
  } as const;
}
