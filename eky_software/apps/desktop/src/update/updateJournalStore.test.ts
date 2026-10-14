import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
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
  it('publishes from one exact selection while preserving ordinary equal-revision writes', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    const next = { ...selected, revision: 2 };
    await store.write(next, { expectedJournal: selected });
    expect(await store.readForLiveOwner()).toEqual(next);
    const timestampOnly = { ...next, updatedAt: '2026-08-11T18:01:00.000Z' };
    await store.write(timestampOnly);
    expect(await store.readForLiveOwner()).toEqual(timestampOnly);
  });

  it.each(['revision', 'package', 'missing'] as const)('retains a stale guarded selection (%s)', async change => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    const changed = change === 'revision' ? createJournal({ revision: 2 })
      : createJournal({ currentPackageIdentity: { ...selected.currentPackageIdentity, packageSha256: 'f'.repeat(64) } });
    if (change !== 'missing') await store.write(changed);
    await expect(store.write({ ...selected, revision: 2 }, { expectedJournal: selected }))
      .rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await store.readForLiveOwner()).toEqual(change === 'missing' ? undefined : changed);
  });

  it.each(['backup', 'next'] as const)('does not delete an unexpected %s slot on guarded rejection', async slot => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    await writeSlot(`${fixture.filePath}.${slot}`, { ...selected, revision: 2 });
    const currentBytes = await readFile(fixture.filePath);
    const sideBytes = await readFile(`${fixture.filePath}.${slot}`);
    await expect(store.write({ ...selected, revision: 2 }, { expectedJournal: selected }))
      .rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await readFile(fixture.filePath)).toEqual(currentBytes);
    expect(await readFile(`${fixture.filePath}.${slot}`)).toEqual(sideBytes);
  });

  it('rechecks authority after the last selected-current read before publication', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    let calls = 0;
    await expect(store.write({ ...selected, revision: 2 }, {
      expectedJournal: selected,
      assertAuthority() { if (++calls === 4) throw new Error('synthetic expired authority'); },
    })).rejects.toThrow('UPDATE_JOURNAL_UNAVAILABLE');
    expect(calls).toBe(4);
    expect(await store.readForLiveOwner()).toEqual(selected);
  });

  it.each(['async', 'reentrant'] as const)('rejects an ignored %s authority promise', async mode => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    const assertAuthority = mode === 'async'
      ? async () => { throw new Error('synthetic async authority failure'); }
      : () => store.readForLiveOwner();
    await expect(store.write({ ...selected, revision: 2 }, { expectedJournal: selected, assertAuthority }))
      .rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await store.readForLiveOwner()).toEqual(selected);
  });

  it('restores the selected current journal when authority expires after moving it', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    let moved = false;
    const expired = new Error('synthetic expired publication authority');
    const failure = await store.write({ ...selected, revision: 2 }, {
      expectedJournal: selected,
      assertAuthority() {
        if (existsSync(`${fixture.filePath}.backup`) && !existsSync(fixture.filePath)) {
          moved = true;
          throw expired;
        }
      },
    }).catch(error => error);
    expect(moved).toBe(true);
    expect(failure).toMatchObject({ message: 'UPDATE_JOURNAL_UNAVAILABLE', cause: expired });
    expect(await store.readForLiveOwner()).toEqual(selected);
    await expect(readFile(`${fixture.filePath}.backup`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${fixture.filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the published journal and backup when authority expires before backup cleanup', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    const next = { ...selected, revision: 2 };
    await store.write(selected);
    let published = false;
    const expired = new Error('synthetic expired cleanup authority');
    const failure = await store.write(next, {
      expectedJournal: selected,
      assertAuthority() {
        if (existsSync(`${fixture.filePath}.backup`) && existsSync(fixture.filePath)) {
          published = true;
          throw expired;
        }
      },
    }).catch(error => error);
    expect(failure).toMatchObject({ message: 'UPDATE_JOURNAL_UNAVAILABLE', cause: expired });
    expect(published).toBe(true);
    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual(next);
    expect(JSON.parse(await readFile(`${fixture.filePath}.backup`, 'utf8'))).toEqual(selected);
    await expect(store.readForLiveOwner()).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
  });

  it('does not publish when the selected current disappears before its move', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    let calls = 0;
    const failure = await store.write({ ...selected, revision: 2 }, {
      expectedJournal: selected,
      assertAuthority() { if (++calls === 4) unlinkSync(fixture.filePath); },
    }).catch(error => error);
    expect(failure).toMatchObject({ message: 'UPDATE_JOURNAL_CONFLICT', cause: { code: 'ENOENT' } });
    expect(await store.readForLiveOwner()).toBeUndefined();
    await expect(readFile(`${fixture.filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects queued authority loss at the publication boundary before the first move', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    let calls = 0;
    let valid = true;
    let observedMoved = false;
    const expired = new Error('synthetic queued authority loss');
    const failure = await store.write({ ...selected, revision: 2 }, {
      expectedJournal: selected,
      assertAuthority() {
        if (++calls === 4) queueMicrotask(() => { valid = false; });
        if (!valid) {
          observedMoved = existsSync(`${fixture.filePath}.backup`);
          throw expired;
        }
      },
    }).catch(error => error);
    expect(failure).toMatchObject({ message: 'UPDATE_JOURNAL_UNAVAILABLE', cause: expired });
    expect(observedMoved).toBe(false);
    expect(await store.readForLiveOwner()).toEqual(selected);
  });

  it('preserves failed compensation at the publication boundary after its original error', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    const expired = new Error('synthetic expired moved authority');
    const failure = await store.write({ ...selected, revision: 2 }, {
      expectedJournal: selected,
      assertAuthority() {
        if (existsSync(`${fixture.filePath}.backup`) && !existsSync(fixture.filePath)) {
          mkdirSync(fixture.filePath);
          throw expired;
        }
      },
    }).catch(error => error);
    expect(failure.message).toBe('UPDATE_JOURNAL_UNAVAILABLE');
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect(failure.cause.errors).toHaveLength(2);
    expect(failure.cause.errors[0]).toBe(expired);
    expect(failure.cause.errors[1]).toMatchObject({ code: expect.any(String) });
    expect(JSON.parse(await readFile(`${fixture.filePath}.backup`, 'utf8'))).toEqual(selected);
    await expect(store.readForLiveOwner()).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
  });

  it('rejects another same-instance writer throughout guarded publication', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    const selected = createJournal();
    await store.write(selected);
    let competing: Promise<void> | undefined;
    let calls = 0;
    await store.write({ ...selected, revision: 2 }, {
      expectedJournal: selected,
      assertAuthority() {
        if (++calls === 4) competing = expect(store.write({ ...selected, revision: 3 }))
          .rejects.toThrow('UPDATE_JOURNAL_BUSY');
      },
    });
    expect(competing).toBeDefined();
    await competing;
    expect(await store.readForLiveOwner()).toEqual({ ...selected, revision: 2 });
  });

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

  it('reads the live current journal without creating missing slots', async () => {
    const fixture = await createFixture();
    const store = new UpdateJournalStore(fixture.filePath);
    await expect(store.readForLiveOwner()).resolves.toBeUndefined();
    const journal = createJournal();
    await store.write(journal);
    const before = await readFile(fixture.filePath);
    await expect(store.readForLiveOwner()).resolves.toEqual(journal);
    expect(await readFile(fixture.filePath)).toEqual(before);
  });

  it.each([true, false])(
    'preserves every recovery slot instead of authorizing a live owner (current=%s)',
    async (hasCurrent) => {
      const fixture = await createFixture();
      if (hasCurrent) await writeSlot(fixture.filePath, createJournal({ revision: 3 }));
      await writeSlot(`${fixture.filePath}.backup`, createJournal());
      await writeSlot(`${fixture.filePath}.next`, createJournal({ revision: 2 }));
      const paths = [
        ...(hasCurrent ? [fixture.filePath] : []),
        `${fixture.filePath}.backup`, `${fixture.filePath}.next`,
      ];
      const before = await Promise.all(paths.map((path) => readFile(path)));
      await expect(new UpdateJournalStore(fixture.filePath).readForLiveOwner())
        .rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
      expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before);
      if (!hasCurrent) await expect(readFile(fixture.filePath))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
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
