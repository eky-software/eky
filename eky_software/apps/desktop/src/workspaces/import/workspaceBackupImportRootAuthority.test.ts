import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore, type WorkspaceImportMutationAuthority } from './workspaceBackupImportRootStore.js';
import { importBindingGate as gate } from './workspaceBackupImportBindingTestSupport.js';
import { TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID } from './workspaceBackupImportTestSupport.js';

const actions = ['create', 'publish', 'staging', 'discard', 'cleanup'] as const;

describe('workspace import root mutation authority', () => {
  it.for(actions)('keeps the normal guarded %s operation', async (action, context) => {
    const f = await fixture(context, action);
    await f.run(f.authority);
    expect(f.readCurrent).toHaveBeenCalled();
    expect(f.mutate).toHaveBeenCalled();
    if (action === 'publish') expect(await readFile(f.paths.publishedDatabaseFilePath, 'utf8')).toBe('synthetic database');
    if (action === 'create') expect((await lstat(f.paths.artifactRoot)).isDirectory()).toBe(true);
    if (action === 'staging') expect(await readFile(f.paths.databaseFilePath, 'utf8')).toBe('synthetic database');
  });

  it.for(actions)('rejects expired synchronous authority after awaited %s checks', async (action, context) => {
    const f = await fixture(context, action);
    const entered = gate(); const finish = gate();
    let reads = 0;
    f.readCurrent.mockImplementation(async () => {
      if (++reads === 2) { entered.resolve(); await finish.promise; }
    });
    const pending = f.run(f.authority).then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('MUTATION_GUARD_NOT_ENTERED'); })]);
      f.state.current = false;
    } finally { finish.resolve(); result = await pending; }
    expect(result).toMatchObject({ code: 'WORKSPACE_IMPORT_STORAGE_FAILED', cause: { message: 'SYNTHETIC_AUTHORITY_EXPIRED' } });
    await f.assertRetained();
  });

  it.for(actions)('captures both %s authority callbacks before asynchronous work', async (action, context) => {
    const f = await fixture(context, action);
    const entered = gate(); const finish = gate();
    f.readCurrent.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
    const pending = f.run(f.authority).then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('INITIAL_GUARD_NOT_ENTERED'); })]);
      f.authority.assertCurrent = async () => {};
      f.authority.assertMutationCurrent = () => {};
      f.state.current = false;
    } finally { finish.resolve(); result = await pending; }
    expect(result).toBeInstanceOf(Error);
    await f.assertRetained();
  });

  it.for(actions)('rejects an asynchronous last %s assertion instead of mutating files', async (action, context) => {
    const f = await fixture(context, action);
    await expect(f.run({ assertCurrent: f.readCurrent, assertMutationCurrent: async () => {} })).rejects.toThrow();
    await f.assertRetained();
  });

  it('checks every candidate directory creation and stops at the first lost authority', async context => {
    const f = await fixture(context, 'create');
    let checks = 0;
    const error = new Error('SYNTHETIC_THIRD_MUTATION');
    f.mutate.mockImplementation(() => { if (++checks === 3) throw error; });
    await expect(f.run(f.authority)).rejects.toMatchObject({ cause: error });
    expect(checks).toBe(3);
    if (process.platform === 'win32') {
      expect((await lstat(f.paths.operationRoot)).isDirectory()).toBe(true);
      await expect(lstat(f.paths.candidateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(lstat(f.paths.finalRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function fixture(context: TestContext, action: (typeof actions)[number]) {
  const root = await mkdtemp(join(tmpdir(), 'eky-import-root-authority-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = deriveWorkspaceBackupImportPaths(root, TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID);
  const store = new NodeWorkspaceBackupImportRootStore();
  if (action !== 'create') {
    await store.createCandidate(paths);
    await writeFile(paths.databaseFilePath, 'synthetic database', { flag: 'wx' });
    if (action === 'staging') {
      await mkdir(paths.importStagingRoot, { mode: 0o700 });
      await writeFile(join(paths.importStagingRoot, 'profile.sqlite'), 'synthetic staging', { flag: 'wx' });
    }
    if (action === 'cleanup') await store.publishCandidate(paths);
  }
  const state = { current: true };
  const readCurrent = vi.fn(async () => {});
  const mutate = vi.fn(() => { if (!state.current) throw new Error('SYNTHETIC_AUTHORITY_EXPIRED'); });
  const authority: WorkspaceImportMutationAuthority = { assertCurrent: readCurrent, assertMutationCurrent: mutate };
  function run(supplied: WorkspaceImportMutationAuthority) {
    if (action === 'create') return store.createCandidate(paths, supplied);
    if (action === 'publish') return store.publishCandidate(paths, supplied);
    if (action === 'staging') return store.removeImportStaging(paths, supplied);
    if (action === 'discard') return store.discardCandidate(paths, supplied);
    return store.cleanupPublishedOperation(paths, supplied);
  }
  async function assertRetained() {
    if (action === 'create') {
      await expect(lstat(paths.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } else if (action === 'cleanup') {
      expect((await lstat(paths.operationRoot)).isDirectory()).toBe(true);
      expect(await readFile(paths.publishedDatabaseFilePath, 'utf8')).toBe('synthetic database');
    } else {
      expect(await readFile(paths.databaseFilePath, 'utf8')).toBe('synthetic database');
      await expect(lstat(paths.finalRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      if (action === 'staging') expect(await readFile(join(paths.importStagingRoot, 'profile.sqlite'), 'utf8')).toBe('synthetic staging');
    }
  }
  return { root, paths, store, state, readCurrent, mutate, authority, run, assertRetained };
}
