import { createHash, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createProfileSnapshotArtifactIdentity } from '../../runtime/profileInspectionArtifactIdentity.js';
import { readProfileInspectionFailureCause } from '../../runtime/profileInspectionFailure.js';
import type { ProfileInspectionDocumentBinding } from '../../runtime/profileInspectionDocumentBindings.js';
import { profileInspectionProtocolVersion, profileInspectionWorkMilliseconds,
  type ProfileInspectionColdSources } from '../../runtime/profileInspectionMessages.js';
import { assertProfileRestoreColdSourceBytes as assertBytes,
  assertProfileRestoreOriginalSourceBytes as assertOriginalBytes } from './assertProfileRestoreColdSourceBytes.js';
import type { ProfileRestoreColdInspectionResult } from './runProfileRestoreColdInspection.js';

const roots: string[] = [];
const observers: { restore(): Promise<void> }[] = [];
afterEach(async () => {
  for (const observer of observers.splice(0)) await observer.restore();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fileSystem.rm(root, { recursive: true, force: true });
});

describe('cold source PDF byte batches', () => {
  it.each([0, 1, 4, 5, 9])('reads %i PDFs with real hashes, bounded buffers and a separate database read', async count => {
    const f = await fixture(count, 2 * 64 * 1024 + 17);
    const tracker = observeFiles(f);
    const realpath = vi.spyOn(fileSystem, 'realpath');
    let finalReadStart = 0;
    f.input.assertFinalAuthority.mockImplementation(async () => { finalReadStart = realpath.mock.calls.length; });
    await assertBytes(f.input);
    expect(tracker.stats.opened.slice(0, -1).sort()).toEqual([...f.paths].sort());
    expect(tracker.stats.opened.at(-1)).toBe(f.databasePath);
    expect(tracker.stats.databaseOverlap).toBe(false);
    expect(tracker.stats.peakPdfs).toBeLessThanOrEqual(4);
    expect(tracker.stats.peakReadBufferBytes).toBeLessThanOrEqual(4 * 64 * 1024);
    expect(tracker.handles.size).toBe(0);
    expect(tracker.stats.closed).toHaveLength(count + 1);
    expect(f.input.assertFinalAuthority).toHaveBeenCalledOnce();
    expect(realpath.mock.calls.slice(finalReadStart).map(([path]) => path)
      .filter(path => f.paths.includes(String(path)) || path === f.databasePath)).toEqual([...f.paths, f.databasePath]);
    await expectUnchanged(f);
  });

  it.each([['active', 'active'], ['active', 'staged'], ['staged', 'active'], ['staged', 'staged']] as const)(
    'keeps the %s database and %s document selection across batches', async (databaseSlot, documentsSlot) => {
      const f = await fixture(9, 1303, { databaseSlot, documentsSlot });
      const tracker = observeFiles(f);
      await assertBytes(f.input);
      expect(tracker.stats.opened).toHaveLength(10);
      expect(tracker.stats.databaseOverlap).toBe(false);
      await expectUnchanged(f);
    },
  );

  it('keeps the original-content role on the same bounded reader', async () => {
    const f = await fixture(9, 1303, { databaseSlot: 'active', documentsSlot: 'active' });
    const tracker = observeFiles(f);
    await assertOriginalBytes({ ...f.input,
      sources: { workspaceRoot: f.input.sources.workspaceRoot, layout: 'profileRestore',
        databaseSlot: 'active', documentsSlot: 'active' },
      result: { documents: f.input.result.documents, status: {
        type: 'originalCompleted', protocolVersion: profileInspectionProtocolVersion,
        operationId: basename(f.input.operationRoot), generationId: randomUUID(), runtimeSession: 'a'.repeat(43),
        result: { ...f.input.result.receipt, sourceRole: 'original', layout: 'profileRestore',
          databaseSlot: 'active', documentsSlot: 'active' },
      } },
    });
    expect(tracker.stats.opened).toHaveLength(10);
    expect(tracker.stats.peakPdfs).toBeLessThanOrEqual(4);
    expect(tracker.stats.databaseOverlap).toBe(false);
    expect(tracker.handles.size).toBe(0);
    await expectUnchanged(f);
  });

  it('starts four reads but waits for every close before the next batch or database', async () => {
    const f = await fixture();
    const reads = deferred();
    const close = deferred();
    let entered = 0;
    let closing = false;
    const tracker = observeFiles(f, {
      async beforeRead(index, position) {
        if (index < 0 || index >= 4 || position !== 0) return;
        entered += 1;
        await reads.promise;
      },
      async beforeClose(index) { if (index === 0) { closing = true; await close.promise; } },
    });
    let settled = false;
    const operation = assertBytes(f.input).finally(() => { settled = true; });
    const outcome = operation.then(() => undefined, (error: unknown) => error);
    try {
      await vi.waitFor(() => expect(entered).toBe(4));
      expect(tracker.stats.peakPdfs).toBe(4);
      expect(tracker.stats.opened).toHaveLength(4);
      reads.resolve();
      await vi.waitFor(() => { expect(closing).toBe(true); expect(tracker.stats.closed).toHaveLength(3); });
      await nextTurn();
      expect(settled).toBe(false);
      expect(tracker.stats.opened).toHaveLength(4);
    } finally { reads.resolve(); close.resolve(); await outcome; }
    await expect(operation).resolves.toBeUndefined();
    expect(tracker.stats.peakPdfs).toBe(4);
    expect(tracker.stats.opened.at(-1)).toBe(f.databasePath);
    expect(tracker.stats.databaseOverlap).toBe(false);
    expect(tracker.handles.size).toBe(0);
  });

  it.each(['cancel', 'deadline', 'authority'] as const)('drains started reads after in-flight %s without starting another batch', async kind => {
    const f = await fixture();
    const reads = Array.from({ length: 4 }, deferred);
    let entered = 0;
    const tracker = observeFiles(f, { async beforeRead(index, position) {
      if (index < 0 || position !== 0) return;
      entered += 1;
      await reads[index]?.promise;
    } });
    const now = vi.spyOn(performance, 'now');
    let settled = false;
    const operation = assertBytes(f.input).then(() => undefined, (error: unknown) => error)
      .finally(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(entered).toBe(4));
      if (kind === 'cancel') f.cancellation.abort();
      if (kind === 'deadline') now.mockReturnValue(f.input.deadline);
      if (kind === 'authority') f.authorityValid = false;
      reads[0]!.resolve();
      await vi.waitFor(() => expect(tracker.stats.closed).toContain(f.paths[0]));
      // A recovered clock or caller cannot clear the first failure of this batch.
      now.mockRestore();
      f.authorityValid = true;
      await nextTurn();
      expect(settled).toBe(false);
      expect(tracker.stats.opened).toHaveLength(4);
    } finally {
      for (const read of reads) read.resolve();
      await operation;
      now.mockRestore();
    }
    expect(errorTree(await operation).map(error => error instanceof Error ? error.message : error))
      .toContain(kind === 'authority' ? 'TEST_AUTHORITY_REVOKED' : 'PROFILE_INSPECTION_TIMEOUT');
    expect(readProfileInspectionFailureCause(await operation))
      .toBe(kind === 'authority' ? undefined : 'PROFILE_INSPECTION_TIMEOUT');
    expect(tracker.stats.opened).toHaveLength(4);
    expect(tracker.stats.closed).toHaveLength(4);
    expect(tracker.handles.size).toBe(0);
    expect(f.input.assertFinalAuthority).not.toHaveBeenCalled();
    await expectUnchanged(f);
  });

  it('preserves the first observed read failure before its close settles, including later read and close failures', async () => {
    const f = await fixture();
    const reads = Array.from({ length: 4 }, deferred);
    const close = deferred();
    const primary = new Error('TEST_FIRST_READ_FAILURE');
    const later = new Error('TEST_LATER_READ_FAILURE');
    const secondary = new Error('TEST_CLOSE_FAILURE');
    let entered = 0;
    let closing = false;
    const tracker = observeFiles(f, {
      async beforeRead(index, position) {
        if (index < 0 || position !== 0) return;
        entered += 1;
        await reads[index]?.promise;
        if (index === 2) throw primary;
        if (index === 0) throw later;
      },
      async beforeClose(index) { if (index === 2) { closing = true; await close.promise; } },
      afterClose(index) { if (index === 0) throw secondary; },
    });
    let settled = false;
    const operation = assertBytes(f.input).then(() => undefined, (error: unknown) => error)
      .finally(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(entered).toBe(4));
      reads[2]!.resolve();
      await vi.waitFor(() => expect(closing).toBe(true));
      reads[0]!.resolve();
      await vi.waitFor(() => expect(tracker.stats.closed).toContain(f.paths[0]));
      await nextTurn();
      expect(settled).toBe(false);
      expect(tracker.stats.opened).toHaveLength(4);
    } finally {
      for (const read of reads) read.resolve();
      close.resolve();
      await operation;
    }
    const error = await operation;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toBe(primary);
    expect(errorTree(error)).toEqual(expect.arrayContaining([primary, later, secondary]));
    expect(tracker.stats.opened).toHaveLength(4);
    expect(tracker.stats.closed).toHaveLength(4);
    expect(tracker.handles.size).toBe(0);
    expect(f.input.assertFinalAuthority).not.toHaveBeenCalled();
    await expectUnchanged(f);
  });

  it('rejects an unconfirmed close without claiming it closed or removing source evidence', async () => {
    const f = await fixture();
    const failure = new Error('TEST_CLOSE_UNCONFIRMED');
    const tracker = observeFiles(f, { beforeClose(index) { if (index === 0) throw failure; } });
    const error = await assertBytes(f.input).then(() => undefined, (caught: unknown) => caught);
    expect(errorTree(error)).toContain(failure);
    expect(tracker.handles.size).toBe(1);
    expect(tracker.stats.opened.length).toBeLessThanOrEqual(4);
    expect(tracker.stats.closed).not.toContain(f.paths[0]);
    expect(f.input.assertFinalAuthority).not.toHaveBeenCalled();
    await expectUnchanged(f);
  });

  it.each(['hash', 'signature', 'size'] as const)('rejects a later-batch PDF %s mismatch before reading the database', async kind => {
    const f = await fixture();
    const document = f.input.result.documents[6]!;
    const bytes = Buffer.alloc(document.byteSize, 70);
    if (kind !== 'signature') bytes.write('%PDF-1.7\n');
    await fileSystem.writeFile(f.paths[6]!, kind === 'size' ? Buffer.concat([bytes, Buffer.from('x')]) : bytes);
    if (kind === 'signature') {
      const documents = f.input.result.documents.map((item, index) => index === 6 ? { ...item, sha256: hash(bytes) } : item);
      f.input.result = { ...f.input.result, documents,
        receipt: { ...f.input.result.receipt, artifactIdentity: createProfileSnapshotArtifactIdentity(documents) } };
    }
    const tracker = observeFiles(f);
    const error = await assertBytes(f.input).then(() => undefined, (caught: unknown) => caught);
    expect(errorTree(error).map(item => item instanceof Error ? item.message : item)).toContain('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(tracker.stats.opened).not.toContain(f.paths[8]);
    expect(tracker.stats.opened).not.toContain(f.databasePath);
    expect(tracker.handles.size).toBe(0);
    expect(f.input.assertFinalAuthority).not.toHaveBeenCalled();
  });

  it.each(['database', 'finalAuthority'] as const)('rebinds earlier batches after %s work', async kind => {
    const f = await fixture();
    const mutate = () => fileSystem.writeFile(f.paths[0]!, Buffer.alloc(f.input.result.documents[0]!.byteSize, 70));
    const tracker = observeFiles(f, { async beforeOpen(index) { if (kind === 'database' && index === -1) await mutate(); } });
    if (kind === 'finalAuthority') f.input.assertFinalAuthority.mockImplementation(mutate);
    await expect(assertBytes(f.input)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(tracker.stats.opened).toHaveLength(10);
    expect(tracker.handles.size).toBe(0);
    expect(await fileSystem.readFile(f.databasePath)).toEqual(f.database);
  });

  it('reads fresh bytes again instead of reusing a successful batch receipt', async () => {
    const f = await fixture();
    await assertBytes(f.input);
    const bytes = Buffer.alloc(f.input.result.documents[4]!.byteSize, 70);
    bytes.write('%PDF-1.7\n');
    await fileSystem.writeFile(f.paths[4]!, bytes);
    await expect(assertBytes(f.input)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(count = 9, size = 1303, slots: Pick<ProfileInspectionColdSources, 'databaseSlot' | 'documentsSlot'> = {
  databaseSlot: 'staged', documentsSlot: 'staged',
}) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-cold-source-batch-'));
  roots.push(root);
  const workspaceRoot = join(root, 'workspace');
  const operationRoot = join(workspaceRoot, 'runtime', 'failed-profile-restores', randomUUID());
  const active = createDesktopProfilePaths(workspaceRoot);
  const databasePath = slots.databaseSlot === 'active' ? active.databaseFilePath : join(operationRoot, 'profile.sqlite');
  const documentsRoot = slots.documentsSlot === 'active' ? active.invoiceDocumentStorageRoot : join(operationRoot, 'activation/storage/invoices');
  for (const path of [workspaceRoot, operationRoot, dirname(databasePath), documentsRoot])
    await fileSystem.mkdir(path, { recursive: true, mode: 0o700 });
  const database = Buffer.from('Synthetic byte-reader fixture, not a SQLite database.');
  await fileSystem.writeFile(databasePath, database, { flag: 'wx', mode: 0o600 });
  const documents: ProfileInspectionDocumentBinding[] = [];
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const bytes = Buffer.alloc(size, 65 + index % 26);
    bytes.write('%PDF-1.7\n');
    const storagePath = `document-${index}.pdf`;
    const path = join(documentsRoot, storagePath);
    await fileSystem.writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    documents.push({ storagePath, logicalPath: `artifacts/invoicing/invoice-documents/${hash(Buffer.from(String(index)))}.pdf`,
      byteSize: size, sha256: hash(bytes) });
    paths.push(path);
  }
  const result: ProfileRestoreColdInspectionResult = { documents, receipt: { ...slots,
    profileId: 'b'.repeat(64), databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', migrationChainIdentity: 'c'.repeat(64),
    artifactCount: count, artifactTotalByteSize: count * size, artifactIdentity: createProfileSnapshotArtifactIdentity(documents),
    database: { byteSize: database.length, sha256: hash(database) }, documentBindings: { byteSize: 34, sha256: 'd'.repeat(64) } } };
  const cancellation = new AbortController();
  const f = { root, paths, databasePath, database, cancellation, authorityValid: true,
    input: { operationRoot, sources: { workspaceRoot, ...slots }, result, signal: cancellation.signal,
      deadline: performance.now() + profileInspectionWorkMilliseconds,
      assertAuthority() { if (!f.authorityValid) throw new Error('TEST_AUTHORITY_REVOKED'); },
      assertFinalAuthority: vi.fn(async () => {}),
    } };
  return f;
}

function observeFiles(f: Awaited<ReturnType<typeof fixture>>, hooks: {
  beforeOpen?: (index: number) => void | Promise<void>;
  beforeRead?: (index: number, position: number) => void | Promise<void>;
  beforeClose?: (index: number) => void | Promise<void>;
  afterClose?: (index: number) => void;
} = {}) {
  const open = fileSystem.open.bind(fileSystem);
  const handles = new Map<FileHandle, { index: number; bufferBytes: number; close: () => Promise<void> }>();
  const stats = { opened: [] as string[], closed: [] as string[], peakPdfs: 0, peakReadBufferBytes: 0, databaseOverlap: false };
  const openSpy = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof fileSystem.open>) => {
    const path = String(args[0]);
    const index = f.paths.indexOf(path);
    await hooks.beforeOpen?.(index);
    const handle = await open(...args);
    const record = { index, bufferBytes: 0, close: handle.close.bind(handle) };
    const read = handle.read.bind(handle);
    handles.set(handle, record);
    stats.opened.push(path);
    const pdfs = () => [...handles.values()].filter(item => item.index >= 0);
    stats.peakPdfs = Math.max(stats.peakPdfs, pdfs().length);
    if (path === f.databasePath && pdfs().length !== 0) stats.databaseOverlap = true;
    // The reader uses the positional Buffer overload; all bytes and metadata remain real.
    vi.spyOn(handle, 'read').mockImplementation((async (buffer: Buffer, offset: number, length: number, position: number) => {
      record.bufferBytes = buffer.byteLength;
      stats.peakReadBufferBytes = Math.max(stats.peakReadBufferBytes, pdfs().reduce((sum, item) => sum + item.bufferBytes, 0));
      await hooks.beforeRead?.(index, position);
      return read(buffer, offset, length, position);
    }) as typeof handle.read);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await hooks.beforeClose?.(index);
      await record.close();
      handles.delete(handle);
      stats.closed.push(path);
      hooks.afterClose?.(index);
    });
    return handle;
  });
  const observer = { stats, handles, async restore() {
    openSpy.mockRestore();
    // Test cleanup of an injected unconfirmed close is not a successful reader close.
    for (const record of handles.values()) await record.close();
    handles.clear();
  } };
  observers.push(observer);
  return observer;
}

async function expectUnchanged(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await fileSystem.readFile(f.databasePath)).toEqual(f.database);
  for (let index = 0; index < f.paths.length; index += 1)
    expect(hash(await fileSystem.readFile(f.paths[index]!))).toBe(f.input.result.documents[index]!.sha256);
}
function errorTree(error: unknown): unknown[] { return [error, ...(error instanceof AggregateError ? error.errors.flatMap(errorTree) : [])]; }
function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
