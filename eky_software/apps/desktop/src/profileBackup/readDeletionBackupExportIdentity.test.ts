import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';

import { backupStreamChunkBytes, maximumBackupContainerBytes } from './container/backupContainerLimits.js';
import { createDeletionBackupExportIdentity } from './deletionBackupReceipt.js';
import { readDeletionBackupExportIdentity } from './readDeletionBackupExportIdentity.js';

afterEach(() => vi.restoreAllMocks());

it('hashes actual bounded chunks and returns the identity of the closed read handle', async () => {
  const f = await fixture();
  const metadata = await fs.lstat(f.path, { bigint: true });
  f.onOpen(file => {
    const read = file.read.bind(file);
    vi.spyOn(file, 'read').mockImplementation(async (...args) => {
      if (typeof args[0]?.length === 'number') f.readLengths.push(args[0].length);
      return read(...args);
    });
  });
  const result = await readDeletionBackupExportIdentity(f.path, f.guard);
  expect(result).toEqual(createDeletionBackupExportIdentity(metadata,
    createHash('sha256').update(f.bytes).digest('hex')));
  expect(f.readLengths.every(length => length <= backupStreamChunkBytes)).toBe(true);
  expect(f.readLengths.length).toBeGreaterThan(1);
  expect(f.files.every(file => file.fd < 0)).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
});

it('waits for actual close before returning a receipt', async () => {
  const f = await fixture();
  const gate = deferred(); const entered = deferred();
  f.onOpen(file => {
    const close = file.close.bind(file);
    vi.spyOn(file, 'close').mockImplementation(async () => { entered.resolve(); await gate.promise; await close(); });
  });
  let settled = false;
  const reading = readDeletionBackupExportIdentity(f.path, f.guard).finally(() => { settled = true; });
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(f.files[0]!.fd).toBeGreaterThanOrEqual(0);
  } finally { gate.resolve(); await reading; }
});

it.each(['open', 'read', 'close'] as const)('rejects authority lost during %s and still joins close', async stage => {
  const f = await fixture();
  f.onOpen(file => {
    if (stage === 'open') { f.revoke(); return; }
    if (stage === 'read') {
      const read = file.read.bind(file);
      vi.spyOn(file, 'read').mockImplementation(async (...args) => { const result = await read(...args); f.revoke(); return result; });
    } else {
      const close = file.close.bind(file);
      vi.spyOn(file, 'close').mockImplementation(async () => { await close(); f.revoke(); });
    }
  });
  await expect(readDeletionBackupExportIdentity(f.path, f.guard)).rejects.toThrow('SYNTHETIC_AUTHORITY_LOST');
  expect(f.files.every(file => file.fd < 0)).toBe(true);
});

it.each(['read', 'close'] as const)('rejects a same-byte path replacement during %s', async stage => {
  const f = await fixture();
  let replaced = false;
  const replace = async () => {
    if (replaced) return;
    replaced = true;
    await fs.rename(f.path, join(f.root, 'original'));
    await fs.writeFile(f.path, f.bytes, { flag: 'wx' });
  };
  f.onOpen(file => {
    if (stage === 'read') {
      const read = file.read.bind(file);
      vi.spyOn(file, 'read').mockImplementation(async (...args) => { const result = await read(...args); await replace(); return result; });
    } else {
      const close = file.close.bind(file);
      vi.spyOn(file, 'close').mockImplementation(async () => { await close(); await replace(); });
    }
  });
  await expect(readDeletionBackupExportIdentity(f.path, f.guard)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(replaced).toBe(true);
  expect(f.files.every(file => file.fd < 0)).toBe(true);
  await expect(fs.readFile(join(f.root, 'original'))).resolves.toEqual(f.bytes);
});

it('does not treat a zero-byte short read as a complete hash', async () => {
  const f = await fixture();
  f.onOpen(file => vi.spyOn(file, 'read').mockImplementation(async (...args) => {
    return { bytesRead: 0, buffer: args[0]?.buffer ?? Buffer.alloc(0) };
  }));
  await expect(readDeletionBackupExportIdentity(f.path, f.guard)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(f.files.every(file => file.fd < 0)).toBe(true);
});

it('retains the first read error separately from an uncertain close', async () => {
  const f = await fixture(); f.retain();
  const first = new Error('SYNTHETIC_READ_FAILED');
  const cleanup = new Error('SYNTHETIC_CLOSE_UNCERTAIN');
  f.onOpen(file => {
    vi.spyOn(file, 'read').mockRejectedValue(first);
    vi.spyOn(file, 'close').mockRejectedValue(cleanup);
  });
  const error = await readDeletionBackupExportIdentity(f.path, f.guard).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(first);
  expect(error.errors).toEqual([first, cleanup]);
  expect(f.files[0]!.fd).toBeGreaterThanOrEqual(0);
  await expect(fs.readFile(f.path)).resolves.toEqual(f.bytes);
});

it('rejects an oversized file before opening it using the existing container limit', async () => {
  const f = await fixture();
  const metadata = await fs.lstat(f.path, { bigint: true });
  Object.defineProperty(metadata, 'size', { value: maximumBackupContainerBytes + 1n });
  vi.spyOn(fs, 'lstat').mockResolvedValueOnce(metadata);
  await expect(readDeletionBackupExportIdentity(f.path, f.guard)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(f.files).toHaveLength(0);
});

it('rejects a directory without opening a file', async () => {
  const f = await fixture();
  await expect(readDeletionBackupExportIdentity(f.root, f.guard)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(f.files).toHaveLength(0);
});

it('rejects asynchronous authority callbacks before filesystem access', async () => {
  const f = await fixture();
  await expect(readDeletionBackupExportIdentity(f.path, async () => undefined)).rejects.toThrow();
  expect(f.files).toHaveLength(0);
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'eky-delete-export-reader-'));
  const path = join(root, 'export.ekybackup');
  const bytes = Buffer.alloc(backupStreamChunkBytes * 2 + 17, 83);
  await fs.writeFile(path, bytes, { flag: 'wx' });
  const files: FileHandle[] = [];
  const readLengths: number[] = [];
  let preserved = false;
  let current = true;
  let opened: ((file: FileHandle) => void) | undefined;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    files.push(file);
    opened?.(file);
    return file;
  });
  onTestFinished(async ({ task }) => {
    const results = await Promise.allSettled(files.filter(file => file.fd >= 0).map(file => file.close()));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length !== 0) throw new AggregateError(failures.map(result => result.reason), 'SYNTHETIC_READER_CLEANUP_FAILED');
    if (task.result?.state === 'pass' && !preserved) await fs.rm(root, { recursive: true });
  });
  return { root, path, bytes, files, readLengths, onOpen(callback: (file: FileHandle) => void) { opened = callback; },
    guard() { if (!current) throw new Error('SYNTHETIC_AUTHORITY_LOST'); }, revoke() { current = false; },
    retain() { preserved = true; } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}
