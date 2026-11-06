import { promises as fileSystem } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileRestoreActivationJournalStore,
  profileRestoreActivationJournalFileName,
  type ProfileRestoreJournalCreateAuthority,
} from './profileRestoreActivationJournalStore.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), chmod: vi.fn(actual.chmod),
    open: vi.fn(actual.open), rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const roots: string[] = [];
const boundaries = ['mkdir', 'chmodDirectory', 'openNext', 'writeNext', 'chmodNext', 'publishNext'] as const;

afterEach(context => {
  vi.restoreAllMocks();
  vi.mocked(mkdir).mockReset();
  vi.mocked(chmod).mockReset();
  vi.mocked(open).mockReset();
  vi.mocked(rename).mockReset();
  vi.mocked(rm).mockReset();
  const owned = roots.splice(0);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') {
      for (const root of owned) await fileSystem.rm(root, { force: true, recursive: true });
    }
  });
});

describe('restore journal creation ownership', () => {
  it.each(boundaries.map((name, index) => ({ name, boundary: index + 1 })))(
    'stops the actual creation mutation before $name when its last guard rejects', async ({ boundary }) => {
      const f = await fixture();
      const first = new Error('SYNTHETIC_CREATION_OWNER_REVOKED');
      let guards = 0;
      await expect(f.store.write(f.journal, { previous: undefined,
        async assertAbsent() {}, async assertCurrent() {},
        assertMutationCurrent() { if (++guards === boundary) throw first; },
      })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: first });
      expect(guards).toBe(boundary);
      expect(f.mutations).toEqual(boundaries.slice(0, boundary - 1));
      expect(f.closed).toBe(boundary >= 4);
      expect(await slots(f)).toEqual(boundary <= 3 ? {} : { next: boundary === 4 ? '' : bytes(f.journal) });
      expect(rm).not.toHaveBeenCalled();
    },
  );

  it.each(['replace', 'remove'] as const)('pins creation callbacks, receiver and absence before a late %s', async change => {
    const f = await fixture();
    const foreign = vi.fn(() => { throw new Error('SYNTHETIC_FOREIGN_CALLBACK'); });
    const current = vi.fn(async function (this: ProfileRestoreJournalCreateAuthority, journal: unknown) {
      expect(this).toBe(authority); expect(journal).toEqual(f.journal);
    });
    const mutation = vi.fn(function (this: ProfileRestoreJournalCreateAuthority) { expect(this).toBe(authority); });
    const authority: ProfileRestoreJournalCreateAuthority = { previous: undefined,
      async assertAbsent() {
        expect(this).toBe(authority);
        Object.assign(authority, { previous: { ...f.journal, revision: 99 }, assertAbsent: foreign, assertCurrent: foreign });
        if (change === 'replace') Object.assign(authority, { assertMutationCurrent: foreign });
        else Reflect.deleteProperty(authority, 'assertMutationCurrent');
      },
      assertCurrent: current, assertMutationCurrent: mutation,
    };
    await f.store.write(f.journal, authority);
    expect(mutation).toHaveBeenCalledTimes(boundaries.length);
    expect(current).toHaveBeenCalledTimes(2);
    expect(foreign).not.toHaveBeenCalled();
    expect(f.mutations).toEqual(boundaries);
    expect(await slots(f)).toEqual({ current: bytes(f.journal) });
  });

  it.each(['absent', 'current', 'mutation', 'contentKind', 'unknownKind', 'writeContext'] as const)(
    'rejects malformed guarded creation %s before filesystem work', async field => {
      const f = await fixture();
      const authority = { previous: undefined, async assertAbsent() {}, async assertCurrent() {}, assertMutationCurrent() {} };
      if (field === 'absent') Object.assign(authority, { assertAbsent: null });
      if (field === 'current') Object.assign(authority, { assertCurrent: null });
      if (field === 'mutation') Object.assign(authority, { assertMutationCurrent: null });
      if (field === 'contentKind') Object.assign(authority, { kind: 'separateContent', async assertContent() {} });
      if (field === 'unknownKind') Object.assign(authority, { kind: 'foreign' });
      if (field === 'writeContext') Object.assign(authority, { writeContext: { async assertReadCurrent() {}, assertMutationCurrent() {} } });
      await expect(f.store.write(f.journal, authority)).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
      expect(f.mutations).toEqual([]);
      expect(open).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(await slots(f)).toEqual({});
    },
  );

  it.each(['resolved', 'rejected', 'pending', 'value'] as const)(
    'rejects a %s non-synchronous creation guard without an unhandled rejection', async result => {
      const f = await fixture(); const pending = gate(); const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        await expect(f.store.write(f.journal, { previous: undefined, async assertAbsent() {}, async assertCurrent() {},
          assertMutationCurrent: () => result === 'resolved' ? Promise.resolve()
            : result === 'rejected' ? Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD'))
              : result === 'pending' ? pending.promise : true,
        })).rejects.toMatchObject({ cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' } });
        pending.resolve(); await setImmediate();
        expect(f.mutations).toEqual([]); expect(unhandled).not.toHaveBeenCalled();
        expect(await slots(f)).toEqual({});
      } finally { pending.resolve(); process.off('unhandledRejection', unhandled); }
    },
  );

  it.each([false, true])('joins an original close after guard failure and preserves the first cause (close failure: %s)', async closeFails => {
    const f = await fixture(); const finish = gate();
    const first = new Error('SYNTHETIC_FIRST_CREATION_FAILURE');
    const secondary = new Error('SYNTHETIC_CREATION_CLOSE_FAILURE');
    f.closeGate = finish.promise;
    if (closeFails) f.closeFailure = secondary;
    let guards = 0; let settled = false;
    const work = f.store.write(f.journal, { previous: undefined, async assertAbsent() {}, async assertCurrent() {},
      assertMutationCurrent() { if (++guards === 4) throw first; },
    }).then(() => undefined, (error: unknown) => error).finally(() => { settled = true; });
    try {
      await Promise.race([f.closeEntered.promise, work.then(() => { throw new Error('CREATION_CLOSE_NOT_ENTERED'); })]);
      await setImmediate();
      expect(settled).toBe(false); expect(f.closed).toBe(false);
      expect(f.mutations).toEqual(boundaries.slice(0, 3));
      expect(await slots(f)).toEqual({ next: '' });
    } finally { finish.resolve(); await work; }
    const error = await work;
    expect(error).toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE',
      cause: closeFails ? { errors: [first, secondary] } : first });
    const cause = (error as Error).cause;
    if (closeFails) {
      expect(cause).toBeInstanceOf(AggregateError);
      expect((cause as AggregateError).errors[0]).toBe(first);
      expect((cause as AggregateError).errors[1]).toBe(secondary);
    } else expect(cause).toBe(first);
    expect(f.closed).toBe(true); expect(guards).toBe(4);
    expect(f.mutations).toEqual(boundaries.slice(0, 3));
    expect(await slots(f)).toEqual({ next: '' }); expect(rm).not.toHaveBeenCalled();
  });

  it('rejects revocation during the original close before chmod or publication', async () => {
    const f = await fixture(); const finish = gate(); const first = new Error('SYNTHETIC_LATE_CREATION_REVOKED');
    f.closeGate = finish.promise;
    let current = true; let settled = false;
    const work = f.store.write(f.journal, { previous: undefined, async assertAbsent() {}, async assertCurrent() {},
      assertMutationCurrent() { if (!current) throw first; },
    }).then(() => undefined, (error: unknown) => error).finally(() => { settled = true; });
    try {
      await Promise.race([f.closeEntered.promise, work.then(() => { throw new Error('CREATION_CLOSE_NOT_ENTERED'); })]);
      current = false; await setImmediate();
      expect(settled).toBe(false); expect(f.closed).toBe(false);
      expect(f.mutations).toEqual(boundaries.slice(0, 4));
    } finally { finish.resolve(); await work; }
    expect(await work).toMatchObject({ cause: first }); expect(f.closed).toBe(true);
    expect(f.mutations).toEqual(boundaries.slice(0, 4));
    expect(await slots(f)).toEqual({ next: bytes(f.journal) }); expect(rm).not.toHaveBeenCalled();
  });

  it('preserves published bytes and the first rejected acknowledgement', async () => {
    const f = await fixture(); const first = new Error('SYNTHETIC_CREATION_ACKNOWLEDGEMENT_LOST');
    const guard = vi.fn();
    await expect(f.store.write(f.journal, { previous: undefined, async assertAbsent() {},
      async assertCurrent() { throw first; }, assertMutationCurrent: guard,
    })).rejects.toMatchObject({ cause: first });
    expect(guard).toHaveBeenCalledTimes(boundaries.length); expect(f.closed).toBe(true);
    expect(f.mutations).toEqual(boundaries);
    expect(await slots(f)).toEqual({ current: bytes(f.journal) }); expect(rm).not.toHaveBeenCalled();
  });

  it('keeps legacy creation timing and ignores a late-added sync port', async () => {
    const f = await fixture(); const foreign = vi.fn(() => { throw new Error('SYNTHETIC_LATE_PORT'); });
    let ticks = 0; let generation = 0; const seen: number[] = [];
    const originalOpen = vi.mocked(open).getMockImplementation()!;
    vi.mocked(open).mockImplementation(async (...args) => {
      if (args[0] === f.nextPath && args[1] === 'wx') seen.push(ticks);
      return originalOpen(...args);
    });
    const authority: ProfileRestoreJournalCreateAuthority = { previous: undefined,
      async assertAbsent() {
        Object.assign(authority, { assertMutationCurrent: foreign });
        ticks = 0; const selected = ++generation;
        const step = () => { if (selected !== generation || ticks === 4) return; ticks++; queueMicrotask(step); };
        queueMicrotask(step);
      },
      async assertCurrent() {},
    };
    await f.store.write(f.journal, authority);
    expect(seen).toEqual([2]); expect(foreign).not.toHaveBeenCalled();
    expect(await slots(f)).toEqual({ current: bytes(f.journal) });
  });

  it('keeps authority-free creation available to legacy callers', async () => {
    const f = await fixture();
    await f.store.write(f.journal);
    expect(await f.store.peek()).toEqual(f.journal); expect(f.closed).toBe(true);
    expect(await slots(f)).toEqual({ current: bytes(f.journal) });
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-journal-create-owner-')); roots.push(root);
  const path = join(root, 'state', profileRestoreActivationJournalFileName);
  const f = {
    path, nextPath: `${path}.next`, store: new ProfileRestoreActivationJournalStore(path),
    journal: { formatVersion: 1 as const, operationId: '11111111-1111-4111-8111-111111111111',
      phase: 'prepared' as const, revision: 0, hadActiveDatabase: true, hadActiveDocuments: true },
    mutations: [] as string[], closed: false, closeEntered: gate(),
    closeGate: undefined as Promise<void> | undefined, closeFailure: undefined as Error | undefined,
  };
  vi.mocked(mkdir).mockImplementation(async (...args) => { f.mutations.push('mkdir'); return fileSystem.mkdir(...args); });
  vi.mocked(chmod).mockImplementation(async (...args) => {
    f.mutations.push(args[0] === f.nextPath ? 'chmodNext' : 'chmodDirectory');
    return fileSystem.chmod(...args);
  });
  vi.mocked(rename).mockImplementation(async (...args) => { f.mutations.push('publishNext'); return fileSystem.rename(...args); });
  vi.mocked(open).mockImplementation(async (...args) => {
    if (args[0] === f.nextPath && args[1] === 'wx') f.mutations.push('openNext');
    const handle = await fileSystem.open(...args);
    if (args[0] === f.nextPath && args[1] === 'wx') {
      const write = handle.writeFile.bind(handle); const close = handle.close.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async (...writeArgs) => {
        f.mutations.push('writeNext'); return write(...writeArgs);
      });
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        f.closeEntered.resolve(); if (f.closeGate !== undefined) await f.closeGate;
        await close(); f.closed = true;
        if (f.closeFailure !== undefined) throw f.closeFailure;
      });
    }
    return handle;
  });
  return f;
}

async function slots(f: Awaited<ReturnType<typeof fixture>>) {
  const result: Record<string, string> = {};
  for (const [name, suffix] of [['current', ''], ['next', '.next'], ['backup', '.backup']] as const) {
    try { result[name] = await readFile(f.path + suffix, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return result;
}

function bytes(value: unknown) { return `${JSON.stringify(value)}\n`; }

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
