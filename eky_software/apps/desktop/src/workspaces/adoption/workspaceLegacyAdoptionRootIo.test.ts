import type { ReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import { TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const hooks = vi.hoisted(() => ({
  stream: undefined as ((stream: ReadStream, path: string) => void) | undefined,
  metadata: undefined as ((path: string) => void) | undefined,
  directory: undefined as ((path: string) => Promise<void>) | undefined,
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream(...args: Parameters<typeof actual.createReadStream>) {
    const stream = actual.createReadStream(...args);
    hooks.stream?.(stream, String(args[0]));
    return stream;
  } };
});

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, async mkdir(...args: Parameters<typeof actual.mkdir>) {
    await hooks.directory?.(String(args[0]));
    return actual.mkdir(...args);
  }, lstat(...args: Parameters<typeof actual.lstat>) {
    hooks.metadata?.(String(args[0]));
    return actual.lstat(...args);
  } };
});

afterEach(() => { hooks.stream = undefined; hooks.metadata = undefined; hooks.directory = undefined; });

describe('adoption root read completion', () => {
  it.for(['existing', 'absent'] as const)('does not recapture a foreign publication parent when it was %s', async (initial, context) => {
    const f = await fixture(context);
    await f.store.prepareCandidate(f.paths, 'legacy');
    if (initial === 'existing') await mkdir(f.paths.workspacesRoot, { mode: 0o700 });
    let replaced = false;
    hooks.directory = async path => {
      if (path !== f.paths.workspacesRoot || replaced) return;
      replaced = true;
      if (initial === 'existing') await rename(path, `${path}.preserved`);
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, 'foreign.txt'), 'foreign evidence');
    };
    await expect(f.store.publishCandidate(f.paths, f.authority)).rejects.toThrow();
    expect(await readFile(join(f.paths.workspacesRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await readFile(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['success', 'error'] as const)('joins the original hash stream close after %s', async (outcome, context) => {
    const f = await fixture(context);
    const closed = gate();
    const release = gate();
    const original = new Error('synthetic read failure');
    let selected = false;
    hooks.stream = stream => {
      if (selected) return;
      selected = true;
      delayClose(stream, closed, release.promise);
      if (outcome === 'error') stream.once('open', () => stream.destroy(original));
    };
    let settled = false;
    const operation = f.store.prepareCandidate(f.paths, 'legacy', f.authority);
    const result = operation.then(() => { settled = true; }, error => { settled = true; throw error; });
    const observed = result.catch(error => error);
    try {
      await closed.promise;
      expect(settled).toBe(false);
      expect(f.onUncertain).not.toHaveBeenCalled();
    } finally { release.resolve(); await observed; }
    if (outcome === 'error') {
      await expect(result).rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_STORAGE_FAILED' });
      expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
    } else await expect(result).resolves.toBeUndefined();
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
  });

  it.for(['success', 'error'] as const)('joins the sibling inventory after the first failure even when its read ends in %s', async (outcome, context) => {
    const f = await fixture(context);
    await f.store.prepareCandidate(f.paths, 'legacy');
    const first = new Error('synthetic first inventory failure');
    const second = new Error('synthetic later read failure');
    const failed = gate();
    const closed = gate();
    const release = gate();
    hooks.metadata = path => {
      if (path === f.source) { failed.resolve(); throw first; }
    };
    hooks.stream = (stream, path) => {
      if (path !== join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite')) return;
      delayClose(stream, closed, release.promise);
      if (outcome === 'error') stream.once('open', () => stream.destroy(second));
    };
    let settled = false;
    const operation = f.store.discardRecoveryCandidateMatchingLegacy(f.paths, f.authority);
    const result = operation.finally(() => { settled = true; });
    const observed = result.catch(error => error);
    try {
      await failed.promise;
      await closed.promise;
      expect(settled).toBe(false);
      expect(f.onUncertain).not.toHaveBeenCalled();
    } finally { release.resolve(); await observed; }
    await expect(result).rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(await readFile(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
  });
});

function delayClose(stream: ReadStream, reached: { resolve(): void }, release: Promise<void>) {
  const emit = stream.emit.bind(stream);
  stream.emit = (event: string | symbol, ...args: unknown[]) => {
    if (event !== 'close') return emit(event, ...args);
    reached.resolve();
    void release.then(() => emit(event, ...args));
    return true;
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-read-completion-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = deriveWorkspaceLegacyAdoptionPaths(root, TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID);
  const source = join(paths.legacyRuntimeRoot, 'data', 'eky.sqlite');
  await mkdir(join(paths.legacyRuntimeRoot, 'data'), { recursive: true, mode: 0o700 });
  await mkdir(join(paths.legacyRuntimeRoot, 'storage', 'invoices'), { recursive: true, mode: 0o700 });
  await writeFile(source, 'synthetic-database', { mode: 0o600 });
  const onUncertain = vi.fn((_error: unknown) => {});
  const authority = { async assertCurrent() {}, assertMutationCurrent() {}, onUncertain };
  return { paths, source, onUncertain, authority, store: new NodeWorkspaceLegacyAdoptionRootStore() };
}
