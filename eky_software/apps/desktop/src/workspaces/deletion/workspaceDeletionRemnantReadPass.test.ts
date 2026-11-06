import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deferred } from '../../profileBackup/portableDeletionBackupTestSupport.js';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId as id, deletionTestHeader } from './workspaceDeletionDataTestSupport.js';
import { observeWorkspaceDeletionRemnants as observe, workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { captureWorkspaceDeletionRemnantCensus as capture, prepareWorkspaceDeletionRemnantBindings as prepare } from './workspaceDeletionRemnantCensusSelection.js';
import * as cleanup from './workspaceDeletionBindingCleanup.js';
import * as enumeration from './workspaceRemnantBindingEnumeration.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

it('checks the original registry at both pass boundaries without per-file registry rereads', async test => {
  const f = await fixture(test);
  const rows = await f.collect();
  expect(rows.some(row => row.kind === 'metadataCandidate')).toBe(true);
  expect(f.authority.assertExternalSelection).toHaveBeenCalledTimes(4);
  expect(f.authority.assertWritersAbsent.mock.calls.length).toBeGreaterThan(4);
  expect(f.closed()).toBe(f.opened());
  await f.preserved();
});

it.for(['bytes', 'identity', 'nextSlot'] as const)('rejects %s changes after observations before successful EOF', async (change, test) => {
  const f = await fixture(test), source = f.source();
  await reachLegacy(source);
  if (change === 'bytes') await writeFile(f.registryPath, Buffer.concat([Buffer.from(' '), f.registryBytes]));
  if (change === 'identity') {
    await rename(f.registryPath, join(f.root, 'retained-registry'));
    await writeFile(f.registryPath, f.registryBytes, { flag: 'wx' });
  }
  if (change === 'nextSlot') await f.changeRegistry();
  const changed = await readFile(f.registryPath);
  await expect(source.next()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  expect(await readFile(f.registryPath)).toEqual(changed);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(f.closed()).toBe(f.opened());
});

it.for(['return', 'eof'] as const)('invalidates escaped observation assertions on %s without reviving them in a new pass', async (end, test) => {
  const f = await fixture(test), source = f.source();
  let escaped: (() => Promise<void>) | undefined;
  while (true) {
    const next = await source.next();
    if (next.done) throw new Error('MISSING_CANDIDATE');
    if (next.value.kind === 'metadataCandidate') { escaped = next.value.selection.assertSelected; break; }
  }
  if (end === 'return') {
    await source.return(undefined);
    expect(f.authority.assertExternalSelection).toHaveBeenCalledTimes(2);
  } else { for await (const _row of source) { /* Consume the complete source. */ } }
  await expect(escaped!()).rejects.toThrow();
  const nextPass = f.source();
  expect((await nextPass.next()).done).toBe(false);
  await expect(escaped!()).rejects.toThrow();
  await nextPass.return(undefined);
  expect(f.closed()).toBe(f.opened());
  await f.preserved();
});

it.for(['authority', 'writers', 'registry'] as const)('joins a held native read and all handles on %s loss', async (loss, test) => {
  const f = await fixture(test), gate = deferred(), entered = deferred();
  let held = false, settled = false;
  const reads = { ...f.reads, async openDirectory(path: string) {
    const directory = await f.reads.openDirectory(path);
    return { ...directory, async read() {
      if (!held) { held = true; entered.resolve(); await gate.promise; }
      return directory.read();
    } };
  } };
  const work = f.collect(reads).finally(() => { settled = true; });
  const expected = expect(work).rejects.toThrow();
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('READ_NOT_HELD'); })]);
    if (loss === 'authority') f.revoke();
    if (loss === 'writers') f.writerAppeared();
    if (loss === 'registry') await f.changeRegistry();
    expect(settled).toBe(false);
  } finally { gate.resolve(); await expected; }
  expect(f.closed()).toBe(f.opened());
  expect(f.closed()).toBeGreaterThan(0);
  await f.preserved();
});

it.for(['return', 'throw', 'readFailure'] as const)('revokes escaped assertions before held iterator %s and preserves close errors', async (end, test) => {
  const f = await fixture(test), gate = deferred(), entered = deferred();
  f.releaseOnFinish(gate.resolve);
  let holdClose = false;
  const first = new Error('SYNTHETIC_CONSUMER_FAILURE'), close = new Error('SYNTHETIC_ITERATOR_CLOSE_FAILURE');
  const original = enumeration.observeWorkspaceRemnantBindingDirectory;
  vi.spyOn(enumeration, 'observeWorkspaceRemnantBindingDirectory').mockImplementation(async function* (...args) {
    try {
      if (end === 'readFailure' && args[1] === 'workspaceImport') throw first;
      yield* original(...args);
    }
    finally { if (args[1] === 'workspaceImport' && holdClose) { entered.resolve(); await gate.promise; throw close; } }
  });
  const source = f.source();
  if (end === 'readFailure') {
    await expect(f.track((async () => { for await (const _row of source) { /* Read until the controlled failure. */ } })()))
      .rejects.toBe(first);
    expect(f.closed()).toBe(f.opened());
    await f.preserved();
    return;
  }
  let escaped: (() => Promise<void>) | undefined;
  while (true) {
    const next = await source.next();
    if (next.done) throw new Error('MISSING_CANDIDATE');
    if (next.value.kind === 'metadataCandidate') { escaped = next.value.selection.assertSelected; break; }
  }
  holdClose = true;
  let settled = false;
  const work = f.track((end === 'return' ? source.return(undefined) : source.throw(first))
    .finally(() => { settled = true; }));
  const outcome = work.then(value => ({ value }), error => ({ error }));
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('CLOSE_NOT_HELD'); })]);
    expect(settled).toBe(false);
    await expect(escaped!()).rejects.toThrow();
  } finally { gate.resolve(); await outcome; }
  if (end === 'return') expect(await outcome).toEqual({ error: close });
  else expect(await outcome).toMatchObject({ error: { errors: [first, close] } });
  expect(f.closed()).toBe(f.opened());
  await f.preserved();
});

it('checks registry changes made during the original directory close before accepting the pass', async test => {
  const f = await fixture(test);
  let changed = false;
  const work = f.collect({ ...f.reads, async openDirectory(path) {
    const directory = await f.reads.openDirectory(path);
    return { ...directory, async close() {
      await directory.close();
      if (!changed) { changed = true; await f.changeRegistry(); }
    } };
  } });
  await expect(work).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  expect(changed).toBe(true); expect(f.closed()).toBe(f.opened());
  await f.preserved();
});

it('keeps a failed census invalid after the registry side slot disappears', async test => {
  const f = await fixture(test);
  const selected = await f.track(capture(f.root, f.authority, f.reads, undefined, TEST_TARGET_WORKSPACE_ID));
  await f.changeRegistry();
  await expect(f.track(selected.assertUnchanged())).rejects.toThrow();
  await rm(`${f.registryPath}.next`);
  const before = f.authority.assertExternalSelection.mock.calls.length;
  await expect(f.track(selected.assertUnchanged())).rejects.toThrow();
  expect(f.authority.assertExternalSelection.mock.calls.length).toBe(before);
  await f.preserved();
});

it.for(['registry', 'writers'] as const)('passes the full original authority to metadata cleanup after %s changes', async (change, test) => {
  const f = await fixture(test), original = cleanup.clearAbsentWorkspaceDeletionBinding;
  let originalAuthority = false;
  const clear = vi.spyOn(cleanup, 'clearAbsentWorkspaceDeletionBinding').mockImplementation(async (...args) => {
    originalAuthority = args[3] === f.authority;
    if (change === 'registry') await f.changeRegistry(); else f.writerAppeared();
    return original(...args);
  });
  await expect(f.track(prepare(f.root, f.header, f.authority, f.reads))).rejects.toThrow();
  expect(clear).toHaveBeenCalledOnce(); expect(originalAuthority).toBe(true);
  await f.preserved();
});

it('preserves both the original read failure and a close failure after closing the real handle', async test => {
  const f = await fixture(test), first = new Error('SYNTHETIC_READ_FAILURE'), close = new Error('SYNTHETIC_CLOSE_FAILURE');
  const work = f.collect({ ...f.reads, async openDirectory(path) {
    const directory = await f.reads.openDirectory(path);
    return { async read() { throw first; }, async close() { await directory.close(); throw close; } };
  } });
  await expect(work).rejects.toMatchObject({ errors: [first, close] });
  expect(f.closed()).toBe(f.opened());
  await f.preserved();
});

async function reachLegacy(source: ReturnType<typeof observe>) {
  while (true) {
    const next = await source.next();
    if (next.done) throw new Error('MISSING_LEGACY');
    if (next.value.kind === 'legacySource') return;
  }
}

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-w74-readonly-pass-'));
  const pending: Promise<unknown>[] = [], sources: ReturnType<typeof observe>[] = [];
  const releases: (() => void)[] = [];
  let owned = true, writersAbsent = true, opened = 0, closed = 0;
  const guard = () => { test.signal.throwIfAborted(); if (!owned) throw new Error('SYNTHETIC_LEASE_LOST'); };
  test.onTestFinished(async () => {
    owned = false;
    for (const release of releases) release();
    await Promise.allSettled(pending);
    const cleanupErrors: unknown[] = [];
    for (const source of sources) {
      try { await source.return(undefined); }
      catch (error) { cleanupErrors.push(error); }
    }
    vi.restoreAllMocks();
    if (opened !== closed) cleanupErrors.push(new Error('SYNTHETIC_HANDLES_UNSETTLED'));
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'SYNTHETIC_FIXTURE_CLEANUP_FAILED');
    if (test.task.result?.state === 'pass' && opened === closed) await rm(root, { recursive: true, force: true });
  });
  const initial = { ...createSwitchRegistry(), formatVersion: 2 as const };
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  await registry.write(initial);
  const sentinels: string[] = [];
  for (const entry of initial.workspaces) {
    const directory = deriveWorkspaceRoot(root, entry.workspaceId, 1).workspaceRoot;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'retained'); await writeFile(path, 'retained', { flag: 'wx' }); sentinels.push(path);
  }
  const selected = await captureDeletionTarget({ installationRoot: root, workspaceId: TEST_TARGET_WORKSPACE_ID,
    typedLabel: initial.workspaces[1]!.workspaceLabel, registry, assertAuthority: guard });
  const authority = { assertAuthority: guard, assertExternalSelection: vi.fn(selected.assertCurrent),
    assertWritersAbsent: vi.fn(async () => { guard(); if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); }) };
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport', operationId: id(50),
    workspaceId: TEST_TARGET_WORKSPACE_ID, lineageIdentity: initial.workspaces[1]!.lineageIdentity });
  const key = workspaceRemnantBindingKey(binding), bindingPath = createWorkspaceRemnantBindingPaths(root, key).currentPath;
  await new WorkspaceRemnantBindingStore(root, key).publish(binding, authority);
  const bindingBytes = await readFile(bindingPath), registryBytes = await readFile(registryPath);
  authority.assertExternalSelection.mockClear(); authority.assertWritersAbsent.mockClear();
  const reads = { ...nativeReads, async openDirectory(path: string) {
    const directory = await nativeReads.openDirectory(path); opened++;
    return { read: () => directory.read(), async close() { await directory.close(); closed++; } };
  } };
  const source = (input = reads) => { const result = observe(root, authority, input, TEST_TARGET_WORKSPACE_ID); sources.push(result); return result; };
  const track = <T>(work: Promise<T>) => { pending.push(work); void work.catch(() => undefined); return work; };
  return { root, authority, reads, registryPath, registryBytes, bindingPath, bindingBytes, source, track,
    releaseOnFinish(release: () => void) { releases.push(release); },
    header: { ...deletionTestHeader, workspaceId: TEST_TARGET_WORKSPACE_ID, lineageIdentity: binding.lineageIdentity },
    opened: () => opened, closed: () => closed,
    revoke() { owned = false; }, writerAppeared() { writersAbsent = false; },
    changeRegistry: () => writeFile(`${registryPath}.next`, registryBytes, { flag: 'wx' }),
    collect(input = reads) { return track((async () => { const rows = []; for await (const row of source(input)) rows.push(row); return rows; })()); },
    async preserved() {
      expect(await readFile(bindingPath)).toEqual(bindingBytes);
      expect(await readFile(registryPath)).toEqual(registryBytes);
      for (const path of sentinels) expect(await readFile(path, 'utf8')).toBe('retained');
    },
  };
}
