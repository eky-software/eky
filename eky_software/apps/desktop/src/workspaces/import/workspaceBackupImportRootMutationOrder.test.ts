import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';
import { TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID } from './workspaceBackupImportTestSupport.js';

const boundary = vi.hoisted(() => ({ enabled: false, current: true, observations: [] as [string, boolean][] }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const observe = (operation: string) => { if (boundary.enabled) boundary.observations.push([operation, boundary.current]); };
  return { ...fs,
    mkdir: (...args: Parameters<typeof fs.mkdir>) => { observe('mkdir'); return fs.mkdir(...args); },
    rename: (...args: Parameters<typeof fs.rename>) => { observe('rename'); return fs.rename(...args); },
    rm: (...args: Parameters<typeof fs.rm>) => { observe('rm'); return fs.rm(...args); },
    rmdir: (...args: Parameters<typeof fs.rmdir>) => { observe('rmdir'); return fs.rmdir(...args); },
  };
});

it.for(['create', 'publish', 'staging', 'discard', 'cleanup'] as const)(
  'starts %s mutation before an authority-loss microtask can run', async (action, context) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-import-mutation-order-'));
    context.onTestFinished(async () => {
      boundary.enabled = false;
      if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
    });
    const paths = deriveWorkspaceBackupImportPaths(root, TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID);
    const store = new NodeWorkspaceBackupImportRootStore();
    if (action !== 'create') {
      await store.createCandidate(paths);
      await writeFile(paths.databaseFilePath, 'synthetic database', { flag: 'wx' });
      if (action === 'staging') await mkdir(paths.importStagingRoot, { mode: 0o700 });
      if (action === 'cleanup') await store.publishCandidate(paths);
    }
    boundary.current = true;
    boundary.observations = [];
    boundary.enabled = true;
    let checks = 0;
    const targetCheck = action === 'publish' ? process.platform === 'win32' ? 2 : 3 : 1;
    const authority = {
      async assertCurrent() { if (!boundary.current) throw new Error('SYNTHETIC_OWNER_EXPIRED'); },
      assertMutationCurrent() {
        if (!boundary.current) throw new Error('SYNTHETIC_OWNER_EXPIRED');
        if (++checks === targetCheck) queueMicrotask(() => { boundary.current = false; });
      },
    };
    const result = action === 'create' ? store.createCandidate(paths, authority)
      : action === 'publish' ? store.publishCandidate(paths, authority)
      : action === 'staging' ? store.removeImportStaging(paths, authority)
      : action === 'discard' ? store.discardCandidate(paths, authority)
      : store.cleanupPublishedOperation(paths, authority);
    await expect(result).rejects.toMatchObject({ cause: { message: 'SYNTHETIC_OWNER_EXPIRED' } });
    boundary.enabled = false;
    const operation = action === 'create' ? 'mkdir' : action === 'publish' ? 'rename' : action === 'cleanup' ? 'rmdir' : 'rm';
    expect(boundary.observations.filter(([kind]) => kind === operation)).toEqual([[operation, true]]);
    expect(boundary.observations.every(([, current]) => current)).toBe(true);
  });
