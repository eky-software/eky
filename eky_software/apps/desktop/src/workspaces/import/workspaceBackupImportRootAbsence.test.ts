import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';
import { importBindingGate as gate } from './workspaceBackupImportBindingTestSupport.js';
import { TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID } from './workspaceBackupImportTestSupport.js';

const boundary = vi.hoisted(() => ({ afterRead: undefined as undefined | ((path: string, missing: boolean) => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, lstat: async (...args: Parameters<typeof fs.lstat>) => {
    let value;
    try { value = await fs.lstat(...args); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') await boundary.afterRead?.(String(args[0]), true);
      throw error;
    }
    await boundary.afterRead?.(String(args[0]), false);
    return value;
  } };
});

async function fixture(context: TestContext) {
  boundary.afterRead = undefined;
  const root = await mkdtemp(join(tmpdir(), 'eky-import-absence-'));
  const extraRoots: string[] = [];
  context.onTestFinished(async () => {
    boundary.afterRead = undefined;
    if (context.task.result?.state === 'pass') for (const path of [root, ...extraRoots]) await rm(path, { recursive: true, force: true });
  });
  const paths = deriveWorkspaceBackupImportPaths(root, TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID);
  const store = new NodeWorkspaceBackupImportRootStore();
  const state = { current: true };
  const assertCurrent = () => { if (!state.current) throw new Error('SYNTHETIC_IMPORT_OWNER_EXPIRED'); };
  return { root, paths, store, state, assertCurrent, extraRoots };
}

it.for([false, true])('proves absence without creating an operations parent, parentExists=%s', async (exists, context) => {
  const f = await fixture(context);
  if (exists) await mkdir(f.paths.operationsRoot, { mode: 0o700 });
  await f.store.assertOperationAbsent(f.paths, f.assertCurrent);
  if (!exists) await expect(lstat(f.paths.operationsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.for(['discarded', 'published'] as const)('proves whole-root absence after %s cleanup and preserves the accepted workspace', async (mode, context) => {
  const f = await fixture(context);
  await f.store.createCandidate(f.paths);
  await writeFile(f.paths.databaseFilePath, 'synthetic database', { flag: 'wx' });
  if (mode === 'published') {
    await f.store.publishCandidate(f.paths);
    await f.store.cleanupPublishedOperation(f.paths);
  } else await f.store.discardCandidate(f.paths);
  await f.store.assertOperationAbsent(f.paths, f.assertCurrent);
  if (mode === 'published') expect(await readFile(f.paths.publishedDatabaseFilePath, 'utf8')).toBe('synthetic database');
});

it('rejects inspection-only remnants even when candidate and final presence are both false', async context => {
  const f = await fixture(context);
  const inspection = join(f.paths.operationRoot, 'retained-inspection');
  await mkdir(inspection, { recursive: true, mode: 0o700 });
  const evidence = join(inspection, 'evidence'); await writeFile(evidence, 'retained synthetic bytes');
  expect(await f.store.readPresence(f.paths)).toEqual({ candidateExists: false, finalExists: false });
  await expect(f.store.assertOperationAbsent(f.paths, f.assertCurrent)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' });
  expect(await readFile(evidence, 'utf8')).toBe('retained synthetic bytes');
});

it.for(['operation', 'parent'] as const)('rejects a %s junction or symlink without touching its target', async (kind, context) => {
  const f = await fixture(context);
  const outside = join(f.root, 'outside'); await mkdir(outside, { mode: 0o700 });
  await writeFile(join(outside, 'evidence'), 'not owned by this operation');
  if (kind === 'operation') await mkdir(f.paths.operationsRoot, { mode: 0o700 });
  await symlink(outside, kind === 'operation' ? f.paths.operationRoot : f.paths.operationsRoot,
    process.platform === 'win32' ? 'junction' : 'dir');
  await expect(f.store.assertOperationAbsent(f.paths, f.assertCurrent)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  expect(await readFile(join(outside, 'evidence'), 'utf8')).toBe('not owned by this operation');
});

it.for(['operation', 'parent', 'root'] as const)('rejects %s replacement after the first absence observation', async (kind, context) => {
  const f = await fixture(context); await mkdir(f.paths.operationsRoot, { mode: 0o700 });
  let injected = false;
  boundary.afterRead = async (path, missing) => {
    if (injected || !missing || path !== f.paths.operationRoot) return;
    injected = true;
    if (kind === 'operation') { await mkdir(f.paths.operationRoot, { mode: 0o700 }); return; }
    if (kind === 'parent') {
      await rename(f.paths.operationsRoot, join(f.root, 'retained-parent'));
      await mkdir(f.paths.operationsRoot, { mode: 0o700 }); return;
    }
    const original = `${f.root}-retained`; f.extraRoots.push(original);
    await rename(f.root, original);
    await mkdir(f.root, { mode: 0o700 }); await mkdir(f.paths.operationsRoot, { mode: 0o700 });
  };
  await expect(f.store.assertOperationAbsent(f.paths, f.assertCurrent)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  expect(injected).toBe(true);
  boundary.afterRead = undefined;
  if (kind === 'operation') expect((await lstat(f.paths.operationRoot)).isDirectory()).toBe(true);
  if (kind === 'parent') expect((await lstat(join(f.root, 'retained-parent'))).isDirectory()).toBe(true);
  if (kind === 'root') expect((await lstat(f.extraRoots[0]!)).isDirectory()).toBe(true);
});

it('rejects an operations parent appearing after its absence observation', async context => {
  const f = await fixture(context); let injected = false;
  boundary.afterRead = async (path, missing) => {
    if (injected || !missing || path !== f.paths.operationsRoot) return;
    injected = true; await mkdir(f.paths.operationsRoot, { mode: 0o700 });
  };
  await expect(f.store.assertOperationAbsent(f.paths, f.assertCurrent)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  boundary.afterRead = undefined;
  expect((await lstat(f.paths.operationsRoot)).isDirectory()).toBe(true);
});

it('joins a started directory read and rejects authority lost before it settles', async context => {
  const f = await fixture(context); const entered = gate(); const finish = gate();
  let held = false; let settled = false;
  boundary.afterRead = async path => { if (path === f.root && !held) { held = true; entered.resolve(); await finish.promise; } };
  const pending = f.store.assertOperationAbsent(f.paths, f.assertCurrent)
    .then(() => undefined, error => error as unknown).finally(() => { settled = true; });
  let result: unknown;
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error('READ_NOT_ENTERED'); })]);
    f.state.current = false; expect(settled).toBe(false);
  } finally { finish.resolve(); result = await pending; }
  expect(result).toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED', cause: { message: 'SYNTHETIC_IMPORT_OWNER_EXPIRED' } });
  expect(settled).toBe(true);
});

it('captures root paths before the first await instead of following replacement caller paths', async context => {
  const f = await fixture(context); await f.store.createCandidate(f.paths);
  const paths = { ...f.paths }; let changed = false;
  boundary.afterRead = async path => {
    if (path === f.root && !changed) { changed = true; paths.operationRoot = join(f.paths.operationsRoot, 'another-operation'); }
  };
  await expect(f.store.assertOperationAbsent(paths, f.assertCurrent)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  boundary.afterRead = undefined;
  expect((await lstat(f.paths.operationRoot)).isDirectory()).toBe(true);
});

it('rejects an asynchronous authority callback before filesystem I/O', async context => {
  const f = await fixture(context); const reads = vi.fn(); boundary.afterRead = reads;
  await expect(f.store.assertOperationAbsent(f.paths, async () => {})).rejects.toThrow();
  expect(reads).not.toHaveBeenCalled();
});
