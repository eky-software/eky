import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { observeWorkspaceDeletionDirectoryEntries as observe, workspaceDeletionDirectoryEntryPageSize as pageSize,
  workspaceDeletionDirectoryReads as nativeReads, type WorkspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-directory-'));
  await chmod(root, 0o700);
  const path = join(root, 'entries');
  await mkdir(path, { mode: 0o700 });
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  let owned = true;
  let selected = true;
  const authority = {
    assertAuthority() { if (!owned) throw new Error('SYNTHETIC_LEASE_LOST'); },
    async assertExternalSelection() { if (!selected) throw new Error('SYNTHETIC_SELECTION_CHANGED'); },
  };
  return { root, path, authority, expire() { owned = false; }, changeSelection() { selected = false; } };
}

async function collect(source: AsyncIterable<string>) {
  const names: string[] = [];
  for await (const name of source) names.push(name);
  return names;
}

function syntheticReads(names: readonly string[]) {
  const handles = { opened: 0, closed: 0, reads: 0, active: 0 };
  const reads: WorkspaceDeletionDirectoryReads = {
    async directoryIdentity(_path, assertCurrent) { assertCurrent(); return 'same-directory'; },
    async openDirectory() {
      const values = handles.opened++ % 2 === 0 ? [...names].reverse() : [...names];
      handles.active++;
      let offset = 0;
      return {
        async read() {
          handles.reads++;
          return offset < values.length ? { name: values[offset++]! } : null;
        },
        async close() { handles.active--; handles.closed++; },
      };
    },
  };
  return { reads, handles };
}

it('selects multiple fixed-size pages in raw lexical order across differently ordered native-style scans', async context => {
  const f = await fixture(context);
  const names = [...Array.from({ length: pageSize * 2 + 3 }, (_, index) => `entry-${index.toString().padStart(3, '0')}`),
    'Z', 'a', '\u00e4', '\u212b'];
  const source = syntheticReads(names);
  expect(pageSize).toBe(64);
  expect(await collect(observe(f.path, f.authority, source.reads))).toEqual([...names].sort());
  expect(source.handles.opened).toBe(4);
  expect(source.handles.closed).toBe(4);
  expect(source.handles.reads).toBe(4 * (names.length + 1));
  expect(source.handles.active).toBe(0);
});

it('returns real file and directory names unchanged without reading payload contents', async context => {
  const f = await fixture(context);
  const names = ['z-file', 'A-upper', 'a-lower', '\u00e4-file', 'subdirectory'];
  for (const name of names.slice(0, -1)) await writeFile(join(f.path, name), 'retained', { mode: 0o600 });
  await mkdir(join(f.path, 'subdirectory'), { mode: 0o700 });
  await writeFile(join(f.path, 'subdirectory', 'not-an-entry'), 'nested-retained', { mode: 0o600 });
  expect(await collect(observe(f.path, f.authority))).toEqual([...names].sort());
  expect(await readFile(join(f.path, 'z-file'), 'utf8')).toBe('retained');
  expect(await readFile(join(f.path, 'subdirectory', 'not-an-entry'), 'utf8')).toBe('nested-retained');
});

it('keeps full checkpoints around every operation without duplicating adjacent post-read and pre-read checks', async context => {
  const f = await fixture(context);
  const names = Array.from({ length: pageSize + 2 }, (_, index) => `name-${index.toString().padStart(3, '0')}`);
  const trace: string[] = [];
  const checkpoint = ['external', 'identity', 'external'];
  const authority = { ...f.authority, async assertExternalSelection() {
    trace.push('external'); await f.authority.assertExternalSelection();
  } };
  const reads: WorkspaceDeletionDirectoryReads = {
    async directoryIdentity(_path, assertCurrent) { assertCurrent(); trace.push('identity'); return 'same'; },
    async openDirectory() {
      trace.push('open');
      let offset = names.length;
      return {
        async read() { trace.push('read'); return offset > 0 ? { name: names[--offset]! } : null; },
        async close() { trace.push('close'); },
      };
    },
  };
  const observed = [];
  for await (const name of observe(f.path, authority, reads)) { trace.push('yield'); observed.push(name); }
  const expected: string[] = [];
  for (const count of [pageSize, names.length - pageSize, 0]) {
    expected.push(...checkpoint, 'open', ...checkpoint);
    for (let index = 0; index <= names.length; index++) expected.push('read', ...checkpoint);
    expected.push('close', ...checkpoint);
    for (let index = 0; index < count; index++) expected.push(...checkpoint, 'yield');
  }
  expect(observed).toEqual(names);
  expect(trace).toEqual(expected);
});

it('checks live authority again after synchronous entry handling before the next read', async context => {
  const f = await fixture(context);
  let readCalls = 0, closed = 0;
  const reads: WorkspaceDeletionDirectoryReads = {
    async directoryIdentity(_path, assertCurrent) { assertCurrent(); return 'same'; },
    async openDirectory() {
      return {
        async read() { readCalls++; return { get name() { f.expire(); return 'entry'; } }; },
        async close() { closed++; },
      };
    },
  };
  await expect(collect(observe(f.path, f.authority, reads))).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect({ readCalls, closed }).toEqual({ readCalls: 1, closed: 1 });
});

it('reads more than one native page with bounded rescans and closes every original handle', async context => {
  const f = await fixture(context);
  const names = Array.from({ length: pageSize + 1 }, (_, index) => `entry-${index.toString().padStart(3, '0')}`);
  for (const name of [...names].reverse()) await writeFile(join(f.path, name), name, { mode: 0o600 });
  let opened = 0, closed = 0, active = 0, readCount = 0;
  const reads: WorkspaceDeletionDirectoryReads = { ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    opened++; active++;
    return {
      async read() { readCount++; return directory.read(); },
      async close() { await directory.close(); closed++; active--; },
    };
  } };
  expect(await collect(observe(f.path, f.authority, reads))).toEqual(names);
  expect({ opened, closed, active, readCount }).toEqual({ opened: 3, closed: 3, active: 0,
    readCount: 3 * (names.length + 1) });
  for (const name of names) expect(await readFile(join(f.path, name), 'utf8')).toBe(name);
});

it('closes an empty directory and does not create an absent directory', async context => {
  const f = await fixture(context);
  expect(await collect(observe(f.path, f.authority))).toEqual([]);
  await expect(collect(observe(join(f.root, 'missing'), f.authority))).rejects.toThrow();
});

it('closes the page before yielding and holds no directory open when the consumer stops', async context => {
  const f = await fixture(context);
  const source = syntheticReads(['b', 'a']);
  const reader = observe(f.path, f.authority, source.reads);
  expect(await reader.next()).toEqual({ done: false, value: 'a' });
  expect(source.handles.active).toBe(0);
  expect(source.handles.closed).toBe(1);
  await reader.return(undefined);
  expect(source.handles.opened).toBe(1);
});

it('checks live selection again before yielding a cached next name', async context => {
  const f = await fixture(context);
  const source = syntheticReads(['a', 'b']);
  const reader = observe(f.path, f.authority, source.reads);
  expect((await reader.next()).value).toBe('a');
  f.changeSelection();
  await expect(reader.next()).rejects.toThrow('SYNTHETIC_SELECTION_CHANGED');
  expect(source.handles.closed).toBe(source.handles.opened);
});

it('observes late names ahead of the cursor but makes no completeness claim for names behind it', async context => {
  const f = await fixture(context);
  const names = Array.from({ length: pageSize + 2 }, (_, index) => `m-${index.toString().padStart(3, '0')}`);
  const source = syntheticReads(names);
  const reader = observe(f.path, f.authority, source.reads);
  const observed: string[] = [];
  for (let index = 0; index < pageSize; index++) {
    const next = await reader.next();
    if (next.done) throw new Error('SYNTHETIC_EARLY_PAGE_END');
    observed.push(next.value);
  }
  names.push('a-late-behind', 'z-late-ahead');
  while (true) {
    const next = await reader.next();
    if (next.done) { expect(next.value).toBeUndefined(); break; }
    observed.push(next.value);
  }
  expect(observed).toEqual(names.filter(name => name !== 'a-late-behind').sort());
  expect(await collect(observe(f.path, f.authority, source.reads))).toEqual([...names].sort());
});

it.for(['open', 'read', 'close'] as const)('rejects scanned-parent replacement during %s and joins the original handle', async (phase, context) => {
  const f = await fixture(context);
  await writeFile(join(f.path, 'retained'), 'original', { mode: 0o600 });
  const retained = join(f.root, 'original-directory');
  let changed = false;
  let closed = 0;
  const replace = async () => {
    if (changed) return;
    changed = true;
    await rename(f.path, retained);
    await mkdir(f.path, { mode: 0o700 });
  };
  const reads: WorkspaceDeletionDirectoryReads = { ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    if (phase === 'open') await replace();
    return {
      async read() { const entry = await directory.read(); if (phase === 'read') await replace(); return entry; },
      async close() { await directory.close(); closed++; if (phase === 'close') await replace(); },
    };
  } };
  await expect(collect(observe(f.path, f.authority, reads))).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(changed).toBe(true);
  expect(closed).toBe(1);
  expect(await readFile(join(retained, 'retained'), 'utf8')).toBe('original');
});

it('rejects a linked directory and preserves its foreign contents', async context => {
  const f = await fixture(context);
  const retained = join(f.root, 'foreign-directory');
  await rename(f.path, retained);
  await writeFile(join(retained, 'retained'), 'foreign', { mode: 0o600 });
  await symlink(retained, f.path, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(collect(observe(f.path, f.authority))).rejects.toThrow();
  expect(await readFile(join(retained, 'retained'), 'utf8')).toBe('foreign');
});

it.for(['authority', 'selection'] as const)('joins an unresolved read and close after %s is revoked', async (kind, context) => {
  const f = await fixture(context);
  let entered!: () => void;
  let releaseRead!: () => void;
  let closeEntered!: () => void;
  let releaseClose!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const readPending = new Promise<void>(resolve => { releaseRead = resolve; });
  const closing = new Promise<void>(resolve => { closeEntered = resolve; });
  const closePending = new Promise<void>(resolve => { releaseClose = resolve; });
  let closeCalls = 0;
  const reads: WorkspaceDeletionDirectoryReads = { ...nativeReads, async openDirectory() {
    return {
      async read() { entered(); await readPending; return { name: 'retained' }; },
      async close() { closeCalls++; closeEntered(); await closePending; },
    };
  } };
  let settled = false;
  const work = observe(f.path, f.authority, reads).next().finally(() => { settled = true; });
  const outcome = expect(work).rejects.toThrow(kind === 'authority' ? 'SYNTHETIC_LEASE_LOST' : 'SYNTHETIC_SELECTION_CHANGED');
  try {
    await reading;
    if (kind === 'authority') f.expire(); else f.changeSelection();
    expect(closeCalls).toBe(0);
    expect(settled).toBe(false);
    releaseRead();
    await closing;
    expect(closeCalls).toBe(1);
    expect(settled).toBe(false);
  } finally { releaseRead(); releaseClose(); }
  await outcome;
  expect(settled).toBe(true);
});

it.for(['read', 'close', 'both'] as const)('preserves original %s errors without replacing them', async (phase, context) => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_DIRECTORY_READ');
  const last = new Error('SYNTHETIC_DIRECTORY_CLOSE');
  let closed = 0;
  const reads: WorkspaceDeletionDirectoryReads = { ...nativeReads, async openDirectory() {
    return {
      async read() { if (phase !== 'close') throw first; return null; },
      async close() { closed++; if (phase !== 'read') throw last; },
    };
  } };
  const work = collect(observe(f.path, f.authority, reads));
  if (phase === 'both') await expect(work).rejects.toMatchObject({ errors: [first, last] });
  else await expect(work).rejects.toBe(phase === 'read' ? first : last);
  expect(closed).toBe(1);
});

it('preserves a failed open without attempting a second open', async context => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_DIRECTORY_OPEN');
  let opened = 0;
  await expect(collect(observe(f.path, f.authority, { ...nativeReads, async openDirectory() {
    opened++; throw first;
  } }))).rejects.toBe(first);
  expect(opened).toBe(1);
});

it('closes a real handle returned by an open that outlives its authority', async context => {
  const f = await fixture(context);
  let closed = 0;
  const reads: WorkspaceDeletionDirectoryReads = { ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    f.expire();
    return { read: () => directory.read(), async close() { await directory.close(); closed++; } };
  } };
  await expect(collect(observe(f.path, f.authority, reads))).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(closed).toBe(1);
});

it.for([['same', 'same'], ['..'], ['../outside'], ['']] as const)(
  'rejects invalid or repeated native observations %# and closes their source', async (names, context) => {
    const f = await fixture(context);
    const source = syntheticReads(names);
    await expect(collect(observe(f.path, f.authority, source.reads))).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(source.handles.closed).toBe(source.handles.opened);
    expect(source.handles.active).toBe(0);
  });
