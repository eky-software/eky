import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveWorkspaceCandidateRuntimePaths } from './workspaceCandidateRuntimePaths.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('workspace candidate runtime paths', () => {
  it('resolves only the expected packaged backend and runner paths', async () => {
    const fixture = await createFixture();

    await expect(
      resolveWorkspaceCandidateRuntimePaths(fixture.resourcesRoot),
    ).resolves.toEqual({
      backendRoot: fixture.backendRoot,
      migrationsDirectory: fixture.migrationsDirectory,
      runnerPath: fixture.runnerPath,
    });
  });

  it('fails closed for relative, missing and NUL-containing roots', async () => {
    await expect(
      resolveWorkspaceCandidateRuntimePaths('relative-resources'),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_RUNTIME_PATHS_INVALID');
    await expect(
      resolveWorkspaceCandidateRuntimePaths(join(tmpdir(), 'missing-eky-root')),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_RUNTIME_PATHS_INVALID');
    await expect(
      resolveWorkspaceCandidateRuntimePaths(`${tmpdir()}\0invalid`),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_RUNTIME_PATHS_INVALID');
  });

  it('rejects a hard-linked candidate runner', async () => {
    const fixture = await createFixture();
    await link(fixture.runnerPath, join(fixture.root, 'runner-hard-link.js'));

    await expect(
      resolveWorkspaceCandidateRuntimePaths(fixture.resourcesRoot),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_RUNTIME_PATHS_INVALID');
  });

  it('rejects a resources root reached through a directory link', async () => {
    const fixture = await createFixture();
    const alias = join(fixture.root, 'resources-alias');
    await symlink(fixture.resourcesRoot, alias, 'junction');

    await expect(
      resolveWorkspaceCandidateRuntimePaths(alias),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_RUNTIME_PATHS_INVALID');
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-candidate-paths-'));
  temporaryRoots.push(root);
  const resourcesRoot = join(root, 'resources');
  const backendRoot = join(resourcesRoot, 'backend');
  const migrationsDirectory = join(
    backendRoot,
    'dist',
    'database',
    'migrations',
  );
  const runnerPath = join(
    resourcesRoot,
    'desktop-runtime',
    'runtime',
    'workspaceCandidateRunner.js',
  );
  await mkdir(migrationsDirectory, { recursive: true });
  await mkdir(dirname(runnerPath), { recursive: true });
  await writeFile(runnerPath, 'export {};\n', 'utf8');
  return {
    backendRoot,
    migrationsDirectory,
    resourcesRoot,
    root,
    runnerPath,
  };
}
