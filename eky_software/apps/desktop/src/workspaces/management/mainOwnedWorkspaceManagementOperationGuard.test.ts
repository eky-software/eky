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
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
} from '../../update/directSetupMigrationRecovery.js';
import type { UpdateJournal } from '../../update/updateJournal.js';
import {
  createReadOnlyJournalSlotPaths,
  MainOwnedWorkspaceManagementOperationGuard,
  type MainOwnedWorkspaceManagementOperationGuardOptions,
} from './mainOwnedWorkspaceManagementOperationGuard.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('main-owned workspace management operation guard', () => {
  it('reports clear when no operation slots exist', async () => {
    const fixture = await createFixture();

    await expect(fixture.guard.readRecoveryState()).resolves.toBe('clear');
    await expect(
      fixture.guard.assertNoUnresolvedOperations(),
    ).resolves.toBeUndefined();
  });

  it.each([
    'adoptionJournal',
    'creationJournal',
    'importJournal',
    'profileRestoreJournal',
    'replacementJournal',
    'switchJournal',
  ] as const)('blocks an unresolved %s slot', async (source) => {
    const fixture = await createFixture();
    await writeJson(fixture.paths[source].currentPath, { state: 'prepared' });

    await expect(fixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );
    await expect(
      fixture.guard.assertNoUnresolvedOperations(),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  });

  it('allows only terminal update and direct Setup current records', async () => {
    const fixture = await createFixture();
    await writeJson(
      fixture.paths.updateJournal.currentPath,
      createUpdateJournal('accepted'),
    );
    await writeJson(
      fixture.paths.directSetupRecovery.currentPath,
      createDirectSetupRecord('accepted'),
    );

    await expect(fixture.guard.readRecoveryState()).resolves.toBe('clear');

    await writeJson(
      fixture.paths.updateJournal.currentPath,
      createUpdateJournal('firstStartValidating'),
    );
    await expect(fixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );

    await writeJson(
      fixture.paths.updateJournal.currentPath,
      createUpdateJournal('accepted'),
    );
    await writeJson(
      fixture.paths.directSetupRecovery.currentPath,
      createDirectSetupRecord('migrationRunning'),
    );
    await expect(fixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );
  });

  it('fails closed for recovery slots, malformed records and hard links', async () => {
    const recoverySlotFixture = await createFixture();
    await writeJson(
      recoverySlotFixture.paths.updateJournal.currentPath,
      createUpdateJournal('accepted'),
    );
    await writeFile(
      recoverySlotFixture.paths.updateJournal.nextPath,
      'pending',
      'utf8',
    );
    await expect(
      recoverySlotFixture.guard.readRecoveryState(),
    ).resolves.toBe('recoveryRequired');

    const malformedFixture = await createFixture();
    await writeFile(
      malformedFixture.paths.directSetupRecovery.currentPath,
      '{not-json',
      'utf8',
    );
    await expect(malformedFixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );

    const hardLinkFixture = await createFixture();
    await writeJson(
      hardLinkFixture.paths.updateJournal.currentPath,
      createUpdateJournal('accepted'),
    );
    await link(
      hardLinkFixture.paths.updateJournal.currentPath,
      join(hardLinkFixture.root, 'linked-update-journal.json'),
    );
    await expect(hardLinkFixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );
  });

  it('does not repair, rename or remove journal slots while inspecting', async () => {
    const fixture = await createFixture();
    await writeJson(
      fixture.paths.updateJournal.currentPath,
      createUpdateJournal('accepted'),
    );
    await writeFile(
      fixture.paths.creationJournal.backupPath,
      'opaque-backup',
      'utf8',
    );
    const before = await readFiles([
      fixture.paths.updateJournal.currentPath,
      fixture.paths.creationJournal.backupPath,
    ]);

    await expect(fixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );

    expect(
      await readFiles([
        fixture.paths.updateJournal.currentPath,
        fixture.paths.creationJournal.backupPath,
      ]),
    ).toEqual(before);
  });

  it('fails closed after disposal and rejects invalid current paths', async () => {
    const fixture = await createFixture();
    fixture.guard.dispose();

    await expect(fixture.guard.readRecoveryState()).resolves.toBe(
      'recoveryRequired',
    );
    expect(() => createReadOnlyJournalSlotPaths('relative.json')).toThrow();
    expect(() =>
      createReadOnlyJournalSlotPaths(`${fixture.root}\0invalid.json`),
    ).toThrow();
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-management-guard-'));
  temporaryRoots.push(root);
  const paths = createGuardPaths(root);
  await mkdir(root, { recursive: true });
  return {
    guard: new MainOwnedWorkspaceManagementOperationGuard(paths),
    paths,
    root,
  };
}

function createGuardPaths(
  root: string,
): Readonly<MainOwnedWorkspaceManagementOperationGuardOptions> {
  return Object.freeze({
    adoptionJournal: createReadOnlyJournalSlotPaths(
      join(root, 'adoption.json'),
    ),
    creationJournal: createReadOnlyJournalSlotPaths(
      join(root, 'creation.json'),
    ),
    directSetupRecovery: createReadOnlyJournalSlotPaths(
      join(root, 'direct-setup.json'),
    ),
    importJournal: createReadOnlyJournalSlotPaths(join(root, 'import.json')),
    profileRestoreJournal: createReadOnlyJournalSlotPaths(
      join(root, 'profile-restore.json'),
    ),
    replacementJournal: createReadOnlyJournalSlotPaths(
      join(root, 'replacement.json'),
    ),
    switchJournal: createReadOnlyJournalSlotPaths(join(root, 'switch.json')),
    updateJournal: createReadOnlyJournalSlotPaths(join(root, 'update.json')),
  });
}

function createUpdateJournal(
  state: 'accepted' | 'firstStartValidating',
): Readonly<UpdateJournal> {
  return Object.freeze({
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: 'bbbbbbbbbbbb',
      msiProductVersion: '0.2.0',
      packageSha256: 'b'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-11T18:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'aaaaaaaaaaaa',
      msiProductVersion: '0.1.0',
      packageSha256: 'a'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.1.0',
    formatVersion: 1,
    handoffAttemptCount: 1,
    recoveryPointReference: '11111111-1111-4111-8111-111111111111',
    releaseChannel: 'pilot',
    revision: 5,
    state,
    targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:05:00.000Z',
  });
}

function createDirectSetupRecord(
  state: 'accepted' | 'migrationRunning',
) {
  const prepared = createDirectSetupMigrationRecovery({
    appliedMigrationCount: 37,
    at: '2026-08-12T18:00:00.000Z',
    correlationId: '11111111-1111-4111-8111-111111111111',
    migrationPrefixIdentity: 'a'.repeat(64),
    previousAcceptedBuildIdentity: {
      appVersion: '0.1.0',
      buildRevision: 'aaaaaaaaaaaa',
    },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: {
      appVersion: '0.2.0',
      buildRevision: 'bbbbbbbbbbbb',
    },
  });
  const running = transitionDirectSetupMigrationRecovery(prepared, {
    at: '2026-08-12T18:01:00.000Z',
    state: 'migrationRunning',
  });
  return state === 'migrationRunning'
    ? running
    : transitionDirectSetupMigrationRecovery(running, {
        at: '2026-08-12T18:02:00.000Z',
        state: 'accepted',
      });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

async function readFiles(paths: readonly string[]): Promise<string[]> {
  return Promise.all(paths.map((path) => readFile(path, 'utf8')));
}
