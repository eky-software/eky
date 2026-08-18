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

import { WORKSPACE_CREATION_JOURNAL_INVALID } from './workspaceCreationJournalError.js';
import {
  WORKSPACE_CREATION_JOURNAL_BACKUP_FILE_NAME,
  WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  WORKSPACE_CREATION_JOURNAL_NEXT_FILE_NAME,
} from './workspaceCreationJournalPaths.js';
import { serializeWorkspaceCreationJournal } from './workspaceCreationJournalSerializer.js';
import { WorkspaceCreationJournalStore } from './workspaceCreationJournalStore.js';
import type {
  WorkspaceCreationJournalState,
  WorkspaceCreationJournalV1,
} from './workspaceCreationTypes.js';

const roots: string[] = [];
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace creation journal store', () => {
  it('writes, advances and reads a canonical journal', async () => {
    const fixture = await createFixture();
    const prepared = createJournal('prepared');
    const candidateCreated = createJournal('candidateRootCreated');

    await fixture.store.write(prepared);
    await fixture.store.write(candidateCreated);

    await expect(fixture.store.read()).resolves.toEqual(candidateCreated);
    await expect(readFile(fixture.currentPath)).resolves.toEqual(
      Buffer.from(serializeWorkspaceCreationJournal(candidateCreated)),
    );
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('accepts an idempotent rewrite of the current state', async () => {
    const fixture = await createFixture();
    const prepared = createJournal('prepared');
    await fixture.store.write(prepared);

    await expect(fixture.store.write(prepared)).resolves.toBeUndefined();
    await expect(fixture.store.read()).resolves.toEqual(prepared);
  });

  it('keeps valid current authoritative and removes stale recovery slots', async () => {
    const fixture = await createFixture();
    const current = createJournal('candidateRootCreated');
    await Promise.all([
      writeSlot(fixture.currentPath, current),
      writeSlot(fixture.nextPath, createJournal('bootstrapCompleted')),
      writeSlot(fixture.backupPath, createJournal('prepared')),
    ]);

    await expect(fixture.store.read()).resolves.toEqual(current);
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
  });

  it('restores valid backup when current is missing and discards next', async () => {
    const fixture = await createFixture();
    const backup = createJournal('candidateRootCreated');
    await Promise.all([
      writeSlot(fixture.backupPath, backup),
      writeSlot(fixture.nextPath, createJournal('bootstrapCompleted')),
    ]);

    await expect(fixture.store.read()).resolves.toEqual(backup);
    await expect(readFile(fixture.currentPath)).resolves.toEqual(
      Buffer.from(serializeWorkspaceCreationJournal(backup)),
    );
    await expect(pathExists(fixture.backupPath)).resolves.toBe(false);
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
  });

  it('promotes a valid next slot after an interrupted first write', async () => {
    const fixture = await createFixture();
    const next = createJournal('prepared');
    await writeSlot(fixture.nextPath, next);

    await expect(fixture.store.read()).resolves.toEqual(next);
    await expect(pathExists(fixture.currentPath)).resolves.toBe(true);
    await expect(pathExists(fixture.nextPath)).resolves.toBe(false);
  });

  it('fails closed on an invalid authoritative slot', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await Promise.all([
      writeFile(fixture.currentPath, '{}\n', { mode: 0o600 }),
      writeSlot(fixture.backupPath, createJournal('prepared')),
    ]);

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
    await expect(pathExists(fixture.backupPath)).resolves.toBe(true);
  });

  it('removes only the matching terminal journal', async () => {
    const fixture = await createFixture();
    await writeAllStates(fixture.store);

    await expect(fixture.store.remove(
      operationId as WorkspaceCreationJournalV1['operationId'],
    )).resolves.toBeUndefined();
    await expect(fixture.store.read()).resolves.toBeUndefined();
  });

  it('rejects removal before registry publication or for another operation', async () => {
    const fixture = await createFixture();
    await fixture.store.write(createJournal('prepared'));
    await expect(fixture.store.remove(
      operationId as WorkspaceCreationJournalV1['operationId'],
    )).rejects.toThrow(WORKSPACE_CREATION_JOURNAL_INVALID);

    const terminalFixture = await createFixture();
    await writeAllStates(terminalFixture.store);
    await expect(terminalFixture.store.remove(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as WorkspaceCreationJournalV1['operationId'],
    )).rejects.toThrow(WORKSPACE_CREATION_JOURNAL_INVALID);
  });

  it.each([
    'prepared',
    'candidateRootCreated',
    'bootstrapCompleted',
    'candidateValidated',
  ] as const)('discards a matching %s journal before publication', async (state) => {
    const fixture = await createFixture();
    await writeThroughState(fixture.store, state);

    await expect(fixture.store.discardBeforePublication(
      operationId as WorkspaceCreationJournalV1['operationId'],
    )).resolves.toBeUndefined();
    await expect(fixture.store.read()).resolves.toBeUndefined();
  });

  it.each(['rootPublished', 'registryPublished'] as const)(
    'retains and rejects discarding a %s journal',
    async (state) => {
      const fixture = await createFixture();
      await writeThroughState(fixture.store, state);

      await expect(fixture.store.discardBeforePublication(
        operationId as WorkspaceCreationJournalV1['operationId'],
      )).rejects.toThrow(WORKSPACE_CREATION_JOURNAL_INVALID);
      await expect(fixture.store.read()).resolves.toEqual(createJournal(state));
    },
  );

  it('rejects discarding another operation journal', async () => {
    const fixture = await createFixture();
    await fixture.store.write(createJournal('prepared'));

    await expect(fixture.store.discardBeforePublication(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as WorkspaceCreationJournalV1['operationId'],
    )).rejects.toThrow(WORKSPACE_CREATION_JOURNAL_INVALID);
    await expect(fixture.store.read()).resolves.toEqual(
      createJournal('prepared'),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-creation-journal-'));
  roots.push(root);
  const installationRoot = join(root, 'workspace-operations');
  const currentPath = join(
    installationRoot,
    WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  );
  return {
    backupPath: join(
      installationRoot,
      WORKSPACE_CREATION_JOURNAL_BACKUP_FILE_NAME,
    ),
    currentPath,
    installationRoot,
    nextPath: join(
      installationRoot,
      WORKSPACE_CREATION_JOURNAL_NEXT_FILE_NAME,
    ),
    store: new WorkspaceCreationJournalStore({
      installationRoot,
      filePath: currentPath,
    }),
  };
}

async function writeAllStates(store: WorkspaceCreationJournalStore): Promise<void> {
  for (const state of [
    'prepared',
    'candidateRootCreated',
    'bootstrapCompleted',
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ] as const) {
    await store.write(createJournal(state));
  }
}

async function writeThroughState(
  store: WorkspaceCreationJournalStore,
  terminalState: WorkspaceCreationJournalState,
): Promise<void> {
  for (const state of [
    'prepared',
    'candidateRootCreated',
    'bootstrapCompleted',
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ] as const) {
    await store.write(createJournal(state));
    if (state === terminalState) return;
  }
}

async function writeSlot(path: string, journal: unknown): Promise<void> {
  await mkdir(join(path, '..'), { mode: 0o700, recursive: true });
  await writeFile(path, serializeWorkspaceCreationJournal(journal), {
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

function createJournal(
  state: WorkspaceCreationJournalState,
): Readonly<WorkspaceCreationJournalV1> {
  const hasLineage = [
    'bootstrapCompleted',
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(state);
  return {
    formatVersion: 1,
    operationId: operationId as WorkspaceCreationJournalV1['operationId'],
    workspaceId: workspaceId as WorkspaceCreationJournalV1['workspaceId'],
    workspaceLabel: 'Oma yritys',
    previousActiveWorkspaceId: null,
    state,
    createdAt: '2026-08-18T10:00:00.000Z',
    lineageIdentity: hasLineage
      ? { formatVersion: 1, profileId: 'a'.repeat(64) }
      : null,
  };
}
