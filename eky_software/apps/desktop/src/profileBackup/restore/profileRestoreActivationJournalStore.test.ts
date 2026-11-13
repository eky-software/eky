import { promises as fileSystem } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../../workspaces/persistence/crashSafeFileSlot.js';

import {
  profileRestoreActivationJournalFileName,
  ProfileRestoreActivationJournalStore,
} from './profileRestoreActivationJournalStore.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open), rm: vi.fn(actual.rm) };
});

afterEach(context => {
  vi.restoreAllMocks();
  vi.mocked(lstat).mockReset();
  vi.mocked(open).mockReset();
  vi.mocked(rm).mockReset();
  const owned = roots.splice(0);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') for (const root of owned) await rm(root, { force: true, recursive: true });
  });
});

describe('profile restore activation journal store', () => {
  it.each([1, 2, 3])('checks synchronous authority at journal-clear syscall %s and retains the later slots', async boundary => {
    const f = await createFixture();
    const journal = createJournal();
    const bytes = `${JSON.stringify(journal)}\n`;
    const paths = [`${f.filePath}.next`, `${f.filePath}.backup`, f.filePath];
    for (const path of paths) await writeFile(path, bytes);
    const first = new Error('SYNTHETIC_MUTATION_REVOKED');
    let checks = 0;
    const full = vi.fn(async () => {});
    await expect(f.store.clear(journal, full, () => { if (++checks === boundary) throw first; })).rejects.toBe(first);
    expect(full).toHaveBeenCalledTimes(boundary * 2);
    for (const [index, path] of paths.entries()) {
      if (index < boundary - 1) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await readFile(path, 'utf8')).toBe(bytes);
    }
  });

  it.each(['currentNext', 'currentBackup', 'backup', 'next', 'backupNext'] as const)(
    'retains evidence when final repair authority expires (%s)', async scenario => {
      const f = await createFixture();
      const journal = createJournal();
      const bytes = `${JSON.stringify(journal)}\n`;
      const paths = scenario === 'currentNext' ? [f.filePath, `${f.filePath}.next`]
        : scenario === 'currentBackup' ? [f.filePath, `${f.filePath}.backup`]
          : scenario === 'backupNext' ? [`${f.filePath}.backup`, `${f.filePath}.next`]
            : [`${f.filePath}.${scenario}`];
      for (const path of paths) await writeFile(path, bytes);
      const first = new Error('SYNTHETIC_MUTATION_REVOKED');
      let calls = 0; let allowed = true;
      const boundary = scenario === 'backupNext' ? 2 : 1;
      await expect(f.store.read(journal, async () => { if (++calls === boundary) allowed = false; },
        () => { if (!allowed) throw first; })).rejects.toBe(first);
      if (scenario === 'backupNext') {
        expect(await readFile(f.filePath, 'utf8')).toBe(bytes);
        expect(await readFile(`${f.filePath}.next`, 'utf8')).toBe(bytes);
      } else for (const path of paths) expect(await readFile(path, 'utf8')).toBe(bytes);
    },
  );

  it.each((['clear', 'read'] as const).flatMap(method => ['resolved', 'rejected', 'value'].map(result => ({ method, result }))))(
    'rejects a $result mutation guard before the $method syscall', async ({ method, result }) => {
    const f = await createFixture();
    const journal = createJournal();
    const bytes = `${JSON.stringify(journal)}\n`;
    await writeFile(f.filePath, bytes); await writeFile(`${f.filePath}.next`, bytes);
    const guard = () => result === 'resolved' ? Promise.resolve()
      : result === 'rejected' ? Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD')) : true;
    await expect(f.store[method](journal, async () => {}, guard))
      .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readFile(f.filePath, 'utf8')).toBe(bytes);
    expect(await readFile(`${f.filePath}.next`, 'utf8')).toBe(bytes);
    },
  );

  it.each(['clear', 'read'] as const)('rejects an incomplete scoped %s authority before mutation', async method => {
    const f = await createFixture();
    const journal = createJournal();
    await writeFile(f.filePath, `${JSON.stringify(journal)}\n`);
    await expect(f.store[method](journal, undefined, () => {})).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
    expect(await f.store.peek()).toEqual(journal);
  });

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

  it.each([
    ['current', ['']], ['backup', ['.backup']], ['next', ['.next']],
    ['current', ['', '.backup']], ['current', ['', '.next']],
    ['backup', ['.backup', '.next']], ['current', ['', '.backup', '.next']],
  ] as const)('observes the normal %s source and every slot identity without repair %#', async (source, suffixes) => {
    const f = await createFixture();
    const bytes = Buffer.from(JSON.stringify(createJournal()) + '\n');
    for (const suffix of suffixes) await writeFile(f.filePath + suffix, bytes, { flag: 'wx' });
    const before = await captureSlots(f.filePath);
    const observed = await f.store.inspectRecoverySelection(() => {});
    expect(observed.source).toBe(source);
    expect(Buffer.from(observed.bytes!)).toEqual(bytes);
    expect(observed.value).toEqual(await f.store.peek());
    expect(Object.isFrozen(observed)).toBe(true); expect(Object.isFrozen(observed.value)).toBe(true);
    expect(Object.isFrozen(observed.identities)).toBe(true);
    for (const [slot, suffix] of [['current', ''], ['backup', '.backup'], ['next', '.next']] as const) {
      if (suffixes.some(value => value === suffix)) {
        expect(observed.identities[slot]?.size).toBe(bytes.length);
        expect(observed.identities[slot]?.ino).not.toBe(0);
      } else expect(observed.identities[slot]).toBeUndefined();
    }
    expect(Object.keys(observed)).not.toContain('recover');
    expect(await captureSlots(f.filePath)).toEqual(before);
    await expect(f.store.read()).resolves.toEqual(observed.value);
    expect(await readdir(dirname(f.filePath))).toEqual([profileRestoreActivationJournalFileName]);
  });

  it.each(['torn', 'empty', 'oversized', 'foreignOperation'] as const)(
    'observes a valid current source without parsing the %s discarded siblings', async kind => {
      const f = await createFixture(), bytes = Buffer.from(JSON.stringify(createJournal()));
      const discarded = kind === 'torn' ? Buffer.from('{') : kind === 'empty' ? Buffer.alloc(0)
        : kind === 'oversized' ? Buffer.alloc(1024 * 1024, 32)
          : Buffer.from(JSON.stringify({ ...createJournal(), operationId: '33333333-3333-4333-8333-333333333333' }));
      await writeFile(f.filePath, bytes, { flag: 'wx' });
      for (const suffix of ['.backup', '.next']) await writeFile(f.filePath + suffix, discarded, { flag: 'wx' });
      const before = await captureSlots(f.filePath);
      const result = await f.store.inspectRecoverySelection(() => {});
      expect(result.source).toBe('current'); expect(result.value).toEqual(await f.store.peek());
      expect(result.identities.backup?.size).toBe(discarded.length);
      expect(result.identities.next?.size).toBe(discarded.length);
      expect(await captureSlots(f.filePath)).toEqual(before);
    },
  );

  it.each(['empty', 'oversized', 'malformed', 'bom', 'unknownField'] as const)(
    'preserves the normal selected-source rejection for %s without fallback', async kind => {
      const f = await createFixture();
      const valid = Buffer.from(JSON.stringify(createJournal()));
      const invalid = kind === 'empty' ? Buffer.alloc(0) : kind === 'oversized' ? Buffer.alloc(1024 * 1024, 32)
        : kind === 'malformed' ? Buffer.from('{') : kind === 'bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid])
          : Buffer.from(JSON.stringify({ ...createJournal(), unknown: true }));
      await writeFile(f.filePath, invalid, { flag: 'wx' }); await writeFile(f.filePath + '.backup', valid, { flag: 'wx' });
      const before = await captureSlots(f.filePath);
      await expect(f.store.peek()).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
      if (kind === 'malformed' || kind === 'bom') {
        // Observation retains the original parser cause; ordinary recovery keeps its safe code.
        await expect(f.store.inspectRecoverySelection(() => {})).rejects.toBeInstanceOf(SyntaxError);
      } else await expect(f.store.inspectRecoverySelection(() => {})).rejects.toThrow();
      expect(await captureSlots(f.filePath)).toEqual(before);
    },
  );

  it('observes missing state without creating files and retains current parser duplicate-key semantics', async () => {
    const f = await createFixture();
    const absent = await f.store.inspectRecoverySelection(() => {});
    expect(absent).toEqual({ source: undefined, bytes: undefined, value: undefined,
      identities: { current: undefined, backup: undefined, next: undefined } });
    expect(await readdir(dirname(f.filePath))).toEqual([]);
    await rm(dirname(f.filePath), { recursive: true });
    expect(await f.store.inspectRecoverySelection(() => {})).toEqual(absent);
    await expect(readdir(dirname(f.filePath))).rejects.toMatchObject({ code: 'ENOENT' });
    await mkdir(dirname(f.filePath), { mode: 0o700 });
    await writeFile(f.filePath, JSON.stringify(createJournal()).replace('"revision":0', '"revision":1,"revision":0'), { flag: 'wx' });
    const before = await captureSlots(f.filePath);
    expect((await f.store.inspectRecoverySelection(() => {})).value).toEqual(await f.store.peek());
    expect(await captureSlots(f.filePath)).toEqual(before);
  });

  it('waits for an owned source read to settle, preserves its first error and releases only read admission', async context => {
    const f = await createFixture(), bytes = Buffer.from(JSON.stringify(createJournal()));
    await writeFile(f.filePath, bytes, { flag: 'wx' });
    const fs = createNodeCrashSafeFileSlotFileSystem({ directoryPath: dirname(f.filePath), currentPath: f.filePath,
      backupPath: f.filePath + '.backup', nextPath: f.filePath + '.next' }, 64 * 1024);
    const store = new ProfileRestoreActivationJournalStore(f.filePath, fs);
    const first = new Error('SYNTHETIC_OBSERVATION_REVOKED'), later = new Error('SYNTHETIC_LATER_READ_FAILURE');
    let release!: () => void, entered!: () => void, current = true;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { entered = resolve; });
    const read = fs.readSlot.bind(fs);
    vi.spyOn(fs, 'readSlot').mockImplementationOnce(async (...args) => {
      const value = await read(...args); entered(); await hold;
      if (!current) throw first;
      return value;
    });
    const pending = store.inspectRecoverySelection(() => { context.signal.throwIfAborted(); if (!current) throw later; });
    void pending.catch(() => {});
    context.onTestFinished(async () => { release(); await Promise.allSettled([pending]); });
    await began;
    await expect(store.inspectDeletionSlots(() => {})).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
    current = false; expect(settled).toBe(false); release();
    await expect(pending).rejects.toBe(first);
    expect(await readFile(f.filePath)).toEqual(bytes);
    current = true;
    await expect(store.inspectRecoverySelection(() => {})).resolves.toMatchObject({ source: 'current', value: createJournal() });
  });

  it('closes the real held source handle before rejecting observation after cancellation', async context => {
    const f = await createFixture(), bytes = Buffer.from(JSON.stringify(createJournal()));
    await writeFile(f.filePath, bytes, { flag: 'wx' });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const events: string[] = [], first = new Error('SYNTHETIC_HELD_FILE_OBSERVATION_CLOSED');
    let release!: () => void, entered!: () => void, current = true;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      events.push('opened');
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      vi.spyOn(handle, 'read').mockImplementationOnce(async (...readArgs) => {
        events.push('reading'); entered(); await gate;
        const result = await read(...readArgs); events.push('readSettled'); return result;
      });
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); events.push('handleClosed'); });
      return handle;
    });
    const pending = f.store.inspectRecoverySelection(() => { context.signal.throwIfAborted(); if (!current) throw first; })
      .catch(cause => { events.push('rejected'); throw cause; });
    void pending.catch(() => {});
    context.onTestFinished(async () => { release(); await Promise.allSettled([pending]); });
    await began; current = false;
    expect(events).toEqual(['opened', 'reading']);
    await expect(f.store.inspectDeletionSlots(() => {})).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    release(); await expect(pending).rejects.toBe(first);
    expect(events).toEqual(['opened', 'reading', 'readSettled', 'handleClosed', 'rejected']);
    expect(await readFile(f.filePath)).toEqual(bytes);
  });

  it.each(['sourceIdentity', 'sideAppears'] as const)('rejects %s drift after the actual observed source read', async change => {
    const f = await createFixture(), bytes = Buffer.from(JSON.stringify(createJournal()));
    await writeFile(f.filePath, bytes, { flag: 'wx' });
    const fs = createNodeCrashSafeFileSlotFileSystem({ directoryPath: dirname(f.filePath), currentPath: f.filePath,
      backupPath: f.filePath + '.backup', nextPath: f.filePath + '.next' }, 64 * 1024);
    const store = new ProfileRestoreActivationJournalStore(f.filePath, fs), read = fs.readSlot.bind(fs);
    vi.spyOn(fs, 'readSlot').mockImplementationOnce(async (...args) => {
      const value = await read(...args);
      if (change === 'sourceIdentity') { await rename(f.filePath, f.filePath + '.retained'); await writeFile(f.filePath, bytes, { flag: 'wx' }); }
      else await writeFile(f.filePath + '.next', bytes, { flag: 'wx' });
      return value;
    });
    await expect(store.inspectRecoverySelection(() => {})).rejects.toThrow();
    expect(await readFile(f.filePath)).toEqual(bytes);
    expect(await readFile(f.filePath + (change === 'sourceIdentity' ? '.retained' : '.next'))).toEqual(bytes);
  });

  it.each(['before', 'afterIdentity'] as const)('rejects revoked observation authority %s source I/O', async boundary => {
    const f = await createFixture(), bytes = Buffer.from(JSON.stringify(createJournal()));
    await writeFile(f.filePath, bytes, { flag: 'wx' });
    const fs = createNodeCrashSafeFileSlotFileSystem({ directoryPath: dirname(f.filePath), currentPath: f.filePath,
      backupPath: f.filePath + '.backup', nextPath: f.filePath + '.next' }, 64 * 1024);
    const store = new ProfileRestoreActivationJournalStore(f.filePath, fs), read = vi.spyOn(fs, 'readSlot');
    const first = new Error('SYNTHETIC_SOURCE_OBSERVATION_EXPIRED'); let current = boundary !== 'before';
    const inspect = fs.inspectSlotIdentity!.bind(fs);
    vi.spyOn(fs, 'inspectSlotIdentity').mockImplementationOnce(async (...args) => {
      const value = await inspect(...args); current = false; return value;
    });
    await expect(store.inspectRecoverySelection(() => { if (!current) throw first; })).rejects.toBe(first);
    expect(read).not.toHaveBeenCalled(); expect(await readFile(f.filePath)).toEqual(bytes);
  });

  it.each(['resolved', 'rejected', 'value'] as const)('rejects a %s asynchronous or non-void observation guard before I/O', async kind => {
    const f = await createFixture(); await writeFile(f.filePath, JSON.stringify(createJournal()), { flag: 'wx' });
    const before = await captureSlots(f.filePath);
    const guard = () => kind === 'resolved' ? Promise.resolve() : kind === 'rejected'
      ? Promise.reject(new Error('SYNTHETIC_ASYNC_OBSERVATION')) : true;
    await expect(f.store.inspectRecoverySelection(guard)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await captureSlots(f.filePath)).toEqual(before);
  });

  it('keeps the exact selected-source byte limit aligned with normal peek', async () => {
    const f = await createFixture(), limit = 64 * 1024;
    const bytes = Buffer.alloc(limit, 32); Buffer.from(JSON.stringify(createJournal())).copy(bytes);
    await writeFile(f.filePath, bytes, { flag: 'wx' });
    expect((await f.store.inspectRecoverySelection(() => {})).value).toEqual(await f.store.peek());
    await writeFile(f.filePath, Buffer.concat([bytes, Buffer.from(' ')]));
    await expect(f.store.peek()).rejects.toThrow();
    await expect(f.store.inspectRecoverySelection(() => {})).rejects.toThrow();
    expect(await readFile(f.filePath)).toEqual(Buffer.concat([bytes, Buffer.from(' ')]));
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
