import { appendFile, lstat, mkdir, mkdtemp, open, rename, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';
import type { DiagnosticBrowsePolicy } from '../domain/diagnosticBrowsePolicy.js';
import type { DiagnosticEventPage, DiagnosticReadyPage } from '../domain/diagnosticEventPage.js';
import { FileSystemDiagnosticEventReader } from './fileSystemDiagnosticEventReader.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
const readers: FileSystemDiagnosticEventReader[] = [];
const filename = 'backend-info-2026-10-001.jsonl';
afterEach(async context => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(open).mockReset().mockImplementation(actual.open);
  for (const reader of readers.splice(0)) await reader.close();
  const owned = roots.splice(0);
  if (context.task.result?.state !== 'pass') return;
  for (const root of owned) await rm(root, { recursive: true, force: true });
});

function event(id: string, second: number) {
  return createBackendOperationalEvent({ eventName: 'backend.started' }, {
    appVersion: '1.0.0', buildRevision: '123456789abc', eventId: id,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, 0, second)).toISOString(),
  });
}
async function fixture(values: unknown[], policy?: Partial<DiagnosticBrowsePolicy>, now?: () => number) {
  const root = await mkdtemp(join(tmpdir(), 'eky-diagnostic-browse-'));
  roots.push(root);
  await mkdir(join(root, 'backend'));
  const path = join(root, 'backend', filename);
  await writeFile(path, values.map(value => `${JSON.stringify(value)}\n`).join(''));
  const observer = { captureOriginalException: vi.fn() };
  const reader = new FileSystemDiagnosticEventReader(root, observer, {
    ...(policy === undefined ? {} : { policy }), ...(now === undefined ? {} : { now }),
  });
  readers.push(reader);
  return { root, path, reader, observer };
}
async function finish(reader: FileSystemDiagnosticEventReader, first: DiagnosticEventPage): Promise<DiagnosticEventPage> {
  let page = first;
  for (let step = 0; page.state === 'scanning' && step < 4096; step++) {
    page = await reader.browseDiagnosticEvents({ cursor: page.cursor }, 'synthetic-actor');
  }
  expect(page.state).not.toBe('scanning');
  return page;
}
async function ready(reader: FileSystemDiagnosticEventReader, limit = 2): Promise<DiagnosticReadyPage> {
  const page = await finish(reader, await reader.browseDiagnosticEvents({ limit }, 'synthetic-actor'));
  expect(page.state).toBe('ready');
  if (page.state !== 'ready') throw new Error('Synthetic diagnostic page did not complete.');
  return page;
}
function cursor(page: DiagnosticReadyPage, direction: 'older' | 'newer'): string {
  const value = page[direction];
  expect(value.state).toBe('available');
  if (value.state !== 'available') throw new Error('Synthetic diagnostic direction is missing.');
  return value.cursor;
}

it('orders shuffled events and ties across pages, then returns the nearest newer page', async () => {
  const { reader } = await fixture(['a', 'Z', 'b', 'a_1', 'A', 'a-1'].map(id => event(id, 1)));
  const first = await ready(reader);
  expect(first.diagnosticEvents.map(value => value.id)).toEqual(['backend:b', 'backend:a_1']);
  const second = await finish(reader, await reader.browseDiagnosticEvents({ cursor: cursor(first, 'older') }, 'synthetic-actor'));
  expect(second.state).toBe('ready');
  if (second.state !== 'ready') return;
  expect(second.diagnosticEvents.map(value => value.id)).toEqual(['backend:a-1', 'backend:a']);
  const back = await finish(reader, await reader.browseDiagnosticEvents({ cursor: cursor(second, 'newer') }, 'synthetic-actor'));
  expect(back).toMatchObject({ state: 'ready', diagnosticEvents: first.diagnosticEvents, newer: { state: 'end' } });
});

it('reaches retained files beyond 32 sources and bytes preceding the old tail window', async () => {
  const { root, path, reader } = await fixture([]);
  for (let month = 1; month <= 12; month++) {
    for (let segment = 1; segment <= 3; segment++) {
      await writeFile(join(root, 'backend', `backend-info-2026-${String(month).padStart(2, '0')}-00${segment}.jsonl`),
        `${JSON.stringify(event(`file-${month}-${segment}`, month))}\n`);
    }
  }
  await writeFile(path, `${JSON.stringify(event('before-tail', 500))}\n${'x'.repeat(270 * 1024)}\n${JSON.stringify(event('tail', 1))}\n`);
  const page = await ready(reader, 200);
  expect(page.diagnosticEvents[0]?.id).toBe('backend:before-tail');
  expect(page.diagnosticEvents).toHaveLength(37);
  expect(page.readState).toEqual({ status: 'partial', reasons: ['invalidEntries'] });
});

it('keeps bounded steps replayable without new I/O and rejects another actor', async () => {
  const { reader } = await fixture([event('one', 1), event('two', 2)], { stepMetadata: 7 });
  const first = await reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor');
  expect(first.state).toBe('scanning');
  if (first.state !== 'scanning') return;
  await expect(reader.browseDiagnosticEvents({ cursor: first.cursor }, 'different-actor')).rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
  const next = await reader.browseDiagnosticEvents({ cursor: first.cursor }, 'synthetic-actor');
  const calls = vi.mocked(open).mock.calls.length;
  expect(await reader.browseDiagnosticEvents({ cursor: first.cursor }, 'synthetic-actor')).toEqual(next);
  expect(vi.mocked(open).mock.calls).toHaveLength(calls);
  expect(await finish(reader, next)).toMatchObject({ state: 'ready' });
});

it('preserves a navigation token while its page takes several continuation steps', async () => {
  const { reader } = await fixture([event('one', 1), event('two', 2), event('three', 3)], { stepMetadata: 7 });
  const first = await ready(reader, 1);
  const navigation = cursor(first, 'older');
  let pending = await reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor');
  expect(pending.state).toBe('scanning');
  if (pending.state !== 'scanning') return;
  pending = await reader.browseDiagnosticEvents({ cursor: pending.cursor }, 'synthetic-actor');
  expect(await reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor')).toEqual(pending);
  const next = await finish(reader, pending);
  expect(next).toMatchObject({ state: 'ready', diagnosticEvents: [{ id: 'backend:two' }] });
  expect(await reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor')).toEqual(next);
});

it('allows a manual navigation retry after an immediate transient read failure', async () => {
  const { reader } = await fixture([event('one', 1), event('two', 2)]);
  const first = await ready(reader, 1);
  const navigation = cursor(first, 'older');
  vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error('synthetic transient open failure'), { code: 'EACCES' }));
  expect(await reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor')).toMatchObject({ state: 'unavailable' });
  expect(await finish(reader, await reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor')))
    .toMatchObject({ state: 'ready', diagnosticEvents: [{ id: 'backend:one' }] });
});

it('preserves the first read exception when close also fails and retries owned cleanup on shutdown', async () => {
  const { reader, observer } = await fixture([event('one', 1)]);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const readFailure = new Error('synthetic original read failure');
  const closeFailure = new Error('synthetic secondary close failure');
  let failedClose = false;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    let readStarted = false;
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async () => { readStarted = true; throw readFailure; });
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      if (readStarted && !failedClose) { failedClose = true; throw closeFailure; }
      await close();
    });
    return handle;
  });
  expect(await reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor')).toMatchObject({ state: 'unavailable' });
  expect(observer.captureOriginalException.mock.calls[0]?.[0]).toBe(readFailure);
  expect(observer.captureOriginalException.mock.calls.some(call => call[0] === closeFailure)).toBe(true);
  const opened = vi.mocked(open).mock.calls.length;
  expect(await reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor')).toMatchObject({ state: 'unavailable' });
  expect(vi.mocked(open).mock.calls).toHaveLength(opened);
  await reader.close();
});

it('excludes later append and rotation until an explicit new start', async () => {
  const { root, path, reader } = await fixture([event('one', 1), event('two', 2)]);
  const first = await ready(reader, 1);
  await appendFile(path, `${JSON.stringify(event('appended', 9))}\n`);
  await writeFile(join(root, 'backend', 'backend-info-2026-10-002.jsonl'), `${JSON.stringify(event('rotation', 10))}\n`);
  const second = await finish(reader, await reader.browseDiagnosticEvents({ cursor: cursor(first, 'older') }, 'synthetic-actor'));
  expect(second).toMatchObject({ state: 'ready', diagnosticEvents: [{ id: 'backend:one' }] });
  expect((await ready(reader, 1)).diagnosticEvents[0]?.id).toBe('backend:rotation');
});

it.each(['truncate', 'remove', 'replace', 'rewrite'] as const)('invalidates the browse after a source %s', async action => {
  const { path, reader } = await fixture([event('one', 1), event('two', 2)]);
  const first = await ready(reader, 1);
  if (action === 'truncate') await truncate(path, 0);
  if (action === 'remove') await rm(path);
  if (action === 'replace') {
    await rename(path, `${path}.original`);
    await writeFile(path, `${JSON.stringify(event('replacement', 3))}\n`);
  }
  if (action === 'rewrite') {
    const oldSize = (await lstat(path)).size;
    await writeFile(path, [event('ONE', 1), event('two', 2)].map(value => `${JSON.stringify(value)}\n`).join(''));
    expect((await lstat(path)).size).toBe(oldSize);
  }
  await expect(reader.browseDiagnosticEvents({ cursor: cursor(first, 'older') }, 'synthetic-actor')).rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
});

it('retains both boundaries when all selected IDs conflict and the visible page is empty', async () => {
  const { reader } = await fixture([event('c', 3), event('b', 2), event('a', 1), event('c', 0)]);
  const first = await ready(reader, 1);
  expect(first.diagnosticEvents).toEqual([]);
  expect(first.readState).toEqual({ status: 'partial', reasons: ['invalidEntries'] });
  const second = await finish(reader, await reader.browseDiagnosticEvents({ cursor: cursor(first, 'older') }, 'synthetic-actor'));
  expect(second).toMatchObject({ state: 'ready', diagnosticEvents: [{ id: 'backend:b' }] });
  if (second.state !== 'ready') return;
  expect(await finish(reader, await reader.browseDiagnosticEvents({ cursor: cursor(second, 'newer') }, 'synthetic-actor')))
    .toMatchObject({ state: 'ready', diagnosticEvents: [], older: { state: 'available' } });
});

it.each([{ sourceBytes: 1 }, { directoryEntries: 1, sources: 1 }, { stateBytes: 1 }, { maximumSteps: 1, stepMetadata: 7 }])(
  'returns a terminal limited result for the bounded policy %j', async policy => {
    const { root, reader } = await fixture([event('one', 1)], policy);
    await writeFile(join(root, 'backend', 'ignored.txt'), 'synthetic');
    const page = await finish(reader, await reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor'));
    expect(page).toEqual({ state: 'limited', diagnosticEvents: [], readState: { status: 'partial', reasons: ['limitReached'] } });
  },
);

it.each(['idle', 'lifetime', 'capacity'] as const)('invalidates tokens on %s without transferring them to another browse', async kind => {
  let now = 0;
  const { reader } = await fixture([event('one', 1), event('two', 2)], { sessions: 1 }, () => now);
  const first = await ready(reader, 1);
  if (kind === 'idle') now = 300_000;
  if (kind === 'lifetime') now = 1_800_000;
  if (kind === 'capacity') await ready(reader, 1);
  await expect(reader.browseDiagnosticEvents({ cursor: cursor(first, 'older') }, 'synthetic-actor')).rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
});

it('releases idle state with an unreferenced timer without needing another request', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 0;
  try {
    const { reader } = await fixture([event('one', 1), event('two', 2)], { idleMilliseconds: 100 }, () => now);
    const page = await ready(reader, 1);
    expect(vi.getTimerCount()).toBe(1);
    now = 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(0);
    await expect(reader.browseDiagnosticEvents({ cursor: cursor(page, 'older') }, 'synthetic-actor'))
      .rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
  } finally { vi.useRealTimers(); }
});

it('does not extend hard lifetime when a valid cached page is repeatedly read', async () => {
  let now = 0;
  const { reader } = await fixture([event('one', 1), event('two', 2), event('three', 3)],
    { idleMilliseconds: 100, lifetimeMilliseconds: 250 }, () => now);
  const page = await ready(reader, 1);
  const navigation = cursor(page, 'older');
  for (const at of [80, 160, 240]) {
    now = at;
    expect(await finish(reader, await reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor')))
      .toMatchObject({ state: 'ready' });
  }
  now = 250;
  await expect(reader.browseDiagnosticEvents({ cursor: navigation }, 'synthetic-actor'))
    .rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
});

it.each([1, 2])('rejects same-length source mutation during content pass %i', async pass => {
  const { path, reader } = await fixture([event('one', 1)]);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let reads = 0;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
      reads++;
      if (reads === pass && pass === 2) await writeFile(path, `${JSON.stringify(event('two', 1))}\n`);
      const result = await Reflect.apply(read, handle, readArgs);
      if (reads === pass && pass === 1) await writeFile(path, `${JSON.stringify(event('two', 1))}\n`);
      return result;
    });
    return handle;
  });
  await expect(reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor'))
    .rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
});

it('reports the original source failure before returning a safe unavailable result', async () => {
  const { root, reader, observer } = await fixture([]);
  await rm(root, { recursive: true });
  expect(await reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor')).toEqual({ state: 'unavailable', diagnosticEvents: [],
    readState: { status: 'unavailable', reasons: ['sourceUnavailable'] } });
  expect(observer.captureOriginalException).toHaveBeenCalledOnce();
  expect(observer.captureOriginalException.mock.calls[0]?.[0]).toBeInstanceOf(Error);
});

it('waits for a held real file read and its handle close, while rejecting new work', async () => {
  const { reader } = await fixture([event('one', 1)]);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const entered = deferred();
  const release = deferred();
  let handleClosed = false;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
      handleClosed = false;
      entered.resolve();
      await release.promise;
      return Reflect.apply(read, handle, readArgs);
    });
    vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); handleClosed = true; });
    return handle;
  });
  const request = reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor');
  const rejected = expect(request).rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
  await entered.promise;
  await expect(reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor'))
    .rejects.toMatchObject({ code: 'diagnostic_browse_busy' });
  let closed = false;
  const closing = reader.close().then(() => { closed = true; });
  expect(reader.close()).toBe(reader.close());
  try {
    await expect(reader.browseDiagnosticEvents({ limit: 1 }, 'synthetic-actor')).rejects.toMatchObject({ code: 'diagnostic_browse_stale' });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(handleClosed).toBe(false);
  } finally { release.resolve(); }
  await rejected;
  await closing;
  expect(handleClosed).toBe(true);
});

it('bounds actual chunk reads per response and closes every opened file before continuation', async () => {
  const { reader } = await fixture(Array.from({ length: 30 }, (_, index) => event(`bounded-${index}`, index)),
    { chunkBytes: 1024, stepBytes: 2048, stepChunks: 2, stepMetadata: 14 });
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let opened = 0;
  let closed = 0;
  let bytes = 0;
  let chunks = 0;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    opened++;
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
      const result = await Reflect.apply(read, handle, readArgs);
      bytes += result.bytesRead;
      chunks++;
      return result;
    });
    vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed++; });
    return handle;
  });
  let page: DiagnosticEventPage | undefined;
  let requests = 0;
  do {
    bytes = 0;
    chunks = 0;
    page = await reader.browseDiagnosticEvents(page?.state === 'scanning' ? { cursor: page.cursor } : { limit: 2 }, 'synthetic-actor');
    expect(bytes).toBeLessThanOrEqual(2048);
    expect(chunks).toBeLessThanOrEqual(2);
    expect(opened).toBe(closed);
    requests++;
  } while (page.state === 'scanning' && requests < 4096);
  expect(page).toMatchObject({ state: 'ready' });
  expect(requests).toBeGreaterThan(1);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
