import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import {
  createSwitchJournal,
  createSwitchRegistry,
  TEST_SOURCE_WORKSPACE_ID,
  TEST_TARGET_WORKSPACE_ID,
} from '../switch/workspaceSwitchTestSupport.js';
import { resolveActiveWorkspaceStartup } from './resolveActiveWorkspaceStartup.js';

const temporaryRoots: string[] = [];
const profileId = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('active workspace startup resolution', () => {
  it('reports closed progress without allowing the observer to change behavior', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();
    const progress: string[] = [];

    const selection = await resolveActiveWorkspaceStartup(userDataRoot, {
      reportProgress(event) {
        progress.push(`${event.phase}:${event.state}`);
        if (event.state === 'completed') throw new Error('observer failure');
      },
    });

    expect(selection.mode).toBe('adoption');
    expect(progress).toEqual([
      'registryStateRead:started',
      'registryStateRead:completed',
      'legacyAdoption:started',
      'legacyAdoption:completed',
    ]);
  });

  it('adopts a fresh installation once and reopens the same workspace normally', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();

    const first = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(first.mode).toBe('adoption');
    await first.accept(profileId);
    expect(await readdir(join(userDataRoot, 'workspace-operations'))).toEqual(
      [],
    );

    const second = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(second).toMatchObject({
      mode: 'normal',
      workspaceId: first.workspaceId,
      workspaceRoot: first.workspaceRoot,
    });
    await second.accept(profileId);
    await expect(
      readdir(join(second.workspaceRoot, 'runtime', 'storage', 'invoices')),
    ).resolves.toEqual([]);
  });

  it('copies a legacy profile without changing its authoritative source', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();
    const legacyRuntimeRoot = join(userDataRoot, 'runtime');
    const sourceDatabase = join(legacyRuntimeRoot, 'data', 'eky.sqlite');
    const sourcePdf = join(
      legacyRuntimeRoot,
      'storage',
      'invoices',
      'approved-invoice.pdf',
    );
    await createPrivateDirectory(join(legacyRuntimeRoot, 'data'));
    await createPrivateDirectory(join(legacyRuntimeRoot, 'storage'));
    await createPrivateDirectory(
      join(legacyRuntimeRoot, 'storage', 'invoices'),
    );
    await writePrivateFile(sourceDatabase, 'synthetic-sqlite-profile');
    await writePrivateFile(sourcePdf, '%PDF-1.7\nsynthetic');
    const sourceIdentity = await hashFiles([sourceDatabase, sourcePdf]);

    const first = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(first.mode).toBe('adoption');
    expect(
      await hashFiles([
        join(first.workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
        join(
          first.workspaceRoot,
          'runtime',
          'storage',
          'invoices',
          'approved-invoice.pdf',
        ),
      ]),
    ).toBe(sourceIdentity);
    await first.accept(profileId);

    const second = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(second).toMatchObject({
      mode: 'normal',
      workspaceId: first.workspaceId,
      workspaceRoot: first.workspaceRoot,
    });
    await second.accept(profileId);
    expect(await hashFiles([sourceDatabase, sourcePdf])).toBe(sourceIdentity);
  });

  it('rolls a missing selected target back before any workspace runtime starts', async () => {
    const fixture = await createSwitchStartupFixture('targetSelected');
    await rm(fixture.targetPaths.workspaceRoot, { recursive: true });
    const progress: string[] = [];

    await expect(
      resolveActiveWorkspaceStartup(fixture.userDataRoot, {
        reportProgress(event) {
          progress.push(`${event.phase}:${event.state}`);
        },
      }),
    ).rejects.toMatchObject({
      code: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED',
      message: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED',
    });

    expect((await fixture.registry.read())?.activeWorkspaceId)
      .toBe(TEST_SOURCE_WORKSPACE_ID);
    expect((await fixture.journal.read())?.state).toBe('rollbackSelected');
    expect(progress).toEqual([
      'registryStateRead:started',
      'registryStateRead:completed',
      'switchRecovery:started',
      'switchRecovery:completed',
      'workspaceRootInspection:started',
    ]);

    const sourceStartup = await resolveActiveWorkspaceStartup(
      fixture.userDataRoot,
    );
    expect(sourceStartup).toMatchObject({
      mode: 'rollbackValidation',
      workspaceId: TEST_SOURCE_WORKSPACE_ID,
      workspaceRoot: fixture.sourcePaths.workspaceRoot,
    });
    await sourceStartup.accept(profileId);
    expect(await fixture.journal.read()).toBeUndefined();
  });

  it('rolls a structurally invalid selected target back to the source', async () => {
    const fixture = await createSwitchStartupFixture('targetSelected');
    await rm(fixture.targetPaths.workspaceRoot, { recursive: true });
    await writePrivateFile(
      fixture.targetPaths.workspaceRoot,
      'synthetic-invalid-workspace-root',
    );

    await expect(
      resolveActiveWorkspaceStartup(fixture.userDataRoot),
    ).rejects.toMatchObject({
      code: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED',
    });

    expect((await fixture.registry.read())?.activeWorkspaceId)
      .toBe(TEST_SOURCE_WORKSPACE_ID);
    expect((await fixture.journal.read())?.state).toBe('rollbackSelected');
  });

  it('exposes only a closed relaunch code and closed progress after target inspection fails', async () => {
    const fixture = await createSwitchStartupFixture('targetSelected');
    await rm(fixture.targetPaths.workspaceRoot, { recursive: true });
    const progress: string[] = [];
    let caught: unknown;

    try {
      await resolveActiveWorkspaceStartup(fixture.userDataRoot, {
        reportProgress(event) {
          progress.push(`${event.phase}:${event.state}`);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED',
      message: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED',
    });
    const safeEvidence = JSON.stringify({
      code: (caught as { code?: unknown }).code,
      message: caught instanceof Error ? caught.message : undefined,
      progress,
    });
    expect(safeEvidence).not.toContain(fixture.userDataRoot);
    expect(safeEvidence).not.toContain('WORKSPACE_ROOT_INVALID');
    expect(safeEvidence).not.toContain('stack');
  });

  it('fails closed without changing registry or journal in normal mode', async () => {
    const fixture = await createSwitchStartupFixture('normal');
    await rm(fixture.sourcePaths.workspaceRoot, { recursive: true });
    const registryPath = join(
      fixture.userDataRoot,
      WORKSPACE_REGISTRY_FILE_NAME,
    );
    const registryBefore = await readFile(registryPath);

    await expect(
      resolveActiveWorkspaceStartup(fixture.userDataRoot),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_INVALID' });

    expect(await readFile(registryPath)).toEqual(registryBefore);
    expect(await fixture.journal.read()).toBeUndefined();
  });

  it('marks recovery required when the rollback source root is unavailable', async () => {
    const fixture = await createSwitchStartupFixture('rollbackSelected');
    await rm(fixture.sourcePaths.workspaceRoot, { recursive: true });

    await expect(
      resolveActiveWorkspaceStartup(fixture.userDataRoot),
    ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED' });

    expect((await fixture.registry.read())?.activeWorkspaceId)
      .toBe(TEST_SOURCE_WORKSPACE_ID);
    expect((await fixture.journal.read())?.state).toBe('recoveryRequired');
  });
});

async function createSwitchStartupFixture(
  state: 'normal' | 'targetSelected' | 'rollbackSelected',
) {
  const userDataRoot = await createPrivateTemporaryRoot();
  const registry = new WorkspaceRegistryStore({
    installationRoot: userDataRoot,
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
  });
  const activeWorkspaceId =
    state === 'targetSelected'
      ? TEST_TARGET_WORKSPACE_ID
      : TEST_SOURCE_WORKSPACE_ID;
  await registry.write(createSwitchRegistry(activeWorkspaceId));
  const sourcePaths = deriveWorkspaceRoot(
    userDataRoot,
    TEST_SOURCE_WORKSPACE_ID,
    1,
  );
  const targetPaths = deriveWorkspaceRoot(
    userDataRoot,
    TEST_TARGET_WORKSPACE_ID,
    1,
  );
  await createPrivateDirectory(sourcePaths.workspaceRoot);
  await createPrivateDirectory(targetPaths.workspaceRoot);
  const journal = new WorkspaceSwitchJournalStore(userDataRoot);
  if (state !== 'normal') {
    const prepared = createSwitchJournal('prepared');
    await journal.write(prepared);
    await journal.write({ ...prepared, state: 'targetSelected' });
    if (state === 'rollbackSelected') {
      await journal.write({ ...prepared, state: 'rollbackSelected' });
    }
  }
  return { journal, registry, sourcePaths, targetPaths, userDataRoot };
}

async function createPrivateTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-active-workspace-'));
  temporaryRoots.push(root);
  if (process.platform !== 'win32') await chmod(root, 0o700);
  return root;
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function hashFiles(paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(await readFile(path));
  return hash.digest('hex');
}
