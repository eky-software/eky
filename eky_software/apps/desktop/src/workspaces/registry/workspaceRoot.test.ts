import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveWorkspaceRoot,
  type WorkspaceRootPathsV1,
} from './deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from './inspectWorkspaceRoot.js';
import { WORKSPACE_ROOT_INVALID } from './workspaceRootError.js';
import type { WorkspaceId } from './workspaceRegistryTypes.js';

const workspaceId = '11111111-1111-4111-8111-111111111111' as WorkspaceId;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace root derivation', () => {
  it('derives the v1 root only from userData and a canonical workspace id', async () => {
    const userDataPath = await createPrivateRoot();

    expect(deriveWorkspaceRoot(userDataPath, workspaceId, 1)).toEqual({
      layoutVersion: 1,
      workspacesRoot: join(userDataPath, 'workspaces'),
      workspaceRoot: join(userDataPath, 'workspaces', workspaceId),
    });
  });

  it('rejects relative userData paths, NUL bytes, invalid ids and layout versions', () => {
    expectRootInvalid(() => deriveWorkspaceRoot('relative', workspaceId, 1));
    expectRootInvalid(() => deriveWorkspaceRoot('/tmp/unsafe\0root', workspaceId, 1));
    expectRootInvalid(() =>
      deriveWorkspaceRoot('/tmp/eky', '../workspace' as WorkspaceId, 1),
    );
    expectRootInvalid(() =>
      deriveWorkspaceRoot('/tmp/eky', workspaceId, 2 as 1),
    );
  });
});

describe('workspace root inspection', () => {
  it('accepts existing private real directories inside the workspaces root', async () => {
    const userDataPath = await createPrivateRoot();
    const paths = deriveWorkspaceRoot(userDataPath, workspaceId, 1);
    await mkdir(paths.workspaceRoot, { mode: 0o700, recursive: true });

    await expect(inspectWorkspaceRoot(paths)).resolves.toBe(paths);
  });

  it('rejects a missing workspace root', async () => {
    const userDataPath = await createPrivateRoot();
    const paths = deriveWorkspaceRoot(userDataPath, workspaceId, 1);
    await mkdir(paths.workspacesRoot, { mode: 0o700 });

    await expect(inspectWorkspaceRoot(paths)).rejects.toThrow(
      WORKSPACE_ROOT_INVALID,
    );
  });

  it('rejects a file in place of the workspace directory', async () => {
    const userDataPath = await createPrivateRoot();
    const paths = deriveWorkspaceRoot(userDataPath, workspaceId, 1);
    await mkdir(paths.workspacesRoot, { mode: 0o700 });
    await writeFile(paths.workspaceRoot, 'not-a-directory');

    await expect(inspectWorkspaceRoot(paths)).rejects.toThrow(
      WORKSPACE_ROOT_INVALID,
    );
  });

  it('rejects symlinked workspace roots', async () => {
    const userDataPath = await createPrivateRoot();
    const paths = deriveWorkspaceRoot(userDataPath, workspaceId, 1);
    const target = join(userDataPath, 'target');
    await Promise.all([
      mkdir(paths.workspacesRoot, { mode: 0o700 }),
      mkdir(target, { mode: 0o700 }),
    ]);
    await symlink(target, paths.workspaceRoot, 'dir');

    await expect(inspectWorkspaceRoot(paths)).rejects.toThrow(
      WORKSPACE_ROOT_INVALID,
    );
  });

  it('rejects forged paths outside the derived workspaces root', async () => {
    const userDataPath = await createPrivateRoot();
    const workspacesRoot = join(userDataPath, 'workspaces');
    const outsideRoot = join(userDataPath, 'outside');
    await Promise.all([
      mkdir(workspacesRoot, { mode: 0o700 }),
      mkdir(outsideRoot, { mode: 0o700 }),
    ]);
    const forged = {
      layoutVersion: 1,
      workspacesRoot,
      workspaceRoot: outsideRoot,
    } as const satisfies WorkspaceRootPathsV1;

    await expect(inspectWorkspaceRoot(forged)).rejects.toThrow(
      WORKSPACE_ROOT_INVALID,
    );
  });
});

async function createPrivateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-root-'));
  roots.push(root);
  return root;
}

function expectRootInvalid(operation: () => unknown): void {
  expect(operation).toThrow(WORKSPACE_ROOT_INVALID);
}
