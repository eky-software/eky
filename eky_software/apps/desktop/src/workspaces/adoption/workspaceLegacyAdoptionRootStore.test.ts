import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import {
  TEST_ADOPTION_OPERATION_ID,
  TEST_ADOPTION_WORKSPACE_ID,
} from './workspaceLegacyAdoptionTestSupport.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('workspace legacy adoption root store', () => {
  it('copies only workspace-owned legacy state and leaves the source unchanged', async () => {
    const fixture = await createFixture();
    await createLegacyRuntime(fixture.paths.legacyRuntimeRoot);
    const sourceDatabase = await readFile(
      join(fixture.paths.legacyRuntimeRoot, 'data', 'eky.sqlite'),
    );

    await expect(fixture.store.detectSourceKind(fixture.paths))
      .resolves.toBe('legacy');
    await fixture.store.assertNoUntrackedWorkspaceRoots(fixture.paths);
    await fixture.store.prepareCandidate(fixture.paths, 'legacy');
    await fixture.store.publishCandidate(fixture.paths);
    await fixture.store.inspectPublished(fixture.paths, 'legacy');
    await fixture.store.discardCandidate(fixture.paths);

    await expect(
      readFile(join(fixture.paths.finalRoot, 'runtime', 'data', 'eky.sqlite')),
    ).resolves.toEqual(sourceDatabase);
    await expect(
      pathExists(join(fixture.paths.finalRoot, 'runtime', 'logs')),
    ).resolves.toBe(false);
    await expect(
      pathExists(join(fixture.paths.finalRoot, 'runtime', 'update-state')),
    ).resolves.toBe(false);
    await expect(
      readFile(join(fixture.paths.legacyRuntimeRoot, 'data', 'eky.sqlite')),
    ).resolves.toEqual(sourceDatabase);
    await expect(pathExists(fixture.paths.operationRoot)).resolves.toBe(false);
  });

  it('creates an empty workspace layout for a fresh installation', async () => {
    const fixture = await createFixture();

    await expect(fixture.store.detectSourceKind(fixture.paths))
      .resolves.toBe('fresh');
    await fixture.store.prepareCandidate(fixture.paths, 'fresh');
    await fixture.store.publishCandidate(fixture.paths);

    await expect(fixture.store.inspectPublished(fixture.paths, 'fresh'))
      .resolves.toBeUndefined();
    await expect(
      pathExists(join(fixture.paths.finalRoot, 'runtime', 'data', 'eky.sqlite')),
    ).resolves.toBe(false);
  });

  it('fails closed when an untracked workspace or operation exists', async () => {
    const fixture = await createFixture();
    await createPrivateDirectory(fixture.paths.workspacesRoot);
    await createPrivateDirectory(join(fixture.paths.workspacesRoot, 'unknown'));

    await expect(
      fixture.store.assertNoUntrackedWorkspaceRoots(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    });
  });

  it('fails closed for partial workspace state without a legacy database', async () => {
    const fixture = await createFixture();
    await createPrivateDirectory(fixture.paths.legacyRuntimeRoot);
    await createPrivateDirectory(join(fixture.paths.legacyRuntimeRoot, 'data'));

    await expect(fixture.store.detectSourceKind(fixture.paths)).rejects
      .toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-adoption-'));
  cleanupRoots.push(root);
  if (process.platform !== 'win32') await chmod(root, 0o700);
  return {
    paths: deriveWorkspaceLegacyAdoptionPaths(
      root,
      TEST_ADOPTION_OPERATION_ID,
      TEST_ADOPTION_WORKSPACE_ID,
    ),
    store: new NodeWorkspaceLegacyAdoptionRootStore(),
  };
}

async function createLegacyRuntime(runtimeRoot: string): Promise<void> {
  await createPrivateDirectory(runtimeRoot);
  await createPrivateDirectory(join(runtimeRoot, 'data'));
  await writeFile(join(runtimeRoot, 'data', 'eky.sqlite'), 'synthetic-database');
  await createPrivateDirectory(join(runtimeRoot, 'storage'));
  await createPrivateDirectory(join(runtimeRoot, 'storage', 'invoices'));
  await writeFile(
    join(runtimeRoot, 'storage', 'invoices', 'invoice.pdf'),
    'synthetic-pdf',
  );
  await createPrivateDirectory(join(runtimeRoot, 'secrets'));
  await writeFile(join(runtimeRoot, 'secrets', 'smtp.dat'), 'encrypted');
  await createPrivateDirectory(join(runtimeRoot, 'logs'));
  await writeFile(join(runtimeRoot, 'logs', 'operational.jsonl'), 'log');
  await createPrivateDirectory(join(runtimeRoot, 'update-state'));
  await writeFile(join(runtimeRoot, 'update-state', 'journal.json'), 'state');
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
