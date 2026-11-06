import { promises as fileSystem } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileRestoreActivationJournalStore,
  profileRestoreActivationJournalFileName,
  type ProfileRestoreJournalWriteAuthority,
} from './profileRestoreActivationJournalStore.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat) };
});

const roots: string[] = [];
afterEach(context => {
  vi.restoreAllMocks();
  vi.mocked(open).mockReset();
  vi.mocked(lstat).mockReset();
  const owned = roots.splice(0);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') for (const root of owned) await rm(root, { recursive: true, force: true });
  });
});

const boundaries = ['mkdir', 'chmodDirectory', 'openNext', 'writeNext', 'chmodNext', 'movePrevious', 'publishNext', 'removePrevious'] as const;

describe('scoped restore journal write ownership', () => {
  it.each(boundaries.map((name, index) => ({ name, boundary: index + 1 })))(
    'checks full combined authority and retains exact evidence before $name', async ({ boundary }) => {
      const f = await fixture(); const first = new Error('SYNTHETIC_COMBINED_OWNER_REVOKED');
      let full = 0; let last = 0; let mutations = 0; let reads = 0;
      await expect(f.store.write(f.next, f.combined({
        async assertCurrent(journal) { expect(await f.store.peek()).toEqual(journal); full++; },
        assertMutationCurrent() {
          expect(full).toBeGreaterThan(last); last = full;
          if (++mutations === boundary) throw first;
        },
        writeContext: { async assertReadCurrent(journal) { reads++; expect(await f.store.peek()).toEqual(journal); },
          assertMutationCurrent() {} },
      }))).rejects.toMatchObject({ cause: first });
      expect(mutations).toBe(boundary); expect(reads).toBeGreaterThan(0);
      expect(await slots(f)).toEqual(expectedBefore(f, boundary));
    },
  );

  it('keeps combined read guards separate from all mutation grants and the final acknowledgement', async () => {
    const f = await fixture(); let full = 0; let last = 0; let mutations = 0; let reads = 0;
    const revisions: number[] = [];
    await f.store.write(f.next, f.combined({
      async assertCurrent(journal) { full++; revisions.push(journal.revision); expect(await f.store.peek()).toEqual(journal); },
      assertMutationCurrent() { expect(full).toBeGreaterThan(last); last = full; mutations++; },
      writeContext: { async assertReadCurrent(journal) { reads++; expect(await f.store.peek()).toEqual(journal); },
        assertMutationCurrent() {} },
    }));
    expect(mutations).toBe(8); expect(full).toBeLessThanOrEqual(16); expect(reads).toBeGreaterThan(full);
    expect(revisions).toContain(f.next.revision);
    expect(await slots(f)).toEqual({ current: bytes(f.next) });
  });

  it.each(['implicit', 'create', 'missingLive', 'missingRead', 'missingMutation', 'content'] as const)(
    'rejects the malformed combined %s context before mutation', async kind => {
      const f = await fixture(); const before = await slots(f); const authority = f.combined();
      if (kind === 'implicit') Reflect.deleteProperty(authority, 'kind');
      if (kind === 'create') Object.assign(authority, { previous: undefined, async assertAbsent() {} });
      if (kind === 'missingLive') Reflect.deleteProperty(authority, 'assertMutationCurrent');
      if (kind === 'missingRead') Object.assign(authority, { writeContext: { assertMutationCurrent() {} } });
      if (kind === 'missingMutation') Object.assign(authority, { writeContext: { async assertReadCurrent() {} } });
      if (kind === 'content') Object.assign(authority, { async assertContent() {} });
      await expect(f.store.write(f.next, authority)).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
      expect(await slots(f)).toEqual(before);
    },
  );

  it.each(['current', 'next', 'backup', 'openedIdentity'] as const)(
    'rejects a combined %s replacement during full authority', async slot => {
      const f = await fixture(); let mutation = 0; let changed = false;
      const boundary = slot === 'current' ? 2 : slot === 'next' ? 6 : slot === 'backup' ? 8 : 4;
      const foreign = { ...f.previous, operationId: '33333333-3333-4333-8333-333333333333' };
      let retained: Record<string, string> | undefined;
      await expect(f.store.write(f.next, f.combined({
        async assertCurrent() {
          if (changed || mutation + 1 !== boundary) return;
          changed = true;
          if (slot === 'openedIdentity') {
            await rename(f.nextPath, `${f.nextPath}.retained`); await writeFile(f.nextPath, '');
          } else await writeFile(slot === 'current' ? f.path : slot === 'next' ? f.nextPath : f.backupPath, bytes(foreign));
          retained = await slots(f);
        },
        assertMutationCurrent() { mutation++; },
      }))).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
      expect(changed).toBe(true); expect(mutation).toBe(boundary - 1);
      expect(await slots(f)).toEqual(retained);
    },
  );

  it('rejects changed combined selection before the next mutation following cheap reads', async () => {
    const f = await fixture(); const first = new Error('SYNTHETIC_COMBINED_SELECTION_CHANGED');
    let changed = false; const mutation = vi.fn();
    await expect(f.store.write(f.next, f.combined({
      async assertCurrent() { if (changed) throw first; }, assertMutationCurrent: mutation,
      writeContext: { async assertReadCurrent() { changed = true; }, assertMutationCurrent() {} },
    }))).rejects.toMatchObject({ cause: first });
    expect(mutation).not.toHaveBeenCalled(); expect(await slots(f)).toEqual(expectedBefore(f, 1));
  });

  it.each(boundaries.map((name, index) => ({ name, boundary: index + 1 })))(
    'retains live-terminal evidence when the last guard fails before $name', async ({ boundary }) => {
      const f = await fixture(); const first = new Error('SYNTHETIC_LIVE_OWNER_REVOKED'); let calls = 0;
      await expect(f.store.write(f.next, { previous: f.previous, async assertCurrent() {},
        assertMutationCurrent() { if (++calls === boundary) throw first; },
      })).rejects.toMatchObject({ cause: first });
      expect(calls).toBe(boundary); expect(await slots(f)).toEqual(expectedBefore(f, boundary));
    },
  );

  it.each(['combined', 'separateContent'] as const)('pins a %s live guard and callbacks before the first await', async kind => {
    const f = await fixture(); const foreign = vi.fn(() => { throw new Error('SYNTHETIC_FOREIGN_GUARD'); });
    const guard = vi.fn(); const content = vi.fn(async () => {});
    const authority: ProfileRestoreJournalWriteAuthority = { kind, previous: f.previous, assertMutationCurrent: guard,
      async assertCurrent() { Object.assign(authority, { assertMutationCurrent: foreign, assertCurrent: foreign,
        assertContent: foreign, previous: { ...f.previous, revision: 999 } }); },
      ...(kind === 'separateContent' ? { assertContent: content } : {}),
    } as ProfileRestoreJournalWriteAuthority;
    await f.store.write(f.next, authority);
    expect(guard).toHaveBeenCalledTimes(8); expect(foreign).not.toHaveBeenCalled();
    expect(content).toHaveBeenCalledTimes(kind === 'separateContent' ? 2 : 0);
    expect(await slots(f)).toEqual({ current: bytes(f.next) });
  });

  it('requires both cold and live guards when supplied together', async () => {
    const f = await fixture(); const first = new Error('SYNTHETIC_LIVE_GUARD'); const cold = vi.fn();
    await expect(f.store.write(f.next, { ...f.authority({ writeContext: {
      async assertReadCurrent() {}, assertMutationCurrent: cold,
    } }), assertMutationCurrent() { throw first; } })).rejects.toMatchObject({ cause: first });
    expect(cold).toHaveBeenCalledOnce(); expect(await slots(f)).toEqual(expectedBefore(f, 1));
  });

  it.each([null, 1, () => Promise.resolve(), () => Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD'))])(
    'rejects a malformed or asynchronous live mutation guard', async guard => {
      const f = await fixture(); const before = await slots(f);
      await expect(f.store.write(f.next, { previous: f.previous, async assertCurrent() {}, assertMutationCurrent: guard as never }))
        .rejects.toThrow();
      expect(await slots(f)).toEqual(before);
    },
  );

  it.each(['combined', 'separateContent'] as const)('does not add a microtask before next-slot open for legacy %s', async kind => {
    const f = await fixture(); let ticks = 0; let generation = 0;
    const seen: number[] = [];
    vi.mocked(open).mockImplementation(async (...args) => {
      if (args[0] === f.nextPath && args[1] === 'wx') seen.push(ticks);
      return fileSystem.open(...args);
    });
    const assertCurrent = async () => {
      ticks = 0; const selected = ++generation;
      const step = () => {
        if (selected !== generation || ticks === 4) return;
        ticks++; queueMicrotask(step);
      };
      queueMicrotask(step);
    };
    await f.store.write(f.next, kind === 'combined' ? { previous: f.previous, assertCurrent }
      : { kind, previous: f.previous, assertCurrent, async assertContent() {} });
    expect(seen).toEqual([2]);
    expect(await slots(f)).toEqual({ current: bytes(f.next) });
  });

  it('keeps fresh grants at all mutations and content at publication and removal', async () => {
    const f = await fixture();
    const grants: number[] = [];
    const content: number[] = [];
    let reads = 0; let full = 0; let lastGrant = 0;
    await f.store.write(f.next, f.authority({
      async assertCurrent(journal) {
        expect(await f.store.peek()).toEqual(journal);
        expect(Object.isFrozen(journal)).toBe(true);
        full++;
      },
      async assertContent(journal) { content.push(journal.revision); },
      writeContext: {
        async assertReadCurrent(journal) { reads++; expect(await f.store.peek()).toEqual(journal); },
        assertMutationCurrent() { expect(full).toBeGreaterThan(lastGrant); lastGrant = full; grants.push(full); },
      },
    }));
    expect(grants).toHaveLength(boundaries.length);
    expect(content).toEqual([f.previous.revision, f.next.revision]);
    expect(reads).toBeGreaterThan(full);
    expect(full).toBeLessThanOrEqual(16);
    expect(await slots(f)).toEqual({ current: bytes(f.next) });
  });

  it.each(boundaries.map((name, index) => ({ name, boundary: index + 1 })))(
    'retains exact evidence when the final grant fails before $name', async ({ boundary }) => {
      const f = await fixture();
      const first = new Error('SYNTHETIC_MUTATION_REVOKED');
      let mutations = 0;
      await expect(f.store.write(f.next, f.authority({ writeContext: {
        async assertReadCurrent() {},
        assertMutationCurrent() { if (++mutations === boundary) throw first; },
      } }))).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: first });
      expect(mutations).toBe(boundary);
      expect(await slots(f)).toEqual(expectedBefore(f, boundary));
    },
  );

  it.each(['resolved', 'rejected', 'value'] as const)('rejects a %s asynchronous or non-void guard before mutation', async result => {
    const f = await fixture(); const before = await slots(f);
    await expect(f.store.write(f.next, f.authority({ writeContext: {
      async assertReadCurrent() {},
      assertMutationCurrent: () => result === 'resolved' ? Promise.resolve()
        : result === 'rejected' ? Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD')) : true,
    } }))).rejects.toMatchObject({ cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' } });
    expect(await slots(f)).toEqual(before);
  });

  it.each(['null', 'missingRead', 'missingMutation', 'combined', 'create'] as const)(
    'rejects the malformed %s context before file work', async kind => {
      const f = await fixture(); const before = await slots(f);
      const authority = f.authority();
      if (kind === 'null') Object.assign(authority, { writeContext: null });
      if (kind === 'missingRead') Object.assign(authority, { writeContext: { assertMutationCurrent() {} } });
      if (kind === 'missingMutation') Object.assign(authority, { writeContext: { async assertReadCurrent() {} } });
      if (kind === 'combined') Object.assign(authority, { kind: 'combined' });
      if (kind === 'create') Object.assign(authority, { previous: undefined, async assertAbsent() {} });
      await expect(f.store.write(f.next, authority)).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
      expect(await slots(f)).toEqual(before);
    },
  );

  it.each(['current', 'next', 'backup', 'openedIdentity'] as const)(
    'rejects a %s change during full authority and preserves the changed evidence', async slot => {
      const f = await fixture(); let mutation = 0; let changed = false;
      const boundary = slot === 'current' ? 2 : slot === 'next' ? 6 : slot === 'backup' ? 8 : 4;
      const foreign = { ...f.previous, operationId: '33333333-3333-4333-8333-333333333333' };
      let retained: Record<string, string> | undefined;
      await expect(f.store.write(f.next, f.authority({
        async assertCurrent() {
          if (changed || mutation + 1 !== boundary) return;
          changed = true;
          if (slot === 'openedIdentity') {
            await rename(f.nextPath, `${f.nextPath}.retained`);
            await writeFile(f.nextPath, '');
          } else await writeFile(slot === 'current' ? f.path : slot === 'next' ? f.nextPath : f.backupPath, bytes(foreign));
          retained = await slots(f);
        },
        writeContext: { async assertReadCurrent() {}, assertMutationCurrent() { mutation++; } },
      }))).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
      expect(changed).toBe(true);
      expect(mutation).toBe(boundary - 1);
      expect(await slots(f)).toEqual(retained);
    },
  );

  it('checks changed external selection at the next mutation after readonly work', async () => {
    const f = await fixture(); let changed = false;
    const first = new Error('SYNTHETIC_SELECTION_CHANGED');
    const mutate = vi.fn();
    await expect(f.store.write(f.next, f.authority({
      async assertCurrent() { if (changed) throw first; },
      writeContext: { async assertReadCurrent() { changed = true; }, assertMutationCurrent: mutate },
    }))).rejects.toMatchObject({ cause: first });
    expect(mutate).not.toHaveBeenCalled(); expect(await slots(f)).toEqual(expectedBefore(f, 1));
  });

  it.each([0, 1])('retains evidence on content rejection at revision %s', async revision => {
    const f = await fixture(); const first = new Error('SYNTHETIC_CONTENT_REJECTED');
    await expect(f.store.write(f.next, f.authority({
      async assertContent(journal) { if (journal.revision === revision) throw first; },
    }))).rejects.toMatchObject({ cause: first });
    expect(await slots(f)).toEqual(expectedBefore(f, revision === 0 ? 7 : 8));
  });

  it.each(['replace', 'remove', 'add'] as const)('pins callbacks and optional-context absence before a late %s', async change => {
    const f = await fixture(); const foreign = vi.fn(async () => { throw new Error('FOREIGN_CALLBACK'); });
    let changed = false; let mutations = 0;
    const authority = f.authority({ async assertCurrent() {
      if (changed) return;
      changed = true;
      if (change === 'remove') Reflect.deleteProperty(authority, 'writeContext');
      else Object.assign(authority, { writeContext: { assertReadCurrent: foreign, assertMutationCurrent: foreign } });
      if (change !== 'add') {
        authority.assertCurrent = foreign; authority.assertContent = foreign;
        Object.assign(authority, { previous: { ...f.previous, revision: 90 } });
      }
    }, writeContext: { async assertReadCurrent() {}, assertMutationCurrent() { mutations++; } } });
    if (change === 'add') Reflect.deleteProperty(authority, 'writeContext');
    await f.store.write(f.next, authority);
    expect(foreign).not.toHaveBeenCalled();
    expect(mutations).toBe(change === 'add' ? 0 : 8);
    expect(await slots(f)).toEqual({ current: bytes(f.next) });
  });

  it('does not mutate when the final slot read loses the captured owner', async () => {
    const f = await fixture(); let full = false; let current = true;
    const first = new Error('SYNTHETIC_OWNER_EXPIRED');
    vi.mocked(lstat).mockImplementation(async (...args) => {
      try { return await fileSystem.lstat(...args); }
      finally { if (full && args[0] === f.nextPath) current = false; }
    });
    await expect(f.store.write(f.next, f.authority({
      async assertCurrent() { full = true; },
      writeContext: { async assertReadCurrent() {}, assertMutationCurrent() { if (!current) throw first; } },
    }))).rejects.toMatchObject({ cause: first });
    expect(current).toBe(false); expect(await slots(f)).toEqual(expectedBefore(f, 1));
  });

  it.each(['separateContent', 'combined'] as const)('settles an opened %s handle after a delayed full check fails, without masking the first cause', async kind => {
    const f = await fixture(); const fullGate = deferred(); const closeGate = deferred();
    const fullEntered = deferred(); const closeEntered = deferred();
    const first = new Error('SYNTHETIC_FIRST_FAILURE');
    let mutation = 0; let settled = false;
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await fileSystem.open(...args);
      if (args[0] === f.nextPath && args[1] === 'wx') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          closeEntered.resolve(); await closeGate.promise; await close();
        });
      }
      return handle;
    });
    const authority = kind === 'combined' ? f.combined : f.authority;
    const work = f.store.write(f.next, authority({
      async assertCurrent() { if (mutation === 3) { fullEntered.resolve(); await fullGate.promise; throw first; } },
      writeContext: { async assertReadCurrent() {}, assertMutationCurrent() { mutation++; } },
    })).then(() => undefined, error => error).finally(() => { settled = true; });
    try {
      await fullEntered.promise;
      expect(settled).toBe(false); fullGate.resolve();
      await closeEntered.promise;
      expect(settled).toBe(false); expect(mutation).toBe(3);
      closeGate.resolve();
      expect(await work).toMatchObject({ cause: first });
      expect(await slots(f)).toEqual(expectedBefore(f, 4));
    } finally { fullGate.resolve(); closeGate.resolve(); await work; }
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function bytes(value: unknown) { return `${JSON.stringify(value)}\n`; }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-journal-write-owner-')); roots.push(root);
  const state = join(root, 'state'); await mkdir(state, { mode: 0o700 });
  const path = join(state, profileRestoreActivationJournalFileName);
  const previous = { formatVersion: 1 as const, hadActiveDatabase: true, hadActiveDocuments: true,
    operationId: '11111111-1111-4111-8111-111111111111', phase: 'validationStarting' as const, revision: 0 };
  const next = { ...previous, phase: 'rollbackStarting' as const, revision: 1 };
  await writeFile(path, bytes(previous));
  const store = new ProfileRestoreActivationJournalStore(path);
  type ScopedAuthority = Extract<ProfileRestoreJournalWriteAuthority, { kind: 'separateContent' }>;
  const authority = (overrides: Partial<ScopedAuthority> = {}): ScopedAuthority => ({
    kind: 'separateContent', previous, async assertCurrent() {}, async assertContent() {},
    writeContext: { async assertReadCurrent() {}, assertMutationCurrent() {} }, ...overrides,
  });
  type CombinedAuthority = ProfileRestoreJournalWriteAuthority & { kind: 'combined' };
  const combined = (overrides: Partial<CombinedAuthority> = {}): CombinedAuthority => ({
    kind: 'combined', previous, async assertCurrent() {}, assertMutationCurrent() {},
    writeContext: { async assertReadCurrent() {}, assertMutationCurrent() {} }, ...overrides,
  });
  return { path, nextPath: `${path}.next`, backupPath: `${path}.backup`, previous, next, store, authority, combined };
}

function expectedBefore(f: Awaited<ReturnType<typeof fixture>>, boundary: number) {
  if (boundary <= 3) return { current: bytes(f.previous) };
  if (boundary === 4) return { current: bytes(f.previous), '.next': '' };
  if (boundary <= 6) return { current: bytes(f.previous), '.next': bytes(f.next) };
  if (boundary === 7) return { '.backup': bytes(f.previous), '.next': bytes(f.next) };
  return { current: bytes(f.next), '.backup': bytes(f.previous) };
}

async function slots(f: Awaited<ReturnType<typeof fixture>>) {
  const entries = (await readdir(dirname(f.path))).sort();
  return Object.fromEntries(await Promise.all(entries.map(async name => [
    name === profileRestoreActivationJournalFileName ? 'current' : name.slice(profileRestoreActivationJournalFileName.length),
    await readFile(join(dirname(f.path), name), 'utf8'),
  ])));
}
