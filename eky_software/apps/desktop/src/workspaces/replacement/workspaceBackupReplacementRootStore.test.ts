import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveWorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from './workspaceBackupReplacementRootStore.js';
import {
  TEST_REPLACEMENT_OPERATION_ID,
  TEST_REPLACEMENT_WORKSPACE_ID,
} from './workspaceBackupReplacementTestSupport.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace backup replacement root store', () => {
  it('prepares and validates only the private candidate slots', async () => {
    const fixture = await createFixture();

    await fixture.store.prepareCandidate(fixture.paths);
    await mkdir(fixture.paths.importStagingRoot, {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');
    const candidatePdf = join(
      fixture.paths.candidateArtifactRoot,
      'company-1',
      'invoice-1',
      'approved-invoice.pdf',
    );
    await mkdir(dirname(candidatePdf), { mode: 0o700, recursive: true });
    await writeFile(candidatePdf, 'new pdf');

    await fixture.store.removeImportStaging(fixture.paths);
    await expect(
      fixture.store.inspectCandidate(fixture.paths),
    ).resolves.toBeUndefined();
    await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'old database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'old pdf',
    );
  });

  it('discards only known pre-activation staging and preserves the active root', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await mkdir(fixture.paths.importStagingRoot, {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');

    await fixture.store.discardBeforeActivation(fixture.paths);

    await expect(lstat(fixture.paths.importStagingRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      lstat(fixture.paths.activationStagingOperationRoot),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'old database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'old pdf',
    );
  });

  it('rejects unexpected candidate content and refuses unsafe cleanup', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');
    await writeFile(
      join(fixture.paths.activationStagingOperationRoot, 'unexpected.txt'),
      'blocked',
    );

    await expect(
      fixture.store.inspectCandidate(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
    await expect(
      fixture.store.discardBeforeActivation(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'cleanup',
    });
  });

  it('rejects a candidate database with another hard link', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');
    await link(
      fixture.paths.candidateDatabasePath,
      join(fixture.root, 'linked.sqlite'),
    );

    await expect(
      fixture.store.inspectCandidate(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
  });

  it('fails closed when the target workspace layout is incomplete', async () => {
    const fixture = await createFixture();
    await rm(fixture.paths.activeDatabasePath);

    await expect(
      fixture.store.prepareCandidate(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'candidateRoot',
    });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-replacement-root-'));
  cleanupRoots.push(root);
  const paths = deriveWorkspaceBackupReplacementPaths(
    root,
    TEST_REPLACEMENT_OPERATION_ID,
    TEST_REPLACEMENT_WORKSPACE_ID,
  );
  const activePdfPath = join(
    paths.activeArtifactRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  await mkdir(dirname(paths.activeDatabasePath), {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(dirname(activePdfPath), { mode: 0o700, recursive: true });
  await writeFile(paths.activeDatabasePath, 'old database');
  await writeFile(activePdfPath, 'old pdf');
  return {
    activePdfPath,
    paths,
    root,
    store: new NodeWorkspaceBackupReplacementRootStore(),
  };
}
