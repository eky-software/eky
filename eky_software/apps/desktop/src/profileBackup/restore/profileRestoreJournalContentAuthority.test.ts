import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertProfileRestoreActivationJournalMatches,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import {
  ProfileRestoreActivationJournalStore,
  profileRestoreActivationJournalFileName,
  type ProfileRestoreJournalWriteAuthority,
} from './profileRestoreActivationJournalStore.js';

const roots: string[] = [];
const previous: ProfileRestoreActivationJournal = {
  formatVersion: 1, operationId: '11111111-1111-4111-8111-111111111111',
  phase: 'prepared', revision: 0, hadActiveDatabase: true, hadActiveDocuments: true,
};
const next: ProfileRestoreActivationJournal = { ...previous, phase: 'movingCurrentDatabase', revision: 1 };
const contentBoundaries = ['publishNext', 'discardPrevious'] as const;
const preparationStates = ['beforeNext', 'openedNext', 'writtenNext'] as const;
const bytes = (journal: ProfileRestoreActivationJournal) => `${JSON.stringify(journal)}\n`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('journal content mutation authority', () => {
  it('checks content before publication and predecessor removal while retaining selection checks', async () => {
    const f = await createFixture();
    await f.store.write(next, f.authority);
    expect(f.contentCalls).toBe(contentBoundaries.length);
    expect(f.selectionCalls).toBeGreaterThan(f.contentCalls);
    expect(await f.store.peek()).toEqual(next);
    expect(await readdir(dirname(f.file))).toEqual([profileRestoreActivationJournalFileName]);
  });

  it.each(contentBoundaries)('rejects changed same-size content at %s and retains evidence', async boundary => {
    const f = await createFixture();
    f.beforeContent = async count => {
      if (count === contentBoundaries.indexOf(boundary) + 1) await writeFile(f.payload, 'CHANGED!');
    };
    await expect(f.store.write(next, f.authority)).rejects.toMatchObject({ cause: f.contentFailure });
    expect(await readFile(f.payload, 'utf8')).toBe('CHANGED!');
    if (boundary === 'discardPrevious') {
      expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(previous));
      expect(await f.store.peek()).toEqual(next);
    } else expect(await f.store.peek()).toEqual(previous);
  });

  it.each([1, 2])('rejects stale ownership after awaited content gate %s', async count => {
    const f = await createFixture();
    f.afterContent = async current => { if (current === count) f.owned = false; };
    await expect(f.store.write(next, f.authority)).rejects.toMatchObject({ cause: f.ownerFailure });
    expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(previous));
  });

  it.each(preparationStates)('retains journal bytes when ownership expires at %s', async state => {
    const f = await createFixture();
    let retained: (string | undefined)[] | undefined;
    f.beforeSelection = async () => {
      if (retained !== undefined || !matchesPreparation(state, await optionalRead(f.file + '.next'))) return;
      retained = await Promise.all([f.file, f.file + '.next', f.file + '.backup'].map(optionalRead));
      f.owned = false;
    };
    await expect(f.store.write(next, f.authority)).rejects.toMatchObject({ cause: f.ownerFailure });
    expect(retained).toBeDefined();
    expect(await Promise.all([f.file, f.file + '.next', f.file + '.backup'].map(optionalRead))).toEqual(retained);
    expect(f.contentCalls).toBe(0);
    expect(await readFile(f.payload, 'utf8')).toBe('original');
  });

  it.each(preparationStates)('detects content changed during %s before publication', async state => {
    const f = await createFixture();
    let injected = false;
    f.beforeSelection = async () => {
      if (injected || !matchesPreparation(state, await optionalRead(f.file + '.next'))) return;
      injected = true;
      await writeFile(f.payload, 'CHANGED!');
    };
    await expect(f.store.write(next, f.authority)).rejects.toMatchObject({ cause: f.contentFailure });
    expect(injected).toBe(true);
    expect(f.contentCalls).toBe(1);
    expect(await optionalRead(f.file)).toBeUndefined();
    expect(await readFile(f.file + '.next', 'utf8')).toBe(bytes(next));
    expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(previous));
    expect(await f.store.peek()).toEqual(previous);
    expect(await readFile(f.payload, 'utf8')).toBe('CHANGED!');
  });

  it.each(['operationId', 'revision', 'hadActiveDatabase'] as const)(
    'rejects changed predecessor %s after content verification', async field => {
      const f = await createFixture();
      const changed = { ...previous, [field]: {
        operationId: '22222222-2222-4222-8222-222222222222', revision: 4, hadActiveDatabase: false,
      }[field] };
      f.afterContent = async count => { if (count === 1) await writeFile(f.file + '.backup', bytes(changed)); };
      await expect(f.store.write(next, f.authority)).rejects.toThrow();
      expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(changed));
      expect(f.contentCalls).toBe(1);
    },
  );

  it('rereads pending journal bytes after the publication content check', async () => {
    const f = await createFixture();
    const foreign = { ...next, revision: 7 };
    f.afterContent = async count => { if (count === 1) await writeFile(f.file + '.next', bytes(foreign)); };
    await expect(f.store.write(next, f.authority)).rejects.toThrow();
    expect(await readFile(f.file + '.next', 'utf8')).toBe(bytes(foreign));
    expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(previous));
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a changed backup after publication rather than deleting it', async () => {
    const f = await createFixture();
    const foreign = { ...previous, hadActiveDocuments: false };
    f.afterContent = async count => { if (count === 2) await writeFile(f.file + '.backup', bytes(foreign)); };
    await expect(f.store.write(next, f.authority)).rejects.toThrow();
    expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(foreign));
    expect(await readFile(f.file, 'utf8')).toBe(bytes(next));
  });

  it.each(['missingContent', 'unknownKind', 'missingPredecessor'] as const)(
    'rejects malformed separate authority %s before filesystem mutation', async fault => {
      const f = await createFixture();
      const authority = { ...f.authority,
        ...(fault === 'missingContent' ? { assertContent: undefined } : {}),
        ...(fault === 'unknownKind' ? { kind: 'unknown' } : {}),
        ...(fault === 'missingPredecessor' ? { previous: undefined } : {}),
      } as unknown as ProfileRestoreJournalWriteAuthority;
      await expect(f.store.write(next, authority)).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
      expect(await readdir(dirname(f.file))).toEqual([profileRestoreActivationJournalFileName]);
      expect(await readFile(f.file, 'utf8')).toBe(bytes(previous));
    },
  );

  it.each(['combined', 'separateContent'] as const)(
    'preserves changed opened next bytes for %s authority', async kind => {
      const f = await createFixture();
      const foreign = bytes({ ...next, operationId: '22222222-2222-4222-8222-222222222222' });
      expect(foreign.length).toBe(bytes(next).length);
      let injected = false;
      const inject = async () => {
        if (injected || (await optionalRead(f.file + '.next')) !== '') return;
        injected = true;
        await writeFile(f.file + '.next', foreign);
      };
      if (kind === 'separateContent') f.beforeSelection = inject;
      const authority: ProfileRestoreJournalWriteAuthority = kind === 'separateContent' ? f.authority : {
        previous, async assertCurrent(current) { await inject(); await f.authority.assertCurrent(current); },
      };
      await expect(f.store.write(next, authority)).rejects.toThrow();
      expect(injected).toBe(true);
      expect(await readFile(f.file + '.next', 'utf8')).toBe(foreign);
      expect(await readFile(f.file, 'utf8')).toBe(bytes(previous));
    },
  );

  it('rejects a replaced empty next path without writing either file', async () => {
    const f = await createFixture();
    const retained = join(dirname(f.payload), 'retained-next');
    let injected = false;
    f.beforeSelection = async () => {
      if (injected || await optionalRead(f.file + '.next') !== '') return;
      injected = true;
      await rename(f.file + '.next', retained);
      await writeFile(f.file + '.next', '', { flag: 'wx' });
    };
    await expect(f.store.write(next, f.authority)).rejects.toThrow();
    expect(injected).toBe(true);
    expect(await readFile(f.file + '.next', 'utf8')).toBe('');
    expect(await readFile(retained, 'utf8')).toBe('');
    expect(await f.store.peek()).toEqual(previous);
  });

  it.each(['combined', 'separateContent'] as const)(
    'retains backup when next reappears under %s authority', async kind => {
      const f = await createFixture();
      const foreign = bytes({ ...next, revision: 7 });
      let injected = false;
      const inject = async () => {
        if (injected || await optionalRead(f.file) !== bytes(next) ||
            await optionalRead(f.file + '.backup') !== bytes(previous)) return;
        injected = true;
        await writeFile(f.file + '.next', foreign, { flag: 'wx' });
      };
      if (kind === 'separateContent') f.afterContent = async count => { if (count === 2) await inject(); };
      const authority: ProfileRestoreJournalWriteAuthority = kind === 'separateContent' ? f.authority : {
        previous, async assertCurrent(current) { await inject(); await f.authority.assertCurrent(current); },
      };
      await expect(f.store.write(next, authority)).rejects.toThrow();
      expect(injected).toBe(true);
      expect(await readFile(f.file + '.next', 'utf8')).toBe(foreign);
      expect(await readFile(f.file + '.backup', 'utf8')).toBe(bytes(previous));
      expect(await readFile(f.file, 'utf8')).toBe(bytes(next));
    },
  );
});

function matchesPreparation(state: typeof preparationStates[number], pending: string | undefined): boolean {
  if (state === 'beforeNext') return pending === undefined;
  return pending === (state === 'openedNext' ? '' : bytes(next));
}

async function optionalRead(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-journal-content-'));
  roots.push(root);
  const file = join(root, 'journal', profileRestoreActivationJournalFileName);
  const payload = join(root, 'synthetic-content');
  await mkdir(dirname(file), { mode: 0o700 });
  await writeFile(payload, 'original');
  const store = new ProfileRestoreActivationJournalStore(file);
  await store.write(previous);
  const fixture = {
    file, payload, store, owned: true, contentCalls: 0, selectionCalls: 0,
    contentFailure: new Error('synthetic content changed'), ownerFailure: new Error('synthetic owner expired'),
    beforeContent: async (_count: number) => {}, afterContent: async (_count: number) => {},
    beforeSelection: async () => {},
    authority: {
      kind: 'separateContent' as const, previous,
      async assertCurrent(current: Readonly<ProfileRestoreActivationJournal>) {
        fixture.selectionCalls++;
        await fixture.beforeSelection();
        if (!fixture.owned) throw fixture.ownerFailure;
        assertProfileRestoreActivationJournalMatches(current, await store.peek());
        if (!fixture.owned) throw fixture.ownerFailure;
      },
      async assertContent() {
        fixture.contentCalls++;
        await fixture.beforeContent(fixture.contentCalls);
        if (hash(await readFile(payload, 'utf8')) !== hash('original')) throw fixture.contentFailure;
        await fixture.afterContent(fixture.contentCalls);
      },
    },
  };
  return fixture;
}
