import { describe, expect, it, vi } from 'vitest';

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
  describe('read-only inspection', () => {
    it.each([
      { current: 'current', backup: 'backup', next: 'next', expected: 'current' },
      { backup: 'backup', next: 'next', expected: 'backup' },
      { next: 'next', expected: 'next' },
      { expected: undefined },
    ] as const)('keeps all slots unchanged for $expected', async (input) => {
      const initial = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'expected')
          .map(([key, value]) => [key, bytes(value!)]),
      );
      const fileSystem = createFileSystem(initial);
      const mutations = ['prepareDirectory', 'createNextWriter', 'moveSlot',
        'removeSlot', 'syncDirectory'] as const;
      const spies = mutations.map((method) => vi.spyOn(fileSystem, method));
      const store = new CrashSafeByteSlotStore(fileSystem);

      await expect(store.inspect(readText)).resolves.toEqual(
        input.expected === undefined ? undefined
          : { slot: input.expected, value: input.expected },
      );
      expect(fileSystem.values()).toEqual(initial);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it.each(['current', 'backup', 'next'] as const)(
      'does not fall back from invalid authoritative %s', async (slot) => {
        const initial = {
          ...(slot === 'current' ? { backup: bytes('fallback') } : {}),
          next: bytes('fallback'), [slot]: bytes('invalid'),
        };
        const fileSystem = createFileSystem(initial);
        const read = vi.spyOn(fileSystem, 'readSlot');
        const store = new CrashSafeByteSlotStore(fileSystem);
        await expect(store.inspect((value) => {
          if (readText(value) === 'invalid') throw new Error('SCHEMA_INVALID');
          return readText(value);
        })).rejects.toThrow('SCHEMA_INVALID');
        expect(read.mock.calls.at(-1)).toEqual([slot]);
        expect(fileSystem.values()).toEqual(initial);
        expect(fileSystem.syncCount).toBe(0);
      },
    );

    it('never reads a superseded slot after valid current', async () => {
      const fileSystem = createFileSystem({ current: bytes('current') });
      vi.spyOn(fileSystem, 'readSlot').mockImplementation(async (slot) => {
        if (slot !== 'current') throw new Error('STALE_SLOT_UNREADABLE');
        return bytes('current');
      });
      await expect(new CrashSafeByteSlotStore(fileSystem).inspect(readText))
        .resolves.toEqual({ slot: 'current', value: 'current' });
    });

    it('propagates an authoritative read failure without fallback or mutation', async () => {
      const fileSystem = createFileSystem({ backup: bytes('backup') });
      vi.spyOn(fileSystem, 'readSlot').mockRejectedValue(new Error('READ_FAILED'));
      await expect(new CrashSafeByteSlotStore(fileSystem).inspect(readText))
        .rejects.toThrow('READ_FAILED');
      expect(fileSystem.values()).toEqual({ backup: bytes('backup') });
    });
  });

  it.each([
    { slot: 'current', operations: ['remove:next', 'remove:backup', 'sync'] },
    { slot: 'backup', operations: ['remove:next', 'move:backup:current', 'sync'] },
    { slot: 'next', operations: ['move:next:current', 'sync'] },
  ] as const)('preserves the exact recovery mutation order for $slot', async ({ slot, operations }) => {
    const fileSystem = createFileSystem({
      ...(slot === 'current' ? { backup: bytes('backup') } : {}),
      next: bytes('next'), [slot]: bytes(slot),
    });
    const observed: string[] = [];
    const remove = fileSystem.removeSlot.bind(fileSystem);
    const move = fileSystem.moveSlot.bind(fileSystem);
    const sync = fileSystem.syncDirectory.bind(fileSystem);
    vi.spyOn(fileSystem, 'removeSlot').mockImplementation(async (name) => {
      observed.push(`remove:${name}`);
      return remove(name);
    });
    vi.spyOn(fileSystem, 'moveSlot').mockImplementation(async (source, destination) => {
      observed.push(`move:${source}:${destination}`);
      return move(source, destination);
    });
    vi.spyOn(fileSystem, 'syncDirectory').mockImplementation(async () => {
      observed.push('sync');
      await sync();
    });
    await expect(new CrashSafeByteSlotStore(fileSystem).recoverAndRead(readText)).resolves.toBe(slot);
    expect(observed).toEqual(operations);
    expect(fileSystem.values()).toEqual({ current: bytes(slot) });
  });

  it('does not sync when current has no obsolete companions to remove', async () => {
    const fileSystem = createFileSystem({ current: bytes('current') });
    await new CrashSafeByteSlotStore(fileSystem).recoverAndRead(readText);
    expect(fileSystem.syncCount).toBe(0);
  });

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
