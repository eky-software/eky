import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WORKSPACE_REGISTRY_INVALID } from './workspaceRegistryError.js';
import {
  WORKSPACE_REGISTRY_BACKUP_FILE_NAME,
  WORKSPACE_REGISTRY_FILE_NAME,
  WORKSPACE_REGISTRY_NEXT_FILE_NAME,
} from './workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from './workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from './workspaceRegistryStore.js';

const roots: string[] = [];
const firstWorkspaceId = '11111111-1111-4111-8111-111111111111';
const secondWorkspaceId = '22222222-2222-4222-8222-222222222222';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace registry store', () => {
  it('writes and reads the first canonical registry', async () => {
    const fixture = await createFixture();
    const registry = createRegistry('Ensimmäinen yritys');

    await fixture.store.write(registry);

    await expect(fixture.store.read()).resolves.toEqual(registry);
    await expect(readFile(fixture.currentPath)).resolves.toEqual(
      Buffer.from(serializeWorkspaceRegistry(registry)),
    );
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('replaces current atomically and removes recovery slots', async () => {
    const fixture = await createFixture();
    const first = createRegistry('Ensimmäinen yritys');
    const second = createRegistry('Toinen yritys', secondWorkspaceId);
    await fixture.store.write(first);

    await fixture.store.write(second);

    await expect(fixture.store.read()).resolves.toEqual(second);
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('reads an existing valid current registry', async () => {
    const fixture = await createFixture();
    const registry = createRegistry('Nykyinen yritys');
    await writeSlot(fixture.currentPath, registry);

    await expect(fixture.store.read()).resolves.toEqual(registry);
  });

  it('keeps valid current authoritative and removes stale slots', async () => {
    const fixture = await createFixture();
    const current = createRegistry('Nykyinen yritys');
    await Promise.all([
      writeSlot(fixture.currentPath, current),
      writeSlot(fixture.nextPath, createRegistry('Seuraava', secondWorkspaceId)),
      writeSlot(fixture.backupPath, createRegistry('Varmistus', secondWorkspaceId)),
    ]);

    await expect(fixture.store.read()).resolves.toEqual(current);
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('restores valid backup when current is missing and discards next', async () => {
    const fixture = await createFixture();
    const backup = createRegistry('Varmistus');
    await Promise.all([
      writeSlot(fixture.backupPath, backup),
      writeSlot(fixture.nextPath, createRegistry('Seuraava', secondWorkspaceId)),
    ]);

    await expect(fixture.store.read()).resolves.toEqual(backup);
    await expect(readFile(fixture.currentPath)).resolves.toEqual(
      Buffer.from(serializeWorkspaceRegistry(backup)),
    );
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('promotes valid next after an interrupted first write', async () => {
    const fixture = await createFixture();
    const next = createRegistry('Seuraava');
    await writeSlot(fixture.nextPath, next);

    await expect(fixture.store.read()).resolves.toEqual(next);
    await expect(readFile(fixture.currentPath)).resolves.toEqual(
      Buffer.from(serializeWorkspaceRegistry(next)),
    );
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
  });

  it('fails closed on invalid current even when backup is valid', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await Promise.all([
      writeFile(fixture.currentPath, '{}\n'),
      writeSlot(fixture.backupPath, createRegistry('Varmistus')),
    ]);

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
    await expect(pathExists(fixture.backupPath)).resolves.toBe(true);
  });

  it('fails closed on an invalid backup instead of promoting next', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await Promise.all([
      writeFile(fixture.backupPath, '{}\n'),
      writeSlot(fixture.nextPath, createRegistry('Seuraava')),
    ]);

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_REGISTRY_INVALID,
    );
    await expect(pathExists(fixture.nextPath)).resolves.toBe(true);
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-registry-'));
  roots.push(root);
  const installationRoot = join(root, 'registry');
  const currentPath = join(installationRoot, WORKSPACE_REGISTRY_FILE_NAME);
  return {
    backupPath: join(installationRoot, WORKSPACE_REGISTRY_BACKUP_FILE_NAME),
    currentPath,
    installationRoot,
    nextPath: join(installationRoot, WORKSPACE_REGISTRY_NEXT_FILE_NAME),
    store: new WorkspaceRegistryStore({ installationRoot, filePath: currentPath }),
  };
}

async function writeSlot(path: string, registry: unknown): Promise<void> {
  await mkdir(join(path, '..'), { mode: 0o700, recursive: true });
  await writeFile(path, serializeWorkspaceRegistry(registry), { mode: 0o600 });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function createRegistry(
  workspaceLabel: string,
  workspaceId = firstWorkspaceId,
) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        workspaceId,
        workspaceLabel,
        lineageIdentity: {
          formatVersion: 1,
          profileId: workspaceId === firstWorkspaceId ? 'a'.repeat(64) : 'b'.repeat(64),
        },
        layoutVersion: 1,
        lifecycleState: 'ready',
        createdAt: '2026-08-18T10:00:00.000Z',
      },
    ],
  } as const;
}
