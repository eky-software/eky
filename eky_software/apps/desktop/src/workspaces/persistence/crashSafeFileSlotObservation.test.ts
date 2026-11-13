import { mkdtemp, readFile, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem, type SlotIoEvent } from './crashSafeFileSlot.js';

const files = vi.hoisted(() => ({
  wrap: undefined as ((file: FileHandle) => FileHandle) | undefined,
  opened: [] as FileHandle[],
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, async open(...args: Parameters<typeof actual.open>) {
    const file = await actual.open(...args); files.opened.push(file);
    return files.wrap?.(file) ?? file;
  } };
});

async function fixture(context: TestContext, observer?: (event: SlotIoEvent) => void) {
  const root = await mkdtemp(join(tmpdir(), 'eky-slot-observation-'));
  let owned = true;
  const work: Promise<unknown>[] = [], release: (() => void)[] = [];
  const abort = () => { owned = false; for (const close of release) close(); };
  context.signal.addEventListener('abort', abort, { once: true });
  context.onTestFinished(async () => {
    abort(); await Promise.allSettled(work); files.wrap = undefined;
    for (const file of files.opened.splice(0)) await file.close();
    context.signal.removeEventListener('abort', abort);
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const directoryPath = join(root, 'slots'), paths = { directoryPath,
    currentPath: join(directoryPath, 'current'), nextPath: join(directoryPath, 'next'), backupPath: join(directoryPath, 'backup') };
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, 1024, observer);
  const guard = { async beforeMutation() { context.signal.throwIfAborted(); },
    assertAuthority() { context.signal.throwIfAborted(); if (!owned) throw new Error('SYNTHETIC_AUTHORITY_LOST'); } };
  return { root, paths, fs, guard, revoke: () => { owned = false; },
    track<T>(promise: Promise<T>) { work.push(promise); void promise.catch(() => undefined); return promise; },
    gate() {
      let open!: () => void, enter!: () => void;
      const held = new Promise<void>(resolve => { open = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
      release.push(open); return { held, entered, release: open, enter };
    } };
}

it.for(['off', 'on', 'throwing'] as const)('slot observation preserves actual bytes and uses only closed data: %s', async (mode, context) => {
  const events: SlotIoEvent[] = [];
  const f = await fixture(context, mode === 'off' ? undefined : event => { events.push(event); if (mode === 'throwing') throw undefined; });
  await f.fs.prepareDirectory(f.guard);
  const writer = await f.fs.createNextWriter(f.guard);
  try { expect(await writer.write(Uint8Array.from([7, 4]))).toBe(2); await writer.sync(); }
  finally { await writer.close(); }
  await f.fs.moveSlot('next', 'current', f.guard);
  expect(await f.fs.readSlot('current')).toEqual(Uint8Array.from([7, 4]));
  expect(await readFile(f.paths.currentPath)).toEqual(Buffer.from([7, 4]));
  if (mode === 'off') expect(events).toEqual([]);
  else {
    for (const operation of ['fileOpen', 'fileStat', 'fileRead', 'fileWrite', 'fileSync', 'fileClose', 'pathRename']) {
      expect(events.some(event => event.operation === operation && event.scope === 'ioAttempt' && event.event === 'fulfilled')).toBe(true);
    }
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['callId', 'event', 'operation', 'scope']);
      expect(Object.isFrozen(event)).toBe(true);
    }
    expect(events.filter(event => event.event === 'rejected')).toEqual([]);
  }
});

it.for(['fileOpen', 'fileWrite', 'fileSync', 'pathRename', 'pathRemove'] as const)(
  'slot observation cannot enter the %s mutation after callback revocation', async (operation, context) => {
    let armed = false;
    const events: SlotIoEvent[] = [];
    const f = await fixture(context, event => {
      events.push(event);
      if (armed && event.scope === 'ioAttempt' && event.operation === operation && event.event === 'entered') f.revoke();
    });
    await f.fs.prepareDirectory(f.guard);
    if (operation === 'pathRename' || operation === 'pathRemove') {
      const path = operation === 'pathRename' ? f.paths.nextPath : f.paths.currentPath;
      await writeFile(path, 'SYNTHETIC_RETAINED', { flag: 'wx' }); armed = true;
      await expect(operation === 'pathRename' ? f.fs.moveSlot('next', 'current', f.guard) : f.fs.removeSlot('current', f.guard))
        .rejects.toThrow('CRASH_SAFE_FILE_SLOT_UNAVAILABLE');
      expect(await readFile(path, 'utf8')).toBe('SYNTHETIC_RETAINED');
    } else if (operation === 'fileOpen') {
      armed = true;
      await expect(f.fs.createNextWriter(f.guard)).rejects.toThrow('CRASH_SAFE_FILE_SLOT_UNAVAILABLE');
      await expect(readFile(f.paths.nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      const writer = await f.fs.createNextWriter(f.guard);
      try {
        armed = true;
        await expect(operation === 'fileWrite' ? writer.write(Uint8Array.from([1])) : writer.sync())
          .rejects.toThrow('CRASH_SAFE_FILE_SLOT_UNAVAILABLE');
      } finally { await writer.close(); }
      expect(await readFile(f.paths.nextPath)).toEqual(Buffer.alloc(0));
      expect(events.some(event => event.operation === 'fileClose' && event.event === 'fulfilled')).toBe(true);
    }
    expect(events.some(event => event.operation === operation && event.scope === 'ioAttempt' && event.event === 'rejected')).toBe(true);
    expect(events.some(event => event.operation === operation && event.scope === 'ioAttempt' && event.event === 'fulfilled')).toBe(false);
  });

it.for(['fileWrite', 'fileSync', 'fileClose'] as const)(
  'slot observation remains pending until the held real-handle %s finishes', async (operation, context) => {
    const events: SlotIoEvent[] = [], f = await fixture(context, event => { events.push(event); });
    await f.fs.prepareDirectory(f.guard);
    const gate = f.gate(); let armed = false, held = false;
    files.wrap = file => new Proxy(file, { get(target, key) {
      if (key === 'write') return async (...args: Parameters<FileHandle['write']>) => {
        if (armed && operation === 'fileWrite' && !held) { held = true; gate.enter(); await gate.held; }
        return target.write(...args);
      };
      if (key === 'sync') return async () => {
        if (armed && operation === 'fileSync' && !held) { held = true; gate.enter(); await gate.held; }
        return target.sync();
      };
      if (key === 'close') return async () => {
        if (armed && operation === 'fileClose' && !held) { held = true; gate.enter(); await gate.held; }
        return target.close();
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const writer = await f.fs.createNextWriter(f.guard); armed = true;
    let settled = false;
    const work = f.track<unknown>((operation === 'fileWrite' ? writer.write(Uint8Array.from([4, 2])) : operation === 'fileSync' ? writer.sync() : writer.close())
      .finally(() => { settled = true; }));
    try {
      expect(await Promise.race([gate.entered.then(() => 'held'), work.then(() => 'settled')])).toBe('held');
      expect(settled).toBe(false);
      expect(events.some(event => event.scope === 'ioAttempt' && event.operation === operation && event.event === 'entered')).toBe(true);
      expect(events.some(event => event.scope === 'ioAttempt' && event.operation === operation && event.event === 'fulfilled')).toBe(false);
      gate.release(); await work; expect(settled).toBe(true);
    } finally { gate.release(); await work; await writer.close(); }
    expect(events.some(event => event.operation === 'fileClose' && event.event === 'fulfilled')).toBe(true);
  });

it('slot observation retains separate write and close rejections without error payloads', async context => {
  const events: SlotIoEvent[] = [], f = await fixture(context, event => { events.push(event); throw undefined; });
  await f.fs.prepareDirectory(f.guard);
  files.wrap = file => new Proxy(file, { get(target, key) {
    if (key === 'write') return async () => { throw new Error('SYNTHETIC_FIRST_WRITE'); };
    if (key === 'close') return async () => { await target.close(); throw new Error('SYNTHETIC_SEPARATE_CLOSE'); };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const writer = await f.fs.createNextWriter(f.guard);
  await expect(writer.write(Uint8Array.from([1]))).rejects.toThrow('CRASH_SAFE_FILE_SLOT_UNAVAILABLE');
  await expect(writer.close()).rejects.toThrow('CRASH_SAFE_FILE_SLOT_UNAVAILABLE');
  expect(events.filter(event => event.scope === 'ioAttempt' && event.event === 'rejected').map(event => event.operation))
    .toEqual(['fileWrite', 'fileClose']);
  expect(await readFile(f.paths.nextPath)).toEqual(Buffer.alloc(0));
});
