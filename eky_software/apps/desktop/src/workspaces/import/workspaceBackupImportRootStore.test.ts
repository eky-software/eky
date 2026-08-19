import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';
import {
  TEST_IMPORT_OPERATION_ID,
  TEST_IMPORT_WORKSPACE_ID,
} from './workspaceBackupImportTestSupport.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace backup import root store', () => {
  it('creates, validates and atomically publishes the exact imported workspace layout', async () => {
    const { paths, store } = await createFixture();
    const databaseBytes = Buffer.from('synthetic-imported-sqlite');

    await store.createCandidate(paths);
    await mkdir(paths.importStagingRoot, { mode: 0o700 });
    await writeFile(paths.databaseFilePath, databaseBytes, { flag: 'wx' });
    await store.removeImportStaging(paths);
    await store.inspectCandidate(paths);
    await store.publishCandidate(paths);

    await expect(lstat(paths.candidateRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(paths.publishedDatabaseFilePath)).resolves.toEqual(
      databaseBytes,
    );
    await expect(store.inspectPublished(paths)).resolves.toBeUndefined();
    await expect(
      store.cleanupPublishedOperation(paths),
    ).resolves.toBeUndefined();
    await expect(lstat(paths.operationRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects publication when the final workspace root already exists', async () => {
    const { paths, store } = await createFixture();
    await mkdir(paths.workspacesRoot, { mode: 0o700 });
    await mkdir(paths.finalRoot, { mode: 0o700 });

    await expect(store.createCandidate(paths)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_CONFLICT',
      stage: 'candidateRoot',
    });
  });

  it('requires staging to be removed before candidate publication', async () => {
    const { paths, store } = await createFixture();
    await store.createCandidate(paths);
    await mkdir(paths.importStagingRoot, { mode: 0o700 });
    await writeFile(paths.databaseFilePath, 'database');

    await expect(store.inspectCandidate(paths)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
  });

  it('rejects unexpected workspace files and refuses unsafe cleanup', async () => {
    const { paths, store } = await createFixture();
    await store.createCandidate(paths);
    await writeFile(paths.databaseFilePath, 'database');
    await writeFile(join(paths.candidateRoot, 'unexpected.txt'), 'blocked');

    await expect(store.inspectCandidate(paths)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
    await expect(store.discardCandidate(paths)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_STORAGE_FAILED',
      stage: 'cleanup',
    });
  });

  it('rejects a database file with another hard link', async () => {
    const { paths, root, store } = await createFixture();
    await store.createCandidate(paths);
    await writeFile(paths.databaseFilePath, 'database');
    await link(paths.databaseFilePath, join(root, 'linked.sqlite'));

    await expect(store.inspectCandidate(paths)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
  });

  it('rejects a pre-existing reparse or symlink operation root', async () => {
    const { paths, root, store } = await createFixture();
    await mkdir(paths.operationsRoot, { mode: 0o700 });
    const outside = join(root, 'outside');
    await mkdir(outside, { mode: 0o700 });
    await symlink(
      outside,
      paths.operationRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(store.createCandidate(paths)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_STORAGE_FAILED',
      stage: 'candidateRoot',
    });
  });

  it('removes only the known private candidate tree before publication', async () => {
    const { paths, store } = await createFixture();
    await store.createCandidate(paths);
    await writeFile(paths.databaseFilePath, 'database');

    await expect(store.discardCandidate(paths)).resolves.toBeUndefined();
    await expect(lstat(paths.operationRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-import-root-'));
  cleanupRoots.push(root);
  return {
    root,
    paths: deriveWorkspaceBackupImportPaths(
      root,
      TEST_IMPORT_OPERATION_ID,
      TEST_IMPORT_WORKSPACE_ID,
    ),
    store: new NodeWorkspaceBackupImportRootStore(),
  };
}
