import { promises as fileSystem } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  profileRestoreActivationJournalFileName,
  ProfileRestoreActivationJournalStore,
} from './profileRestoreActivationJournalStore.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat), rm: vi.fn(actual.rm) };
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(lstat).mockReset();
  vi.mocked(rm).mockReset();
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('profile restore activation journal store', () => {
  it('creates the first journal under an explicit absence grant', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    let assertions = 0;
    await fixture.store.write(journal, {
      previous: undefined,
      async assertAbsent() { assertions++; },
      async assertCurrent(current) {
        expect(Object.isFrozen(current)).toBe(true);
        expect(await fixture.store.peek()).toEqual(current);
      },
    });
    expect(assertions).toBeGreaterThan(1);
    expect(await fixture.store.peek()).toEqual(journal);
    expect(await readdir(dirname(fixture.filePath))).toEqual([profileRestoreActivationJournalFileName]);
  });

  it('retains the prepared next slot when initial authority expires after its flush', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    const first = new Error('synthetic initial grant expired');
    await expect(fixture.store.write(journal, {
      previous: undefined,
      async assertAbsent() {
        const pending = await readFile(`${fixture.filePath}.next`, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (pending === `${JSON.stringify(journal)}\n`) throw first;
      },
      async assertCurrent() {},
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: first });
    await expect(readFile(fixture.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(`${fixture.filePath}.next`, 'utf8')).toBe(`${JSON.stringify(journal)}\n`);
  });

  it('retains the first published journal when its acknowledgement loses authority', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    const first = new Error('synthetic initial acknowledgement expired');
    await expect(fixture.store.write(journal, {
      previous: undefined,
      async assertAbsent() {},
      async assertCurrent(current) {
        expect(await fixture.store.peek()).toEqual(current);
        throw first;
      },
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: first });
    expect(await fixture.store.peek()).toEqual(journal);
    expect(await readdir(dirname(fixture.filePath))).toEqual([profileRestoreActivationJournalFileName]);
  });

  it('rejects a missing selected predecessor instead of treating it as initial publication', async () => {
    const fixture = await createFixture();
    const previous = createJournal();
    await expect(fixture.store.write({ ...previous, revision: 1, phase: 'movingCurrentDatabase' }, {
      previous, async assertCurrent() {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    expect(await captureSlots(fixture.filePath)).toEqual([]);
  });

  it('rejects a non-prepared initial journal without creating any slot', async () => {
    const fixture = await createFixture();
    await expect(fixture.store.write({ ...createJournal(), revision: 1, phase: 'movingCurrentDatabase' }, {
      previous: undefined, async assertAbsent() {}, async assertCurrent() {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
    expect(await captureSlots(fixture.filePath)).toEqual([]);
  });

  it.each(['', '.next', '.backup'])('preserves a foreign %s slot under an initial absence grant', async suffix => {
    const fixture = await createFixture();
    const foreign = { ...createJournal(), operationId: '33333333-3333-4333-8333-333333333333' };
    await writeFile(`${fixture.filePath}${suffix}`, JSON.stringify(foreign));
    const before = await captureSlots(fixture.filePath);
    await expect(fixture.store.write(createJournal(), {
      previous: undefined, async assertAbsent() {}, async assertCurrent() {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it.each(['.next', '.backup'])('does not remove a foreign %s alongside an existing predecessor', async suffix => {
    const fixture = await createFixture();
    const previous = createJournal();
    await fixture.store.write(previous);
    await writeFile(`${fixture.filePath}${suffix}`, 'retain unrelated evidence');
    const before = await captureSlots(fixture.filePath);
    await expect(fixture.store.write({ ...previous, revision: 1, phase: 'movingCurrentDatabase' }, {
      previous, async assertCurrent() {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it('does not replace an initial journal when it appears during the awaited grant', async () => {
    const fixture = await createFixture();
    const foreign = { ...createJournal(), operationId: '33333333-3333-4333-8333-333333333333' };
    let injected = false;
    await expect(fixture.store.write(createJournal(), {
      previous: undefined,
      async assertAbsent() {
        if (!injected) { injected = true; await writeFile(fixture.filePath, JSON.stringify(foreign)); }
      },
      async assertCurrent() {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    expect(await readFile(fixture.filePath, 'utf8')).toBe(JSON.stringify(foreign));
    expect(await readdir(dirname(fixture.filePath))).toEqual([profileRestoreActivationJournalFileName]);
  });

  it('retains every terminal slot when authority expires during selection before removal', async () => {
    const fixture = await createFixture();
    const expected = { ...createJournal(), phase: 'accepted' as const };
    await fixture.store.write(expected);
    await writeFile(`${fixture.filePath}.next`, 'retain next');
    await writeFile(`${fixture.filePath}.backup`, 'retain backup');
    const before = await captureSlots(fixture.filePath);
    let current = true;
    const peek = fixture.store.peek.bind(fixture.store);
    vi.spyOn(fixture.store, 'peek').mockImplementation(async () => {
      const journal = await peek();
      current = false;
      return journal;
    });
    await expect(fixture.store.clear(expected, async () => {
      if (!current) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    })).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it.each(['operationId', 'revision', 'phase', 'hadActiveDatabase'] as const)(
    'does not clear a terminal journal after its %s changed', async field => {
      const fixture = await createFixture();
      const expected = { ...createJournal(), phase: 'accepted' as const };
      const changes = { operationId: '33333333-3333-4333-8333-333333333333',
        revision: expected.revision + 1, phase: 'rolledBack', hadActiveDatabase: !expected.hadActiveDatabase };
      await writeFile(fixture.filePath, JSON.stringify({ ...expected, [field]: changes[field] }));
      await writeFile(`${fixture.filePath}.next`, 'retain next');
      await writeFile(`${fixture.filePath}.backup`, 'retain backup');
      const before = await captureSlots(fixture.filePath);
      await expect(fixture.store.clear(expected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      expect(await captureSlots(fixture.filePath)).toEqual(before);
    },
  );

  it('retains the authoritative terminal slot when authority is lost during clear', async () => {
    const fixture = await createFixture();
    const expected = { ...createJournal(), phase: 'accepted' as const };
    await fixture.store.write(expected);
    await writeFile(`${fixture.filePath}.next`, 'discardable next');
    await writeFile(`${fixture.filePath}.backup`, 'retain backup');
    const primary = new Error('synthetic terminal authority lost');
    let calls = 0;
    await expect(fixture.store.clear(expected, async () => { if (++calls === 3) throw primary; }))
      .rejects.toBe(primary);
    expect(await readFile(fixture.filePath, 'utf8')).toBe(`${JSON.stringify(expected)}\n`);
    expect(await readFile(`${fixture.filePath}.backup`, 'utf8')).toBe('retain backup');
    await expect(readFile(`${fixture.filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('clears a bound terminal journal with its authoritative slot last', async () => {
    const fixture = await createFixture();
    const expected = { ...createJournal(), phase: 'rolledBack' as const };
    await fixture.store.write(expected);
    await writeFile(`${fixture.filePath}.next`, 'discardable next');
    await writeFile(`${fixture.filePath}.backup`, 'discardable backup');
    const observed: string[][] = [];
    await fixture.store.clear(expected, async () => { observed.push(await readdir(dirname(fixture.filePath))); });
    expect(observed).toHaveLength(6);
    expect(observed.every(slots => slots.includes(profileRestoreActivationJournalFileName))).toBe(true);
    expect(observed.at(-1)).toEqual([profileRestoreActivationJournalFileName]);
    expect(await readdir(dirname(fixture.filePath))).toEqual([]);
  });

  it.each(['.backup', '.next'])('does not delete an unrepaired authoritative %s during a guarded write', async suffix => {
    const fixture = await createFixture();
    const previous = createJournal();
    await writeFile(`${fixture.filePath}${suffix}`, JSON.stringify(previous));
    const before = await captureSlots(fixture.filePath);
    await expect(fixture.store.write({ ...previous, revision: 1, phase: 'movingCurrentDatabase' }, {
      previous, assertCurrent: async () => {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it('binds precommit mutations to old state and postcommit cleanup to new state', async () => {
    const fixture = await createFixture();
    const previous = createJournal();
    const next = { ...previous, revision: 1, phase: 'movingCurrentDatabase' as const };
    await fixture.store.write(previous);
    const observed: number[] = [];
    await fixture.store.write(next, { previous, async assertCurrent(expected) {
      expect(Object.isFrozen(expected)).toBe(true);
      expect(await fixture.store.peek()).toEqual(expected);
      observed.push(expected.revision);
    } });
    const firstPublished = observed.indexOf(1);
    expect(firstPublished).toBeGreaterThan(0);
    expect(observed.slice(0, firstPublished).every(revision => revision === 0)).toBe(true);
    expect(observed.slice(firstPublished).every(revision => revision === 1)).toBe(true);
    expect(observed.at(-1)).toBe(1);
    expect(await readdir(dirname(fixture.filePath))).toEqual([profileRestoreActivationJournalFileName]);
    expect(await readFile(fixture.filePath, 'utf8')).toBe(`${JSON.stringify(next)}\n`);
  });

  it('preserves promoted current and backup when postcommit authority is lost', async () => {
    const fixture = await createFixture();
    const previous = createJournal();
    const next = { ...previous, revision: 1, phase: 'movingCurrentDatabase' as const };
    await fixture.store.write(previous);
    const primary = new Error('synthetic postcommit authority lost');
    await expect(fixture.store.write(next, { previous, async assertCurrent(expected) {
      if (expected.revision === 1) throw primary;
      expect(await fixture.store.peek()).toEqual(previous);
    } })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: primary });
    expect(await fixture.store.peek()).toEqual(next);
    expect(await readFile(`${fixture.filePath}.backup`, 'utf8')).toBe(`${JSON.stringify(previous)}\n`);
  });

  it('does not compensate or erase staged evidence when authority is lost between journal renames', async () => {
    const fixture = await createFixture();
    const previous = createJournal();
    const next = { ...previous, revision: 1, phase: 'movingCurrentDatabase' as const };
    await fixture.store.write(previous);
    const primary = new Error('synthetic precommit authority lost');
    await expect(fixture.store.write(next, { previous, async assertCurrent() {
      if (!(await readdir(dirname(fixture.filePath))).includes(profileRestoreActivationJournalFileName)) throw primary;
    } })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: primary });
    expect(await readFile(`${fixture.filePath}.backup`, 'utf8')).toBe(`${JSON.stringify(previous)}\n`);
    expect(await readFile(`${fixture.filePath}.next`, 'utf8')).toBe(`${JSON.stringify(next)}\n`);
    expect(await fixture.store.peek()).toEqual(previous);
  });

  it.each(['', '.backup', '.next'])('checks current authority before repairing selected %s', async suffix => {
    const fixture = await createFixture();
    const journal = createJournal();
    await writeFile(`${fixture.filePath}${suffix}`, JSON.stringify(journal), { mode: 0o600 });
    if (suffix !== '.next') await writeFile(`${fixture.filePath}.next`, 'retain next slot');
    const before = await captureSlots(fixture.filePath);
    const primary = new Error('synthetic authority lost');
    let calls = 0;
    await expect(fixture.store.read(journal, async () => { calls++; throw primary; })).rejects.toBe(primary);
    expect(calls).toBe(1);
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it('rechecks authority immediately before deleting a lower recovery slot', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await fixture.store.write(journal);
    await writeFile(`${fixture.filePath}.backup`, 'retain backup');
    await writeFile(`${fixture.filePath}.next`, 'retain next');
    const before = await captureSlots(fixture.filePath);
    const primary = new Error('synthetic authority lost');
    let calls = 0;
    await expect(fixture.store.read(journal, async () => {
      if (++calls === 2) throw primary;
    })).rejects.toBe(primary);
    expect(calls).toBe(2);
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it('does not delete absent recovery slots or request deletion authority for them', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await fixture.store.write(journal);
    const remove = vi.mocked(rm).mockClear();
    const authority = vi.fn(async () => {});
    await expect(fixture.store.read(journal, authority)).resolves.toEqual(journal);
    expect(authority).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves a late recovery slot after its absence was observed', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await fixture.store.write(journal);
    const pending = `${fixture.filePath}.next`;
    const originalLstat = fileSystem.lstat;
    let injected = false;
    vi.mocked(lstat).mockImplementation(async (...args) => {
      try { return await originalLstat(...args); }
      catch (error) {
        if (args[0] === pending && !injected && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          injected = true;
          await writeFile(pending, 'retain late evidence');
        }
        throw error;
      }
    });
    const remove = vi.mocked(rm).mockClear();
    await expect(fixture.store.read(journal, async () => {})).resolves.toEqual(journal);
    expect(injected).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(await readFile(pending, 'utf8')).toBe('retain late evidence');
    expect(await fixture.store.peek()).toEqual(journal);
  });

  it('does not interpret a recovery-slot inspection failure as absence', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await fixture.store.write(journal);
    const originalLstat = fileSystem.lstat;
    const primary = Object.assign(new Error('synthetic inspection denied'), { code: 'EACCES' });
    vi.mocked(lstat).mockImplementation(async (...args) => {
      if (args[0] === `${fixture.filePath}.next`) throw primary;
      return originalLstat(...args);
    });
    const remove = vi.mocked(rm).mockClear();
    await expect(fixture.store.read(journal, async () => {})).rejects.toBe(primary);
    expect(remove).not.toHaveBeenCalled();
    expect(await fixture.store.peek()).toEqual(journal);
  });

  it('observes both present-slot removals behind fresh authority', async () => {
    const fixture = await createFixture();
    const journal = createJournal();
    await fixture.store.write(journal);
    await writeFile(`${fixture.filePath}.next`, 'owned pending evidence');
    await writeFile(`${fixture.filePath}.backup`, 'owned backup evidence');
    const remove = vi.mocked(rm).mockClear();
    const authority = vi.fn(async () => {});
    await expect(fixture.store.read(journal, authority)).resolves.toEqual(journal);
    expect(remove.mock.calls).toEqual([
      [`${fixture.filePath}.next`, { force: true }],
      [`${fixture.filePath}.backup`, { force: true }],
    ]);
    expect(authority).toHaveBeenCalledTimes(3);
    expect(await captureSlots(fixture.filePath)).toMatchObject([
      { name: profileRestoreActivationJournalFileName, content: Buffer.from(`${JSON.stringify(journal)}\n`).toString('base64') },
    ]);
  });

  it.each(['', '.backup', '.next'])('does not repair %s when the selected journal changed after admission', async suffix => {
    const fixture = await createFixture();
    const expected = createJournal();
    await writeFile(`${fixture.filePath}${suffix}`, JSON.stringify({
      ...expected, operationId: '33333333-3333-4333-8333-333333333333',
    }), { mode: 0o600 });
    if (suffix !== '.next') {
      await writeFile(`${fixture.filePath}.next`, 'retain uncertain next slot', { mode: 0o600 });
    }
    const before = await captureSlots(fixture.filePath);

    await expect(fixture.store.read(expected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it.each([
    ['current', ['', '.backup', '.next']],
    ['backup', ['.backup', '.next']],
    ['next', ['.next']],
  ] as const)('peeks the %s slot without promotion, removal or rewriting', async (_selected, suffixes) => {
    const fixture = await createFixture();
    for (const [index, suffix] of suffixes.entries()) {
      await writeFile(`${fixture.filePath}${suffix}`, JSON.stringify({
        ...createJournal(), revision: index,
      }), { mode: 0o600 });
    }
    const before = await captureSlots(fixture.filePath);

    const selected = await fixture.store.peek();

    expect(selected).toEqual(createJournal());
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Reflect.set(selected!, 'operationId', '33333333-3333-4333-8333-333333333333')).toBe(false);
    expect(await captureSlots(fixture.filePath)).toEqual(before);
    await expect(fixture.store.peek()).resolves.toEqual(selected);
    expect(await captureSlots(fixture.filePath)).toEqual(before);
    await expect(fixture.store.read()).resolves.toEqual(selected);
    expect(await readdir(dirname(fixture.filePath))).toEqual([profileRestoreActivationJournalFileName]);
  });

  it('peeks an absent journal without creating state', async () => {
    const fixture = await createFixture();
    const before = await captureSlots(fixture.filePath);
    await expect(fixture.store.peek()).resolves.toBeUndefined();
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it.each(['', '.backup', '.next'])('preserves invalid selected %s slot and does not fall back', async suffix => {
    const fixture = await createFixture();
    await writeFile(`${fixture.filePath}${suffix}`, 'invalid selected journal', { mode: 0o600 });
    if (suffix !== '.next') {
      await writeFile(`${fixture.filePath}.next`, JSON.stringify(createJournal()), { mode: 0o600 });
    }
    const before = await captureSlots(fixture.filePath);
    await expect(fixture.store.peek()).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

  it('keeps the existing lazy priority without touching invalid lower slots', async () => {
    const fixture = await createFixture();
    await fixture.store.write(createJournal());
    await writeFile(`${fixture.filePath}.backup`, 'invalid ignored backup', { mode: 0o600 });
    await writeFile(`${fixture.filePath}.next`, 'invalid ignored next', { mode: 0o600 });
    const before = await captureSlots(fixture.filePath);
    await expect(fixture.store.peek()).resolves.toEqual(createJournal());
    expect(await captureSlots(fixture.filePath)).toEqual(before);
  });

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

async function captureSlots(filePath: string) {
  const directory = dirname(filePath);
  const entries = (await readdir(directory)).sort();
  return Promise.all(entries.map(async name => {
    const path = join(directory, name);
    const metadata = await lstat(path, { bigint: true });
    return {
      name, content: (await readFile(path)).toString('base64'),
      dev: metadata.dev, ino: metadata.ino, size: metadata.size,
      mode: metadata.mode, nlink: metadata.nlink, mtimeNs: metadata.mtimeNs,
    };
  }));
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
