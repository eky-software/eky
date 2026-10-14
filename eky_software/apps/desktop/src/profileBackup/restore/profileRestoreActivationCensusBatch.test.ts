import { promises as fileSystem } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  profileRestoreActivationJournalFileName,
  ProfileRestoreActivationJournalStore,
} from './profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import * as cleanupCensus from './profileRestoreTerminalCleanupCensus.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

const operationId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(lstat).mockReset();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('profile restore captured census read batches', () => {
  it.each([0, 1, 7])('checks every captured entry with %i nested PDFs and drains before changing roots', async count => {
    const f = await createFixture(count);
    const before = await f.evidence();
    const check = cleanupCensus.assertProfileRestoreCleanupEntry;
    const owner = new Map(f.census.roots.flatMap(root => root.entries.map(entry => [entry, root] as const)));
    let previousRoot: unknown;
    let active = 0;
    let peak = 0;
    const inspect = vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation(async (entry, removed) => {
      if (owner.get(entry) !== previousRoot) expect(active).toBe(0);
      previousRoot = owner.get(entry);
      active += 1;
      peak = Math.max(peak, active);
      try { await check(entry, removed); }
      finally { active -= 1; }
    });
    await f.transaction.assertTerminalCleanupCensus(f.census);
    expect(inspect.mock.calls.map(([entry]) => entry)).toEqual(f.census.roots.flatMap(root => root.entries));
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(await f.evidence()).toEqual(before);
    inspect.mockRestore();
    await f.transaction.clearAccepted(f.selected);
    expect(await f.journalStore.peek()).toBeUndefined();
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('new database');
  });

  it.each(['success', 'synchronous', 'asynchronous', 'outOfOrder'] as const)(
    'settles the entire first batch before continuing or reporting %s', async mode => {
      const f = await createFixture();
      const before = await f.evidence();
      const gate = deferred();
      const firstFailure = new Error('FIRST_ENTRY_FAILED', { cause: new Error('ORIGINAL_CAUSE') });
      const laterFailure = new Error('LATER_ENTRY_FAILED');
      const check = cleanupCensus.assertProfileRestoreCleanupEntry;
      let active = 0;
      let finished = false;
      let started = 0;
      const inspect = vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation((entry, removed) => {
        const index = started++;
        if (index === 0 && mode === 'synchronous') throw firstFailure;
        if (index === 0 && mode === 'asynchronous') return Promise.reject(firstFailure);
        if (index === 1 && mode === 'outOfOrder') return Promise.reject(laterFailure);
        active += 1;
        return (async () => {
          try {
            if (index < 4) await gate.promise;
            if (index === 0 && mode === 'outOfOrder') throw firstFailure;
            await check(entry, removed);
          } finally { active -= 1; }
        })();
      });
      const peek = vi.spyOn(f.journalStore, 'peek');
      const result = f.transaction.assertTerminalCleanupCensus(f.census).then(
        () => { finished = true; return undefined; },
        (error: unknown) => { finished = true; return error; },
      );
      try {
        await vi.waitFor(() => expect(started).toBe(4));
        expect(active).toBeGreaterThan(0);
        expect(finished).toBe(false);
        expect(peek).toHaveBeenCalledTimes(1);
      } finally {
        gate.resolve();
        await result;
      }
      expect(await result).toBe(mode === 'success' ? undefined : firstFailure);
      expect(active).toBe(0);
      expect(inspect.mock.calls.map(([entry]) => entry)).toEqual(mode === 'success'
        ? f.census.roots.flatMap(root => root.entries) : f.census.roots[0]!.entries.slice(0, 4));
      expect(peek).toHaveBeenCalledTimes(mode === 'success' ? 2 : 1);
      expect(await f.evidence()).toEqual(before);
    },
  );

  it('waits for a pending directory child-list read after a sibling rejects', async () => {
    const f = await createFixture();
    const before = await f.evidence();
    const entries = f.census.roots[0]!.entries;
    const directory = entries.slice(0, 4).find(entry => entry.kind === 'directory')!;
    const rejected = entries.slice(0, 4).find(entry => entry !== directory)!;
    const failure = new Error('SIBLING_FAILED');
    const gate = deferred();
    const read = fileSystem.readdir;
    let reading = false;
    let settled = false;
    vi.spyOn(fileSystem, 'readdir').mockImplementation(async (...args) => {
      if (String(args[0]) !== directory.path) return read(...args);
      reading = true;
      try { await gate.promise; return await read(...args); }
      finally { settled = true; }
    });
    const check = cleanupCensus.assertProfileRestoreCleanupEntry;
    const inspect = vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation((entry, removed) => {
      if (entry === rejected) return Promise.reject(failure);
      return check(entry, removed);
    });
    let finished = false;
    const result = f.transaction.assertTerminalCleanupCensus(f.census).then(
      () => { finished = true; return undefined; },
      (error: unknown) => { finished = true; return error; },
    );
    try {
      await vi.waitFor(() => expect(reading).toBe(true));
      expect(finished).toBe(false);
      expect(settled).toBe(false);
      expect(inspect).toHaveBeenCalledTimes(4);
    } finally {
      gate.resolve();
      await result;
    }
    expect(await result).toBe(failure);
    expect(settled).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(4);
    expect(await f.evidence()).toEqual(before);
  });

  it('drains before a removed-entry absence check and never batches that check', async () => {
    const f = await createFixture(3);
    const entries = f.census.roots[0]!.entries;
    const removedIndex = entries.findIndex((entry, index) => entry.kind === 'file' && index % 4 !== 0);
    expect(removedIndex).toBeGreaterThan(0);
    const removedFile = entries[removedIndex]!.path;
    const preceding = entries.slice(0, removedIndex);
    const held = preceding.at(-1)!;
    const completed = new Set<string>();
    const gate = deferred();
    let waiting = false;
    await rm(removedFile);
    const before = await f.evidence();
    const check = cleanupCensus.assertProfileRestoreCleanupEntry;
    let active = 0;
    const inspect = vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation(async (entry, removed) => {
      active += 1;
      try {
        if (entry === held) { waiting = true; await gate.promise; }
        await check(entry, removed);
        completed.add(entry.path);
      }
      finally { active -= 1; }
    });
    const stat = fileSystem.lstat;
    let absentReads = 0;
    vi.mocked(lstat).mockImplementation(async (...args) => {
      if (String(args[0]) === removedFile) {
        expect(active).toBe(0);
        expect(preceding.every(entry => completed.has(entry.path))).toBe(true);
        absentReads += 1;
      }
      return stat(...args);
    });
    const result = f.transaction.assertTerminalCleanupCensus(f.census, new Set([removedFile])).then(
      () => undefined, (error: unknown) => error,
    );
    try {
      await vi.waitFor(() => expect(waiting).toBe(true));
      expect(absentReads).toBe(0);
    } finally {
      gate.resolve();
      await result;
    }
    expect(await result).toBeUndefined();
    expect(absentReads).toBe(1);
    expect(inspect.mock.calls.map(([entry]) => entry.path)).toEqual(
      f.census.roots.flatMap(root => root.entries).map(entry => entry.path).filter(path => path !== removedFile),
    );
    expect(active).toBe(0);
    expect(await f.evidence()).toEqual(before);
  });

  it('keeps an absent captured root outside entry batches', async () => {
    const f = await createFixture();
    const absent = f.census.roots[1]!;
    await rm(absent.root, { recursive: true });
    const before = await f.evidence();
    const check = cleanupCensus.assertProfileRestoreCleanupEntry;
    let active = 0;
    vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation(async (entry, removed) => {
      active += 1;
      try { await check(entry, removed); }
      finally { active -= 1; }
    });
    const assertAbsent = cleanupCensus.assertProfileRestoreCleanupRootAbsent;
    const absence = vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupRootAbsent').mockImplementation(async root => {
      expect(active).toBe(0);
      await assertAbsent(root);
    });
    await f.transaction.assertTerminalCleanupCensus(f.census, new Set([absent.root]));
    expect(absence).toHaveBeenCalledExactlyOnceWith(absent);
    expect(await f.evidence()).toEqual(before);
  });

  it('rejects a journal changed while the last partial batch settles without deleting evidence', async () => {
    const f = await createFixture();
    const before = await f.evidence();
    const last = f.census.roots.at(-1)!.entries.at(-1)!;
    const changed = { ...f.selected, revision: f.selected.revision + 1 };
    const check = cleanupCensus.assertProfileRestoreCleanupEntry;
    vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation(async (entry, removed) => {
      await check(entry, removed);
      if (entry === last) await f.journalStore.write(changed);
    });
    await expect(f.transaction.assertTerminalCleanupCensus(f.census)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await f.journalStore.peek()).toEqual(changed);
    expect(await f.evidence()).toEqual(before);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function createFixture(pdfCount = 1) {
  const root = await mkdtemp(join(tmpdir(), 'eky-census-batch-'));
  roots.push(root);
  const activeDatabasePath = join(root, 'data', 'eky.sqlite');
  const activeDocumentsRoot = join(root, 'storage', 'invoices');
  const stagingRoot = join(root, 'staging');
  const staged = join(stagingRoot, operationId);
  await mkdir(dirname(activeDatabasePath), { recursive: true });
  await mkdir(activeDocumentsRoot, { recursive: true });
  await mkdir(join(staged, 'activation', 'storage', 'invoices'), { recursive: true });
  await writeFile(activeDatabasePath, 'old database');
  await writeFile(join(staged, 'profile.sqlite'), 'new database');
  for (let index = 0; index < pdfCount; index += 1) {
    const pdf = join(activeDocumentsRoot, `invoice-${index}`, 'approved.pdf');
    await mkdir(dirname(pdf));
    await writeFile(pdf, `synthetic PDF ${index}`);
  }
  const journalStore = new ProfileRestoreActivationJournalStore(join(root, 'journal', profileRestoreActivationJournalFileName));
  const transaction = new ProfileRestoreActivationTransaction({
    journalStore,
    paths: { activeDatabasePath, activeDocumentsRoot, stagingRoot,
      rollbackRoot: join(root, 'rollback'), failedRoot: join(root, 'failed') },
  });
  await transaction.prepare(operationId);
  await transaction.advanceToValidation();
  const selected = await transaction.commitAcceptance();
  const census = await transaction.readTerminalCleanupCensus(selected);
  const evidencePaths = [activeDatabasePath, ...census.roots.flatMap(item => item.entries)
    .filter(entry => entry.kind === 'file').map(entry => entry.path)];
  const evidence = () => Promise.all(evidencePaths.map(async path => {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }));
  return { transaction, journalStore, census, selected, activeDatabasePath, evidence };
}
