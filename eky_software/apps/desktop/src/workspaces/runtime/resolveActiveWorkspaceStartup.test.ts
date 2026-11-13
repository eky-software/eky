import { createHash } from 'node:crypto';
import {
  access,
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

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceLegacyAdoptionJournalStore } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { resolveWorkspaceLegacyAdoptionStartup } from '../adoption/workspaceLegacyAdoptionStartup.js';
import { createWorkspaceDeletionJournalPaths } from '../deletion/workspaceDeletionJournalStore.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import {
  WORKSPACE_REGISTRY_BACKUP_FILE_NAME,
  WORKSPACE_REGISTRY_FILE_NAME,
  WORKSPACE_REGISTRY_NEXT_FILE_NAME,
} from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import {
  createSwitchJournal,
  createSwitchRegistry,
  TEST_SOURCE_WORKSPACE_ID,
  TEST_TARGET_WORKSPACE_ID,
} from '../switch/workspaceSwitchTestSupport.js';
import { resolveActiveWorkspaceStartup, type ActiveWorkspaceStartupOptions } from './resolveActiveWorkspaceStartup.js';

const temporaryRoots: string[] = [];
const profileId = 'a'.repeat(64);

afterEach(async context => {
  const roots = temporaryRoots.splice(0);
  if (context.task.result?.state !== 'pass') return;
  await Promise.all(
    roots.map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('active workspace startup resolution', () => {
  it.each((['normal', 'targetSelected', 'rollbackSelected'] as const).flatMap(state =>
    (['currentPath', 'backupPath', 'nextPath'] as const).map(slot => ({ state, slot }))))(
    'blocks deletion $slot before registry or switch recovery in $state startup', async ({ state, slot }) => {
      const fixture = await createSwitchStartupFixture(state);
      const path = createWorkspaceDeletionJournalPaths(fixture.userDataRoot)[slot];
      await createPrivateDirectory(join(fixture.userDataRoot, 'workspace-state'));
      await writePrivateFile(path, 'unparsed deletion evidence');
      const registryPath = join(fixture.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME);
      const before = await readFile(registryPath);
      const journalBefore = await fixture.journal.inspectSlots();
      const inspect = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspect');
      const progress = vi.fn();
      try {
        await expect(resolveActiveWorkspaceStartup(fixture.userDataRoot, { reportProgress: progress }))
          .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        expect(inspect).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
        expect(await readFile(registryPath)).toEqual(before);
        expect(await fixture.journal.inspectSlots()).toEqual(journalBefore);
        expect(await readFile(path, 'utf8')).toBe('unparsed deletion evidence');
      } finally { inspect.mockRestore(); }
    },
  );

  it('does not initialize a new company while deletion evidence is present', async () => {
    const root = await createPrivateTemporaryRoot();
    const paths = createWorkspaceDeletionJournalPaths(root);
    await createPrivateDirectory(paths.directoryPath);
    await writePrivateFile(paths.nextPath, 'unpublished deletion evidence');
    const before = await readdir(root);
    await expect(resolveTestWorkspaceStartup(root)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(await readdir(root)).toEqual(before);
    expect(await readdir(paths.directoryPath)).toEqual([paths.nextPath.slice(paths.directoryPath.length + 1)]);
  });

  it('requires preparation authority before creating or repairing adoption files', async () => {
    const root = await createPrivateTemporaryRoot();
    const before = await readdir(root);
    await expect(resolveActiveWorkspaceStartup(root)).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    expect(await readdir(root)).toEqual(before);
  });

  it('rejects a legacy database appearing after the original fresh selection', async () => {
    const root = await createPrivateTemporaryRoot();
    await mkdir(join(root, 'runtime'), { recursive: true });
    const database = join(root, 'runtime', 'data', 'eky.sqlite');
    const bytes = 'synthetic database arriving between source observations';
    const detect = NodeWorkspaceLegacyAdoptionRootStore.prototype.detectSourceKind;
    const observed: string[] = [];
    let calls = 0;
    const spy = vi.spyOn(NodeWorkspaceLegacyAdoptionRootStore.prototype, 'detectSourceKind')
      .mockImplementation(async function (this: NodeWorkspaceLegacyAdoptionRootStore, paths) {
        const call = ++calls;
        if (call === 2) {
          await mkdir(join(root, 'runtime', 'data'), { recursive: true });
          await writePrivateFile(database, bytes);
        }
        const kind = await detect.call(this, paths);
        if (call <= 2) observed.push(kind);
        return kind;
      });
    try {
      await expect(resolveActiveWorkspaceStartup(root, { adoptionAuthority: {
        assertMutationCurrent() {}, async assertCurrent() {}, onUncertain: vi.fn(),
      } })).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
      expect(observed).toEqual(['fresh', 'legacy']);
      expect(await readFile(database, 'utf8')).toBe(bytes);
      expect(await new WorkspaceLegacyAdoptionJournalStore(root).read()).toBeUndefined();
      expect(await new WorkspaceRegistryStore({ installationRoot: root,
        filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) }).inspect()).toBeUndefined();
    } finally { spy.mockRestore(); }
  });

  it('requires exact phase and context authority without poisoning later valid acceptance', async () => {
    const root = await createPrivateTemporaryRoot();
    const preparation = { assertMutationCurrent() {}, async assertCurrent() {}, onUncertain: vi.fn() };
    const selected = await resolveActiveWorkspaceStartup(root, { adoptionAuthority: preparation });
    const context = selected.adoptionContext!;
    const authority = { phase: 'acceptance' as const, context, profileId,
      assertMutationCurrent() {}, async assertCurrent() {} };
    expect(context.preparationAuthority).toBe(preparation);
    await expect(selected.accept(profileId)).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    await expect(selected.accept(profileId, { ...authority, context: { ...context } })).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    await expect(selected.accept('b'.repeat(64), authority)).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    await selected.accept(profileId, authority);
    expect(preparation.onUncertain).not.toHaveBeenCalled();
  });

  it('requires a current after-exit context before recording startup recovery', async () => {
    const root = await createPrivateTemporaryRoot();
    const preparation = { assertMutationCurrent() {}, async assertCurrent() {}, onUncertain: vi.fn() };
    const selected = await resolveActiveWorkspaceStartup(root, { adoptionAuthority: preparation });
    await expect(selected.recoverFromFailure()).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    const authority = { phase: 'afterExit' as const, context: selected.adoptionContext!,
      assertMutationCurrent() {}, async assertCurrent() {} };
    await expect(selected.recoverFromFailure({ ...authority, context: { ...authority.context } })).rejects.toThrow('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    await expect(selected.recoverFromFailure(authority)).resolves.toBe('notRecovered');
    expect((await new WorkspaceLegacyAdoptionJournalStore(root).read())?.state).toBe('recoveryRequired');
    expect(preparation.onUncertain).not.toHaveBeenCalled();
  });

  it('retains the original terminal guard across an asynchronous ownership check', async () => {
    const root = await createPrivateTemporaryRoot();
    const preparation = { assertMutationCurrent() {}, async assertCurrent() {}, onUncertain: vi.fn() };
    const selected = await resolveActiveWorkspaceStartup(root, { adoptionAuthority: preparation });
    const first = new Error('synthetic original terminal owner expired');
    let current = true;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const authority = { phase: 'acceptance' as const, context: selected.adoptionContext!, profileId,
      assertMutationCurrent() { if (!current) throw first; },
      async assertCurrent() { enter(); await waiting; },
    };
    const work = selected.accept(profileId, authority);
    const observed = work.catch(error => error);
    try {
      await entered;
      current = false;
      authority.assertMutationCurrent = () => {};
      authority.assertCurrent = async () => {};
    } finally { release(); await observed; }
    await expect(work).rejects.toBe(first);
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    expect(await registry.inspect()).toBeUndefined();
    expect((await new WorkspaceLegacyAdoptionJournalStore(root).read())?.state).toBe('rootPublished');
  });

  for (const state of ['normal', 'targetSelected', 'rollbackSelected'] as const) {
    it(`exposes the immutable registered lineage for ${state} without granting cleanup`, async context => {
      const f = await createSwitchStartupFixture(state);
      temporaryRoots.splice(temporaryRoots.indexOf(f.userDataRoot), 1);
      context.onTestFinished(async () => {
        if (context.task.result?.state === 'pass') await rm(f.userDataRoot, { recursive: true, force: true });
      });
      const registry = await f.registry.inspect();
      const selected = await resolveTestWorkspaceStartup(f.userDataRoot);
      const expected = registry!.workspaces.find(entry => entry.workspaceId === selected.workspaceId)!.lineageIdentity;
      expect(selected.registeredLineageIdentity).toEqual(expected);
      expect(selected.registeredLineageIdentity).not.toBe(expected);
      expect(Object.isFrozen(selected.registeredLineageIdentity)).toBe(true);
      expect(Reflect.set(selected.registeredLineageIdentity!, 'profileId', 'f'.repeat(64))).toBe(false);
      selected.assertCanAccept(expected.profileId);
      expect(() => selected.assertCanAccept('f'.repeat(64))).toThrow();
      expect(await f.registry.inspect()).toEqual(registry);
    });
  }

  it('does not repair registry slots while resolving an ordinary workspace before schema inventory', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();
    const first = await resolveTestWorkspaceStartup(userDataRoot);
    await first.accept(profileId);
    const paths = [
      join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
      join(userDataRoot, WORKSPACE_REGISTRY_BACKUP_FILE_NAME),
      join(userDataRoot, WORKSPACE_REGISTRY_NEXT_FILE_NAME),
    ];
    await writePrivateFile(paths[1]!, 'unselected-backup-evidence');
    await writePrivateFile(paths[2]!, 'unselected-next-evidence');
    const before = await Promise.all(paths.map(path => readFile(path)));

    const selected = await resolveTestWorkspaceStartup(userDataRoot);

    expect(selected.mode).toBe('normal');
    expect(selected.workspaceId).toBe(first.workspaceId);
    expect(await Promise.all(paths.map(path => readFile(path)))).toEqual(before);
  });

  it('reports closed progress without allowing the observer to change behavior', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();
    const progress: string[] = [];

    const selection = await resolveTestWorkspaceStartup(userDataRoot, {
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

    const first = await resolveTestWorkspaceStartup(userDataRoot);

    expect(first.mode).toBe('adoption');
    expect(first.registeredLineageIdentity).toBeUndefined();
    await first.accept(profileId);
    expect(await readdir(join(userDataRoot, 'workspace-operations'))).toEqual(
      [],
    );

    const second = await resolveTestWorkspaceStartup(userDataRoot);

    expect(second).toMatchObject({
      mode: 'normal',
      workspaceId: first.workspaceId,
      workspaceRoot: first.workspaceRoot,
      registeredLineageIdentity: { formatVersion: 1, profileId },
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

    const first = await resolveTestWorkspaceStartup(userDataRoot);

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

    const second = await resolveTestWorkspaceStartup(userDataRoot);

    expect(second).toMatchObject({
      mode: 'normal',
      workspaceId: first.workspaceId,
      workspaceRoot: first.workspaceRoot,
    });
    await second.accept(profileId);
    expect(await hashFiles([sourceDatabase, sourcePdf])).toBe(sourceIdentity);
  });

  it('discards a matching unpublished adoption root and relaunches before retrying adoption', { timeout: 10_000 }, async () => {
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
    const journal = new WorkspaceLegacyAdoptionJournalStore(userDataRoot);
    // Seed interrupted bytes through the lower owner; recovery below is the subject.
    const first = await resolveWorkspaceLegacyAdoptionStartup({ journal,
      registry: new WorkspaceRegistryStore({ installationRoot: userDataRoot, filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) }),
      rootStore: new NodeWorkspaceLegacyAdoptionRootStore(), userDataRoot,
    });
    await first.recoverFromFailure({ journal });
    const progress: string[] = [];

    await expect(
      resolveTestWorkspaceStartup(userDataRoot, {
        reportProgress(event) {
          progress.push(`${event.phase}:${event.state}`);
        },
      }),
    ).rejects.toMatchObject({
      code: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED',
    });

    expect(await journal.read()).toBeUndefined();
    await expect(pathExists(first.workspaceRoot)).resolves.toBe(false);
    expect(await hashFiles([sourceDatabase, sourcePdf])).toBe(sourceIdentity);
    expect(progress).toEqual([
      'registryStateRead:started',
      'registryStateRead:completed',
      'legacyAdoptionRecovery:started',
      'legacyAdoptionRecovery:completed',
    ]);

    const retry = await resolveTestWorkspaceStartup(userDataRoot);
    expect(retry.mode).toBe('adoption');
    await retry.accept(profileId);
    expect(await hashFiles([sourceDatabase, sourcePdf])).toBe(sourceIdentity);
  });

  it('rolls a missing selected target back before any workspace runtime starts', async () => {
    const fixture = await createSwitchStartupFixture('targetSelected');
    await rm(fixture.targetPaths.workspaceRoot, { recursive: true });
    const progress: string[] = [];

    await expect(
      resolveTestWorkspaceStartup(fixture.userDataRoot, {
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

    const sourceStartup = await resolveTestWorkspaceStartup(
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
      resolveTestWorkspaceStartup(fixture.userDataRoot),
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
      await resolveTestWorkspaceStartup(fixture.userDataRoot, {
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
      resolveTestWorkspaceStartup(fixture.userDataRoot),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_INVALID' });

    expect(await readFile(registryPath)).toEqual(registryBefore);
    expect(await fixture.journal.read()).toBeUndefined();
  });

  it('marks recovery required when the rollback source root is unavailable', async () => {
    const fixture = await createSwitchStartupFixture('rollbackSelected');
    await rm(fixture.sourcePaths.workspaceRoot, { recursive: true });

    await expect(
      resolveTestWorkspaceStartup(fixture.userDataRoot),
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

// Explicit phase doubles for this lower filesystem suite, never production grants.
async function resolveTestWorkspaceStartup(root: string,
  options: Readonly<Omit<ActiveWorkspaceStartupOptions, 'selectorAuthority'>> = {}) {
  const preparation = { assertMutationCurrent() {}, async assertCurrent() {}, onUncertain() {} };
  const selected = await resolveActiveWorkspaceStartup(root, { ...options, adoptionAuthority: preparation });
  const phase = { assertMutationCurrent() {}, async assertCurrent() {} };
  return Object.freeze({ ...selected,
    accept: (profileId: string) => selected.accept(profileId, selected.adoptionContext === undefined ? undefined
      : { ...phase, phase: 'acceptance', context: selected.adoptionContext, profileId }),
    recoverFromFailure: () => selected.recoverFromFailure(selected.adoptionContext === undefined ? undefined
      : { ...phase, phase: 'afterExit', context: selected.adoptionContext }),
  });
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
