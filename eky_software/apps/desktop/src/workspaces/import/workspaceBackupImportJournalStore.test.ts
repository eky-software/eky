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

import { WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID } from './workspaceBackupImportJournalError.js';
import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_BACKUP_FILE_NAME,
  WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
  WORKSPACE_BACKUP_IMPORT_JOURNAL_NEXT_FILE_NAME,
} from './workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import type {
  WorkspaceBackupImportJournalState,
  WorkspaceBackupImportJournalV1,
} from './workspaceBackupImportTypes.js';

const roots: string[] = [];
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace backup import journal store', () => {
  it('writes, advances and reads a canonical journal', async () => {
    const fixture = await createFixture();
    const prepared = createJournal('prepared');
    const candidateCreated = createJournal('candidateRootCreated');

    await fixture.store.write(prepared);
    await fixture.store.write(candidateCreated);

    await expect(fixture.store.read()).resolves.toEqual(candidateCreated);
    await expect(readFile(fixture.currentPath)).resolves.toEqual(
      Buffer.from(serializeWorkspaceBackupImportJournal(candidateCreated)),
    );
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('fails closed on an invalid authoritative slot', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await Promise.all([
      writeFile(fixture.currentPath, '{}\n', { mode: 0o600 }),
      writeSlot(fixture.backupPath, createJournal('prepared')),
    ]);

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID,
    );
    await expect(pathExists(fixture.backupPath)).resolves.toBe(true);
  });

  it.each([
    'prepared',
    'candidateRootCreated',
    'backupStaged',
    'candidateMigrated',
    'candidateValidated',
  ] as const)('discards a matching %s journal before publication', async (state) => {
    const fixture = await createFixture();
    await writeThroughState(fixture.store, state);

    await expect(
      fixture.store.discardBeforePublication(
        operationId as WorkspaceBackupImportJournalV1['operationId'],
      ),
    ).resolves.toBeUndefined();
    await expect(fixture.store.read()).resolves.toBeUndefined();
  });

  it.each(['rootPublished', 'registryPublished'] as const)(
    'retains and rejects discarding a %s journal',
    async (state) => {
      const fixture = await createFixture();
      await writeThroughState(fixture.store, state);

      await expect(
        fixture.store.discardBeforePublication(
          operationId as WorkspaceBackupImportJournalV1['operationId'],
        ),
      ).rejects.toThrow(WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID);
      await expect(fixture.store.read()).resolves.toEqual(
        createJournal(state),
      );
    },
  );

  it('removes only the matching registry-published journal', async () => {
    const fixture = await createFixture();
    await writeThroughState(fixture.store, 'registryPublished');

    await expect(
      fixture.store.remove(
        operationId as WorkspaceBackupImportJournalV1['operationId'],
      ),
    ).resolves.toBeUndefined();
    await expect(fixture.store.read()).resolves.toBeUndefined();
  });

  it('rejects wrong-operation cleanup and premature terminal removal', async () => {
    const fixture = await createFixture();
    await fixture.store.write(createJournal('prepared'));

    await expect(
      fixture.store.discardBeforePublication(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as WorkspaceBackupImportJournalV1['operationId'],
      ),
    ).rejects.toThrow(WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID);
    await expect(
      fixture.store.remove(
        operationId as WorkspaceBackupImportJournalV1['operationId'],
      ),
    ).rejects.toThrow(WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID);
    await expect(fixture.store.read()).resolves.toEqual(
      createJournal('prepared'),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-import-journal-'));
  roots.push(root);
  const installationRoot = join(root, 'workspace-operations');
  const currentPath = join(
    installationRoot,
    WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
  );
  return {
    backupPath: join(
      installationRoot,
      WORKSPACE_BACKUP_IMPORT_JOURNAL_BACKUP_FILE_NAME,
    ),
    currentPath,
    installationRoot,
    nextPath: join(
      installationRoot,
      WORKSPACE_BACKUP_IMPORT_JOURNAL_NEXT_FILE_NAME,
    ),
    store: new WorkspaceBackupImportJournalStore({
      installationRoot,
      filePath: currentPath,
    }),
  };
}

async function writeThroughState(
  store: WorkspaceBackupImportJournalStore,
  terminalState: WorkspaceBackupImportJournalState,
): Promise<void> {
  for (const state of states) {
    await store.write(createJournal(state));
    if (state === terminalState) return;
  }
}

async function writeSlot(path: string, journal: unknown): Promise<void> {
  await mkdir(join(path, '..'), { mode: 0o700, recursive: true });
  await writeFile(path, serializeWorkspaceBackupImportJournal(journal), {
    mode: 0o600,
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const states: readonly WorkspaceBackupImportJournalState[] = [
  'prepared',
  'candidateRootCreated',
  'backupStaged',
  'candidateMigrated',
  'candidateValidated',
  'rootPublished',
  'registryPublished',
];

function createJournal(
  state: WorkspaceBackupImportJournalState,
): Readonly<WorkspaceBackupImportJournalV1> {
  const hasLineage = [
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(state);
  return {
    formatVersion: 1,
    operationId:
      operationId as WorkspaceBackupImportJournalV1['operationId'],
    workspaceId: workspaceId as WorkspaceBackupImportJournalV1['workspaceId'],
    workspaceLabel: 'Tuotu yritys',
    previousActiveWorkspaceId: null,
    state,
    createdAt: '2026-08-18T10:00:00.000Z',
    lineageIdentity: hasLineage
      ? { formatVersion: 1, profileId: 'a'.repeat(64) }
      : null,
  };
}
