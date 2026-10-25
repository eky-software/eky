import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';

import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createDirectSetupMigrationRecovery } from '../../update/directSetupMigrationRecovery.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../creation/workspaceCreationJournalPaths.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { createWorkspaceSwitchJournalPaths } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../update/workspaceFirstStartMigrationJournalPaths.js';
import { assertNoSelectorWorkspaceRecoveryFromRoot } from './workspaceColdRecoveryAdmissionComposition.js';

const time = '2026-10-25T12:00:00.000Z';
const registry = validateWorkspaceRegistry({ formatVersion: 2, activeWorkspaceId: null,
  workspaces: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map((workspaceId, index) => ({
    workspaceId, workspaceLabel: `Synthetic ${index}`, layoutVersion: 1,
    lineageIdentity: { formatVersion: 1, profileId: String(index + 1).repeat(64) },
    createdAt: time, lifecycleState: index === 0 ? 'ready' : 'recoveryRequired',
  })) });

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-recovery-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass' && !context.signal.aborted) await rm(root, { recursive: true, force: true });
  });
  const runtimeRoot = createDesktopProfilePaths(root).runtimeRoot;
  const update = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: runtimeRoot });
  const journals = {
    adoption: createWorkspaceLegacyAdoptionJournalPaths(root).currentPath,
    creation: createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME)).currentPath,
    import: createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)).currentPath,
    switch: createWorkspaceSwitchJournalPaths(root).currentPath,
    migration: createWorkspaceFirstStartMigrationJournalPaths(root).currentPath,
    legacyRestore: createProfileSnapshotRuntimePaths(runtimeRoot).restoreActivationJournalPath,
    readyRestore: profileRestore(root, 0),
    recoveryRestore: profileRestore(root, 1),
    readyReplacement: deriveWorkspaceBackupReplacementRuntimePaths(root, registry.workspaces[0]!.workspaceId).activationJournalPath,
    recoveryReplacement: deriveWorkspaceBackupReplacementRuntimePaths(root, registry.workspaces[1]!.workspaceId).activationJournalPath,
  };
  const check = () => assertNoSelectorWorkspaceRecoveryFromRoot(root, registry);
  return { root, update, journals, check };
}

function profileRestore(root: string, index: number) {
  const entry = registry.workspaces[index]!;
  const workspace = deriveWorkspaceRoot(root, entry.workspaceId, entry.layoutVersion).workspaceRoot;
  return createProfileSnapshotRuntimePaths(createDesktopProfilePaths(workspace).runtimeRoot).restoreActivationJournalPath;
}

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}

describe('selector recovery conflict census', () => {
  const cases = ['adoption', 'creation', 'import', 'switch', 'migration', 'legacyRestore',
    'readyRestore', 'recoveryRestore', 'readyReplacement', 'recoveryReplacement'] as const;
  it.for(cases.flatMap(kind => ['', '.next', '.backup'].map(slot => ({ kind, slot }))))(
    'preserves $kind$slot and refuses selector mutation', async ({ kind, slot }, context) => {
      const f = await fixture(context);
      const path = `${f.journals[kind]}${slot}`;
      await put(path, 'synthetic pending recovery bytes');
      await expect(f.check()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(await readFile(path, 'utf8')).toBe('synthetic pending recovery bytes');
      expect(await readdir(dirname(path))).toEqual([path.slice(dirname(path).length + 1)]);
    },
  );

  it('leaves missing directories absent and does not treat an update terminal as a workspace conflict', async context => {
    const f = await fixture(context);
    const before = await readdir(f.root);
    await f.check();
    expect(await readdir(f.root)).toEqual(before);
    await put(f.update.journalPath, 'C content is checked by its selected owner');
    await f.check();
    expect(await readFile(f.update.journalPath, 'utf8')).toBe('C content is checked by its selected owner');
  });

  it.for(['accepted', 'prepared', 'migrationRunning', 'failedSafe', 'recoveryRequired', 'invalid', 'next', 'backup'])(
    'retains Direct Setup %s without repairing its files', async (state, context) => {
      const f = await fixture(context);
      const record = createDirectSetupMigrationRecovery({ at: time, appliedMigrationCount: 1,
        correlationId: registry.workspaces[0]!.workspaceId, recoveryPointReference: registry.workspaces[0]!.workspaceId,
        migrationPrefixIdentity: 'a'.repeat(64), previousAcceptedBuildIdentity: { appVersion: '0.1.0', buildRevision: 'a'.repeat(40) },
        runningTargetBuildIdentity: { appVersion: '0.2.0', buildRevision: 'b'.repeat(40) } });
      const path = f.update.directSetupMigrationRecoveryPath + (state === 'next' || state === 'backup' ? `.${state}` : '');
      const bytes = state === 'invalid' ? '{' : JSON.stringify({ ...record, state: state === 'next' || state === 'backup' ? 'accepted' : state });
      await put(path, bytes);
      if (state === 'accepted') await f.check();
      else await expect(f.check()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(await readFile(path, 'utf8')).toBe(bytes);
    },
  );

  it('observes a conflict introduced after an earlier clear census', async context => {
    const f = await fixture(context);
    await f.check();
    await put(f.journals.switch, 'new owner');
    await expect(f.check()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(await readFile(f.journals.switch, 'utf8')).toBe('new owner');
  });

  it('rejects an active registry without reading its files', async context => {
    const f = await fixture(context);
    await expect(assertNoSelectorWorkspaceRecoveryFromRoot(f.root,
      { ...registry, activeWorkspaceId: registry.workspaces[0]!.workspaceId }))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(await readdir(f.root)).toEqual([]);
  });
});
