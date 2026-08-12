import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { UpdateJournal } from './updateJournal.js';
import {
  updateJournalFileName,
  UpdateJournalStore,
} from './updateJournalStore.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('update journal store', () => {
  it('writes and reads the exact validated journal', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const journal = createJournal();
    await store.write(journal);
    await expect(store.read()).resolves.toEqual(journal);
    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual(
      journal,
    );
  });

  it('recovers a validated backup after interruption before replacement', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await writeSlot(`${fixture.filePath}.backup`, journal);
    await writeSlot(`${fixture.filePath}.next`, {
      ...journal,
      revision: 2,
      state: 'failed',
      updatedAt: '2026-08-11T18:01:00.000Z',
    });

    await expect(new UpdateJournalStore(fixture.filePath).read()).resolves.toEqual(
      journal,
    );
    await expect(readFile(`${fixture.filePath}.next`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('promotes a validated next slot only when current and backup are absent', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await writeSlot(`${fixture.filePath}.next`, journal);
    await expect(new UpdateJournalStore(fixture.filePath).read()).resolves.toEqual(
      journal,
    );
    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual(
      journal,
    );
  });

  it('fails closed on a corrupt current slot instead of hiding it with backup', async () => {
    const fixture = await createFixture();
    await mkdir(dirname(fixture.filePath), { recursive: true });
    await writeFile(fixture.filePath, '{');
    await writeSlot(`${fixture.filePath}.backup`, createJournal());
    await expect(new UpdateJournalStore(fixture.filePath).read()).rejects.toThrow(
      'UPDATE_JOURNAL_INVALID',
    );
  });

  it('rejects stale revisions and a second simultaneous operation', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    await store.write(createJournal({ revision: 2 }));
    await expect(store.write(createJournal())).rejects.toThrow(
      'UPDATE_JOURNAL_CONFLICT',
    );

    const reads = [store.read(), store.read()];
    const results = await Promise.allSettled(reads);
    expect(results.some(
      (result) => result.status === 'rejected' &&
        result.reason instanceof Error &&
        result.reason.message === 'UPDATE_JOURNAL_BUSY',
    )).toBe(true);
  });

  it('allows only an identical idempotent write at the current revision', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const journal = createJournal({ revision: 2 });
    await store.write(journal);

    await expect(store.write(journal)).resolves.toBeUndefined();
    await expect(
      store.write({
        ...journal,
        state: 'failed',
        updatedAt: '2026-08-11T18:01:00.000Z',
      }),
    ).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    await expect(store.read()).resolves.toEqual(journal);
  });

  it('clears current and interrupted recovery slots', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await writeSlot(fixture.filePath, journal);
    await writeSlot(`${fixture.filePath}.next`, journal);
    await writeSlot(`${fixture.filePath}.backup`, journal);
    const store = new UpdateJournalStore(fixture.filePath);
    await store.clear();
    await expect(store.read()).resolves.toBeUndefined();
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-update-journal-'));
  roots.push(root);
  return { filePath: join(root, 'runtime', updateJournalFileName), root };
}

async function writeSlot(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function createJournal(
  overrides: Partial<UpdateJournal> = {},
): UpdateJournal {
  return {
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
    handoffAttemptCount: 0,
    releaseChannel: 'pilot',
    revision: 1,
    state: 'prepared',
    targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:00:00.000Z',
    ...overrides,
  };
}
