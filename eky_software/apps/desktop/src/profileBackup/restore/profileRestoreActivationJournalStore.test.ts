import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  profileRestoreActivationJournalFileName,
  ProfileRestoreActivationJournalStore,
} from './profileRestoreActivationJournalStore.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('profile restore activation journal store', () => {
  it('round-trips a strict journal and clears every recovery slot', async () => {
    const fixture = await createFixture();
    const journal = createJournal();

    await fixture.store.write(journal);

    await expect(fixture.store.read()).resolves.toEqual(journal);
    await fixture.store.clear();
    await expect(fixture.store.read()).resolves.toBeUndefined();
  });

  it.each([
    'null',
    JSON.stringify({
      ...createJournal(),
      unknown: true,
    }),
    JSON.stringify({
      ...createJournal(),
      operationId: null,
    }),
    JSON.stringify({
      ...createJournal(),
      phase: 'rawPathMoved',
    }),
  ])('rejects malformed or widened journal input', async (content) => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, content, 'utf8');

    await expect(fixture.store.read()).rejects.toThrow(
      'PROFILE_RESTORE_JOURNAL_INVALID',
    );
  });

  it('recovers the previous durable phase after an interrupted replacement', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await fixture.store.write(journal);
    await rename(fixture.filePath, `${fixture.filePath}.backup`);
    await writeFile(
      `${fixture.filePath}.next`,
      `${JSON.stringify({
        ...journal,
        phase: 'movingCurrentDatabase',
        revision: 1,
      })}\n`,
      'utf8',
    );

    await expect(fixture.store.read()).resolves.toEqual(journal);
  });
});

function createJournal() {
  return {
    formatVersion: 1 as const,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId,
    phase: 'prepared' as const,
    revision: 0,
  };
}

async function createFixture(): Promise<{
  filePath: string;
  store: ProfileRestoreActivationJournalStore;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-restore-journal-'));
  roots.push(root);
  const stateRoot = join(root, 'profile-restore-state');
  await mkdir(stateRoot, { mode: 0o700, recursive: true });
  const filePath = join(
    stateRoot,
    profileRestoreActivationJournalFileName,
  );
  return {
    filePath,
    store: new ProfileRestoreActivationJournalStore(filePath),
  };
}
