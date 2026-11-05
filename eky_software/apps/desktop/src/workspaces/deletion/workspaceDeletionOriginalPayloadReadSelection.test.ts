import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { workspaceDeletionOriginalJournalOwners, type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceDeletionOriginalPayloadAbsence as capture } from './workspaceDeletionOriginalPayloadAbsence.js';
import { workspaceInspectionRemnantReads as reads } from './workspaceInspectionRemnantAbsence.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents, deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, lstat: vi.fn(original.lstat) };
});
vi.mock('./workspaceInspectionRemnantAbsence.js', async importOriginal => {
  const original = await importOriginal<typeof import('./workspaceInspectionRemnantAbsence.js')>();
  return { ...original, workspaceInspectionRemnantReads: {
    directoryIdentity: vi.fn(original.workspaceInspectionRemnantReads.directoryIdentity),
    assertAbsent: vi.fn(original.workspaceInspectionRemnantReads.assertAbsent),
  } };
});
const observed = vi.mocked(reads);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(test: TestContext, owner: WorkspaceDeletionOriginalJournalProof['owner'] = 'workspaceActivationMigration', presentParent = false) {
  const f = await remnantBindingFixture(test, owner), pending: Promise<unknown>[] = [], releases: (() => void)[] = [];
  let writersAbsent = true, changed = false;
  const events: string[] = [], selectionFailure = new Error('SYNTHETIC_ORIGINAL_SELECTION_CHANGED');
  const current = () => { test.signal.throwIfAborted(); f.authority.assertAuthority(); };
  const writers = vi.fn(async () => { current(); if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_PRESENT'); });
  const full = vi.fn(async () => {
    events.push('full'); current(); if (changed) throw selectionFailure;
    await f.authority.assertExternalSelection(); current();
  });
  const light = vi.fn(async () => { events.push('read'); current(); await writers(); current(); });
  const authority = { assertAuthority: current, assertExternalSelection: full, assertWritersAbsent: writers };
  test.onTestFinished(async () => {
    f.expire(); for (const release of releases) release(); await Promise.allSettled(pending); vi.restoreAllMocks();
  });
  const payloadRoot = owner === 'workspaceImport' || owner === 'workspaceLegacyAdoption'
    ? deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId).candidateRoot
    : deriveWorkspaceReplacementRemnantRoot(f.root, f.binding.workspaceId, f.binding.operationId, 'activationFailed').rootPath;
  if (presentParent) await mkdir(dirname(payloadRoot), { recursive: true, mode: 0o700 });
  const kept = join(f.root, 'synthetic-foreign-and-external');
  await writeFile(kept, 'foreign and external bytes', { flag: 'wx', mode: 0o600 });
  const track = <T>(work: Promise<T>) => { pending.push(work); return work; };
  const selected = await track(capture(f.root, f.binding, { ...authority, assertReadSelection: light }));
  const reset = () => { full.mockClear(); light.mockClear(); writers.mockClear(); events.length = 0;
    observed.directoryIdentity.mockClear(); observed.assertAbsent.mockClear(); };
  reset();
  return { ...f, authority, selected, payloadRoot, track, releases, reset, full, light, writers, events, selectionFailure,
    changeSelection(value: boolean) { changed = value; }, addWriter() { writersAbsent = false; },
    async preserved() { expect(await readFile(kept, 'utf8')).toBe('foreign and external bytes'); } };
}

it.for(workspaceDeletionOriginalJournalOwners)('keeps the actual %s identity and absence read sequence while reducing full selections', async (owner, test) => {
  const f = await fixture(test, owner), fallback = await f.track(capture(f.root, f.binding, f.authority));
  f.reset(); await f.track(fallback.assertAbsent());
  const fullBefore = f.full.mock.calls.length;
  const identityPaths = observed.directoryIdentity.mock.calls.map(([path]) => path);
  const absentPaths = observed.assertAbsent.mock.calls.map(([path]) => path);
  f.reset(); await f.track(f.selected.assertAbsent());
  expect(observed.directoryIdentity.mock.calls.map(([path]) => path)).toEqual(identityPaths);
  expect(observed.assertAbsent.mock.calls.map(([path]) => path)).toEqual(absentPaths);
  expect(f.full.mock.calls.length).toBeLessThan(fullBefore);
  expect(f.full).toHaveBeenCalledTimes(owner === 'workspaceLegacyAdoption' ? 20 : 2);
  expect(f.events[0]).toBe('full'); expect(f.events.at(-1)).toBe('full');
  expect(f.light).toHaveBeenCalled(); expect(f.writers).toHaveBeenCalled(); await f.preserved();
});

it.for(workspaceDeletionOriginalJournalOwners)('preserves the %s default caller without the optional reader', async (owner, test) => {
  const f = await fixture(test, owner), fallback = await f.track(capture(f.root, f.binding, f.authority));
  f.reset(); await f.track(fallback.assertAbsent());
  expect(f.light).not.toHaveBeenCalled();
  expect(f.full).toHaveBeenCalledTimes(owner === 'workspaceImport' ? 8 : owner === 'workspaceLegacyAdoption' ? 26 : 32);
  expect(observed.assertAbsent).toHaveBeenCalledTimes(owner === 'workspaceImport' || owner === 'workspaceLegacyAdoption' ? 1 : 4);
  await f.preserved();
});

it('rejects a persistent full-selection change and retains it after later revocation', async test => {
  const f = await fixture(test), original = observed.directoryIdentity.getMockImplementation()!;
  let injected = false;
  observed.directoryIdentity.mockImplementation(async (...args) => {
    try { return await original(...args); }
    finally { if (!injected) { injected = true; f.changeSelection(true); } }
  });
  try {
    await expect(f.track(f.selected.assertAbsent())).rejects.toBe(f.selectionFailure);
    f.changeSelection(false); f.expire();
    await expect(f.track(f.selected.assertAbsent())).rejects.toBe(f.selectionFailure);
    expect(injected).toBe(true); await f.preserved();
  } finally { observed.directoryIdentity.mockImplementation(original); }
});

it('characterizes external metadata restored entirely inside the approved read window', async test => {
  const f = await fixture(test), original = observed.directoryIdentity.getMockImplementation()!;
  const parent = deriveWorkspaceReplacementRemnantParents(f.root, f.binding.workspaceId)[0]!;
  const boundary = deriveWorkspaceReplacementRemnantRoot(f.root, f.binding.workspaceId, f.binding.operationId, parent.role).rootPath;
  let injected = false, restored = false;
  observed.directoryIdentity.mockImplementation(async (...args) => {
    if (injected && !restored && args[0] === f.root) { restored = true; f.changeSelection(false); }
    try { return await original(...args); }
    finally { if (!injected && args[0] === boundary) { injected = true; f.changeSelection(true); } }
  });
  try {
    await f.track(f.selected.assertAbsent()); expect(restored).toBe(true); expect(injected).toBe(true); await f.preserved();
  } finally { f.changeSelection(false); observed.directoryIdentity.mockImplementation(original); }
});

it.for(workspaceDeletionOriginalJournalOwners)('preserves returned %s payload bytes', async (owner, test) => {
  const f = await fixture(test, owner);
  await mkdir(f.payloadRoot, { recursive: true, mode: 0o700 });
  const retained = join(f.payloadRoot, 'retained'); await writeFile(retained, 'returned payload', { flag: 'wx', mode: 0o600 });
  await expect(f.track(f.selected.assertAbsent())).rejects.toThrow();
  expect(await readFile(retained, 'utf8')).toBe('returned payload'); await f.preserved();
});

it('does not adopt a formerly missing operation parent', async test => {
  const f = await fixture(test);
  await mkdir(dirname(f.payloadRoot), { recursive: true, mode: 0o700 });
  await expect(f.track(f.selected.assertAbsent())).rejects.toThrow(); await f.preserved();
});

it('rejects same-content parent identity replacement', async test => {
  const f = await fixture(test, 'workspaceImport', true), parent = dirname(f.payloadRoot), retained = parent + '.retained';
  await rename(parent, retained); await mkdir(parent, { mode: 0o700 });
  await expect(f.track(f.selected.assertAbsent())).rejects.toThrow();
  expect(await readdir(retained)).toEqual([]); await f.preserved();
});

it.for(['error', 'undefined'] as const)('retains the first native %s rejection after revocation', async (kind, test) => {
  const f = await fixture(test), original = observed.directoryIdentity.getMockImplementation()!;
  const first = kind === 'error' ? new Error('SYNTHETIC_ORIGINAL_NATIVE_FIRST') : undefined;
  observed.directoryIdentity.mockImplementationOnce(async () => { throw first; });
  try {
    await expect(f.track(f.selected.assertAbsent())).rejects.toBe(first); f.expire();
    await expect(f.track(f.selected.assertAbsent())).rejects.toBe(first); await f.preserved();
  } finally { observed.directoryIdentity.mockImplementation(original); }
});

it('checks writers during the native identity loop', async test => {
  const f = await fixture(test), original = observed.directoryIdentity.getMockImplementation()!;
  observed.directoryIdentity.mockImplementationOnce(async (...args) => {
    const result = await original(...args); f.addWriter(); return result;
  });
  try {
    await expect(f.track(f.selected.assertAbsent())).rejects.toThrow('SYNTHETIC_WRITER_PRESENT'); await f.preserved();
  } finally { observed.directoryIdentity.mockImplementation(original); }
});

it.for(['success', 'nativeFailure'] as const)('joins a started native lstat response %s after revocation', async (kind, test) => {
  const f = await fixture(test), mocked = vi.mocked(lstat), original = mocked.getMockImplementation()!;
  const entered = deferred(), nativeSettled = deferred(), release = deferred(); f.releases.push(release.resolve);
  let nativeStarted = false, responseSettled = false, wrapperSettled = false, first: unknown;
  mocked.mockImplementationOnce(((...args: Parameters<typeof lstat>) => {
    nativeStarted = true;
    const actual = kind === 'success' ? original(...args) : original(join(f.root, 'missing-native-read'), { bigint: true });
    entered.resolve();
    return (async () => {
      let value: unknown, failed = false;
      try { value = await actual; } catch (error) { failed = true; first = error; }
      finally { responseSettled = true; nativeSettled.resolve(); }
      await release.promise;
      if (failed) throw first;
      return value;
    })();
  }) as typeof lstat);
  const work = f.track(f.selected.assertAbsent());
  const outcome = work.then(() => { wrapperSettled = true; return { ok: true as const }; },
    error => { wrapperSettled = true; return { ok: false as const, error }; });
  try {
    await entered.promise; expect(nativeStarted).toBe(true); expect(wrapperSettled).toBe(false);
    await nativeSettled.promise; expect(responseSettled).toBe(true); expect(wrapperSettled).toBe(false);
    f.expire(); release.resolve();
    const result = await outcome; expect(wrapperSettled).toBe(true); expect(result.ok).toBe(false);
    if (!result.ok) {
      if (kind === 'nativeFailure') expect(result.error).toBe(first);
      else expect((result.error as Error).message).toBe('SYNTHETIC_LEASE_LOST');
    }
    await f.preserved();
  } finally { release.resolve(); await outcome; mocked.mockImplementation(original); }
});

it('expires a completed callback even during a later read', async test => {
  const f = await fixture(test), original = observed.directoryIdentity.getMockImplementation()!;
  let callback: (() => void) | undefined;
  observed.directoryIdentity.mockImplementation(async (...args) => { callback ??= args[1]; return original(...args); });
  try {
    await f.track(f.selected.assertAbsent()); expect(callback).toBeTypeOf('function');
    expect(callback!).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    observed.directoryIdentity.mockImplementation(async (...args) => {
      expect(callback!).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); return original(...args);
    });
    await f.track(f.selected.assertAbsent()); await f.preserved();
  } finally { observed.directoryIdentity.mockImplementation(original); }
});

it('rejects a reentrant read while the original response is held', async test => {
  const f = await fixture(test), original = observed.directoryIdentity.getMockImplementation()!;
  const entered = deferred(), release = deferred(); f.releases.push(release.resolve);
  observed.directoryIdentity.mockImplementationOnce(async (...args) => {
    const response = await original(...args); entered.resolve(); await release.promise; return response;
  });
  const work = f.track(f.selected.assertAbsent()); void work.catch(() => undefined);
  try {
    await entered.promise;
    await expect(f.track(f.selected.assertAbsent())).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    release.resolve(); await work; await f.preserved();
  } finally { release.resolve(); await work.catch(() => undefined); observed.directoryIdentity.mockImplementation(original); }
});

it.for([null, true, '', {}])('rejects malformed read port %j before I/O', async (value, test) => {
  const f = await fixture(test); observed.directoryIdentity.mockClear();
  await expect(f.track(capture(f.root, f.binding, { ...f.authority, assertReadSelection: value } as never))).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(observed.directoryIdentity).not.toHaveBeenCalled(); await f.preserved();
});

it('rejects a nonvoid read port without changing filesystem bytes', async test => {
  const f = await fixture(test), before = await readdir(f.root);
  await expect(f.track(capture(f.root, f.binding, { ...f.authority,
    async assertReadSelection() { return true; } } as never))).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readdir(f.root)).toEqual(before); await f.preserved();
});

it('captures and binds the optional port once before awaits', async test => {
  const f = await fixture(test);
  const getter = vi.fn(() => original), original = vi.fn(async function(this: unknown) {
    expect(this).toBe(receiver); await f.authority.assertWritersAbsent();
  });
  const receiver = { ...f.authority, get assertReadSelection() { return getter(); } };
  const selected = await f.track(capture(f.root, f.binding, receiver));
  Object.defineProperty(receiver, 'assertReadSelection', { value: async () => { throw new Error('MUTATED_CALLBACK'); } });
  await f.track(selected.assertAbsent()); expect(getter).toHaveBeenCalledTimes(1); expect(original).toHaveBeenCalled(); await f.preserved();
});
