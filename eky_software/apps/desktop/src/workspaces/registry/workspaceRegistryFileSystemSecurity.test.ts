import {
  chmod,
  link,
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

import {
  WORKSPACE_REGISTRY_MAX_BYTES,
} from './workspaceRegistryBytes.js';
import { WORKSPACE_REGISTRY_INVALID } from './workspaceRegistryError.js';
import {
  WORKSPACE_REGISTRY_FILE_NAME,
  WORKSPACE_REGISTRY_NEXT_FILE_NAME,
} from './workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from './workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from './workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_UNAVAILABLE } from './workspaceRegistryStoreError.js';

const roots: string[] = [];
const workspaceId = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace registry path boundaries', () => {
  it('accepts only the exact registry path inside its installation root', async () => {
    const root = await createPrivateRoot();
    const installationRoot = join(root, 'registry');
    const outsidePath = join(root, 'outside', WORKSPACE_REGISTRY_FILE_NAME);

    expect(
      () => new WorkspaceRegistryStore({ installationRoot, filePath: outsidePath }),
    ).toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);
    expect(
      () => new WorkspaceRegistryStore({
        installationRoot,
        filePath: join(installationRoot, 'workspace-registry-v2.json'),
      }),
    ).toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);
    expect(
      () => new WorkspaceRegistryStore({
        installationRoot: 'relative-registry-root',
        filePath: 'relative-registry-root/workspace-registry-v1.json',
      }),
    ).toThrow(WORKSPACE_REGISTRY_UNAVAILABLE);
  });

  it('does not expose an outside path through constructor errors', async () => {
    const root = await createPrivateRoot();
    const sensitivePath = join(root, 'customer-name', WORKSPACE_REGISTRY_FILE_NAME);

    try {
      new WorkspaceRegistryStore({
        installationRoot: join(root, 'registry'),
        filePath: sensitivePath,
      });
      throw new Error('Expected constructor to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(WORKSPACE_REGISTRY_UNAVAILABLE);
      expect(String(error)).not.toContain(sensitivePath);
      expect(String(error)).not.toContain('customer-name');
    }
  });
});

describe('workspace registry filesystem boundaries', () => {
  it('rejects a file in place of the registry directory', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.installationRoot, 'not-a-directory');

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
  });

  it('rejects a symlinked registry directory without reading its target', async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, 'outside-directory');
    await mkdir(target, { mode: 0o700 });
    await writeFile(join(target, WORKSPACE_REGISTRY_FILE_NAME), 'outside-secret');
    await symlink(target, fixture.installationRoot, 'dir');

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
    await expect(
      readFile(join(target, WORKSPACE_REGISTRY_FILE_NAME), 'utf8'),
    ).resolves.toBe('outside-secret');
  });

  it('rejects a symlinked current slot without exposing or changing its target', async () => {
    const fixture = await createFixture();
    const sensitiveValue = 'outside-customer-registry';
    const outsideFile = join(fixture.root, 'outside-registry.json');
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await writeFile(outsideFile, sensitiveValue, { mode: 0o600 });
    await symlink(outsideFile, fixture.currentPath, 'file');

    await expectSafeInvalidFailure(fixture.store.read(), [
      outsideFile,
      sensitiveValue,
    ]);
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe(sensitiveValue);
  });

  it('rejects a hard-linked current slot', async () => {
    const fixture = await createFixture();
    const outsideFile = join(fixture.root, 'outside-registry.json');
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await writeFile(outsideFile, serializeWorkspaceRegistry(createRegistry()), {
      mode: 0o600,
    });
    await link(outsideFile, fixture.currentPath);

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
  });

  it('rejects an oversized current slot before allocating its contents', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await writeFile(
      fixture.currentPath,
      Buffer.alloc(WORKSPACE_REGISTRY_MAX_BYTES + 1, 0x61),
      { mode: 0o600 },
    );

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
  });

  it('rejects a directory in place of a registry slot', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.currentPath, { mode: 0o700, recursive: true });

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
  });

  it('fails closed when stale next is a symlink and preserves the target', async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, 'outside-next.json');
    const targetValue = 'outside-next-content';
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await writeFile(
      fixture.currentPath,
      serializeWorkspaceRegistry(createRegistry()),
      { mode: 0o600 },
    );
    await writeFile(target, targetValue, { mode: 0o600 });
    await symlink(target, join(fixture.installationRoot, WORKSPACE_REGISTRY_NEXT_FILE_NAME));

    await expectSafeInvalidFailure(fixture.store.read(), [target, targetValue]);
    await expect(readFile(target, 'utf8')).resolves.toBe(targetValue);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a registry directory with access for other users',
    async () => {
      const fixture = await createFixture();
      await mkdir(fixture.installationRoot, { mode: 0o700 });
      await writeFile(
        fixture.currentPath,
        serializeWorkspaceRegistry(createRegistry()),
        { mode: 0o600 },
      );
      await chmod(fixture.installationRoot, 0o755);

      await expect(fixture.store.read()).rejects.toThrow(
        WORKSPACE_REGISTRY_INVALID,
      );
    },
  );
});

async function createPrivateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-registry-security-'));
  roots.push(root);
  return root;
}

async function createFixture() {
  const root = await createPrivateRoot();
  const installationRoot = join(root, 'registry');
  const currentPath = join(installationRoot, WORKSPACE_REGISTRY_FILE_NAME);
  return {
    currentPath,
    installationRoot,
    root,
    store: new WorkspaceRegistryStore({ installationRoot, filePath: currentPath }),
  };
}

async function expectSafeInvalidFailure(
  operation: Promise<unknown>,
  forbiddenValues: readonly string[],
): Promise<void> {
  try {
    await operation;
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(WORKSPACE_REGISTRY_INVALID);
    for (const forbiddenValue of forbiddenValues) {
      expect(String(error)).not.toContain(forbiddenValue);
    }
  }
}

function createRegistry() {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        workspaceId,
        workspaceLabel: 'Test company',
        lineageIdentity: {
          formatVersion: 1,
          profileId: 'a'.repeat(64),
        },
        layoutVersion: 1,
        lifecycleState: 'ready',
        createdAt: '2026-08-18T10:00:00.000Z',
      },
    ],
  } as const;
}
