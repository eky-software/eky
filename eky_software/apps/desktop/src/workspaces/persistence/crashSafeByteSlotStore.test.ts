import { describe, expect, it } from 'vitest';

import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from './crashSafeByteSlotStore.js';
import type {
  CrashSafeFileSlot,
  CrashSafeFileSlotFileSystem,
  CrashSafeFileSlotNextWriter,
} from './crashSafeFileSlot.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('CrashSafeByteSlotStore', () => {
  it('prefers a valid current slot and removes stale recovery slots', async () => {
    const fileSystem = createFileSystem({
      current: bytes('current'),
      next: bytes('next'),
      backup: bytes('backup'),
    });
    const store = new CrashSafeByteSlotStore(fileSystem);

    await expect(store.recoverAndRead(readText)).resolves.toBe('current');
    expect(fileSystem.values()).toEqual({ current: bytes('current') });
  });

  it('recovers a valid backup before considering next', async () => {
    const fileSystem = createFileSystem({
      next: bytes('next'),
      backup: bytes('backup'),
    });
    const store = new CrashSafeByteSlotStore(fileSystem);

    await expect(store.recoverAndRead(readText)).resolves.toBe('backup');
    expect(fileSystem.values()).toEqual({ current: bytes('backup') });
  });

  it('promotes a valid next slot when no durable value exists', async () => {
    const fileSystem = createFileSystem({ next: bytes('next') });
    const store = new CrashSafeByteSlotStore(fileSystem);

    await expect(store.recoverAndRead(readText)).resolves.toBe('next');
    expect(fileSystem.values()).toEqual({ current: bytes('next') });
  });

  it('does not mutate recovery slots before semantic validation succeeds', async () => {
    const initial = {
      next: bytes('next'),
      backup: bytes('invalid'),
    } as const;
    const fileSystem = createFileSystem(initial);
    const store = new CrashSafeByteSlotStore(fileSystem);

    await expect(store.recoverAndRead(() => {
      throw new Error('SCHEMA_INVALID');
    })).rejects.toThrow('SCHEMA_INVALID');
    expect(fileSystem.values()).toEqual(initial);
  });

  it('atomically replaces current bytes and removes the backup', async () => {
    const fileSystem = createFileSystem({ current: bytes('current') });
    const store = new CrashSafeByteSlotStore(fileSystem);

    await store.replace(bytes('replacement'), true);

    expect(fileSystem.values()).toEqual({ current: bytes('replacement') });
    expect(fileSystem.syncCount).toBe(2);
  });

  it('restores the previous current value when next publication fails', async () => {
    const fileSystem = createFileSystem({ current: bytes('current') });
    fileSystem.failMove = 'next:current';
    const store = new CrashSafeByteSlotStore(fileSystem);

    await expect(store.replace(bytes('replacement'), true)).rejects.toThrow(
      'MOVE_FAILED',
    );
    expect(fileSystem.values()).toEqual({ current: bytes('current') });
  });

  it('rejects a short write and removes the incomplete next slot', async () => {
    const fileSystem = createFileSystem();
    fileSystem.shortWrite = true;
    const store = new CrashSafeByteSlotStore(fileSystem);

    await expect(store.replace(bytes('replacement'), false)).rejects.toBeInstanceOf(
      CrashSafeByteSlotStoreError,
    );
    expect(fileSystem.values()).toEqual({});
  });

  it('clears every slot and syncs the containing directory', async () => {
    const fileSystem = createFileSystem({
      current: bytes('current'),
      next: bytes('next'),
      backup: bytes('backup'),
    });
    const store = new CrashSafeByteSlotStore(fileSystem);

    await store.clear();

    expect(fileSystem.values()).toEqual({});
    expect(fileSystem.syncCount).toBe(1);
  });
});

interface ControlledFileSystem extends CrashSafeFileSlotFileSystem {
  failMove?: `${CrashSafeFileSlot}:${CrashSafeFileSlot}`;
  shortWrite: boolean;
  syncCount: number;
  values(): Partial<Record<CrashSafeFileSlot, Uint8Array>>;
}

function createFileSystem(
  initial: Partial<Record<CrashSafeFileSlot, Uint8Array>> = {},
): ControlledFileSystem {
  const slots = new Map<CrashSafeFileSlot, Uint8Array>(
    Object.entries(initial) as [CrashSafeFileSlot, Uint8Array][],
  );
  let nextBuffer: Uint8Array | undefined;
  let writerClosed = false;

  const fileSystem: ControlledFileSystem = {
    shortWrite: false,
    syncCount: 0,
    async prepareDirectory() {},
    async readSlot(slot) {
      return clone(slots.get(slot));
    },
    async createNextWriter(): Promise<CrashSafeFileSlotNextWriter> {
      writerClosed = false;
      nextBuffer = undefined;
      return {
        async write(value) {
          if (writerClosed) throw new Error('WRITER_CLOSED');
          nextBuffer = value.slice();
          return fileSystem.shortWrite
            ? Math.max(0, value.byteLength - 1)
            : value.byteLength;
        },
        async sync() {
          if (writerClosed) throw new Error('WRITER_CLOSED');
        },
        async close() {
          if (writerClosed) return;
          writerClosed = true;
          if (nextBuffer !== undefined) slots.set('next', nextBuffer);
        },
      };
    },
    async moveSlot(source, destination) {
      if (fileSystem.failMove === `${source}:${destination}`) {
        throw new Error('MOVE_FAILED');
      }
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
    async syncDirectory() {
      fileSystem.syncCount += 1;
    },
    values() {
      return Object.fromEntries(
        [...slots.entries()].map(([slot, value]) => [slot, value.slice()]),
      );
    },
  };
  return fileSystem;
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function readText(value: Uint8Array): string {
  return decoder.decode(value);
}

function clone(value: Uint8Array | undefined): Uint8Array | undefined {
  return value === undefined ? undefined : value.slice();
}
