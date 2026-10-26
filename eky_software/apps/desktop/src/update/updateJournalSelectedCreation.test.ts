import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { parseUpdateJournal } from './updateJournal.js';
import { UpdateJournalStore, updateJournalFileName } from './updateJournalStore.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(process, 'platform', platform); });
const journal = parseUpdateJournal({
  formatVersion: 1, correlationId: '11111111-1111-4111-8111-111111111111', state: 'prepared', revision: 1,
  currentVersion: '0.1.0', targetVersion: '0.2.0', releaseChannel: 'pilot', handoffAttemptCount: 0,
  createdAt: '2026-10-25T12:00:00.000Z', updatedAt: '2026-10-25T12:00:00.000Z',
  currentPackageIdentity: { buildRevision: 'a'.repeat(40), msiProductVersion: '0.1.0', packageSha256: 'a'.repeat(64), packageSize: 1024 },
  candidatePackageIdentity: { buildRevision: 'b'.repeat(40), msiProductVersion: '0.2.0', packageSha256: 'b'.repeat(64), packageSize: 2048 },
});
const bytes = Buffer.from(`${JSON.stringify(journal)}\n`);

async function fixture(context: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), 'eky-journal-selection-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass') await fs.rm(root, { recursive: true, force: true });
  });
  const path = join(root, 'state', updateJournalFileName);
  return { path, root, store: new UpdateJournalStore(path), assertAuthority: vi.fn(() => {}) };
}

describe('selected initial journal publication', () => {
  it('copies into a genuinely empty store and confirms the exact published value', async context => {
    const f = await fixture(context);
    await f.store.createSelected(journal, f.assertAuthority);
    expect(await fs.readFile(f.path)).toEqual(bytes);
    await f.store.confirmSelected({ expectedBytes: bytes, assertAuthority: f.assertAuthority });
    await expect(f.store.confirmSelected({ expectedBytes: Buffer.from('{}'), assertAuthority: f.assertAuthority }))
      .rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await fs.readFile(f.path)).toEqual(bytes);
  });

  it.for(['', '.next', '.backup'] as const)('refuses an existing $0 slot without deleting it', async (slot, context) => {
    const f = await fixture(context);
    await fs.mkdir(dirname(f.path), { mode: 0o700 });
    await fs.writeFile(`${f.path}${slot}`, bytes);
    await expect(f.store.createSelected(journal, f.assertAuthority)).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await fs.readFile(`${f.path}${slot}`)).toEqual(bytes);
  });

  it('rejects an asynchronous authority assertion before creating files', async context => {
    const f = await fixture(context);
    await expect(f.store.createSelected(journal, async () => {})).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    await expect(fs.lstat(dirname(f.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains a partially written slot and the first failure when handle close also fails', async context => {
    const f = await fixture(context);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const first = new Error('synthetic write failed');
    const closing = new Error('synthetic close failed');
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actual.open(...args);
      return new Proxy(file, { get(target, key) {
        if (key === 'writeFile') return async () => { await file.writeFile('{partial'); throw first; };
        if (key === 'close') return async () => { await file.close(); throw closing; };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    const failure = await f.store.createSelected(journal, f.assertAuthority).catch(error => error);
    expect(failure.message).toBe('UPDATE_JOURNAL_UNAVAILABLE');
    expect(failure.cause.errors).toEqual([first, closing]);
    expect(failure.cause.cause).toBe(first);
    expect(await fs.readFile(`${f.path}.next`, 'utf8')).toBe('{partial');
    await expect(fs.lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects replacement of the owned next file even with identical bytes', async context => {
    const f = await fixture(context);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actual.open(...args);
      return new Proxy(file, { get(target, key) {
        if (key === 'close') return async () => {
          await file.close();
          const replacement = join(f.root, 'replacement');
          await actual.writeFile(replacement, bytes);
          await actual.rename(replacement, `${f.path}.next`);
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    await expect(f.store.createSelected(journal, f.assertAuthority)).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await fs.readFile(`${f.path}.next`)).toEqual(bytes);
    await expect(fs.lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the published current after a lost rename acknowledgement', async context => {
    const f = await fixture(context);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const failure = new Error('synthetic rename acknowledgement lost');
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => { await actual.rename(...args); throw failure; });
    await expect(f.store.createSelected(journal, f.assertAuthority)).rejects.toMatchObject({ cause: failure });
    expect(await fs.readFile(f.path)).toEqual(bytes);
    await f.store.confirmSelected({ expectedBytes: bytes, assertAuthority: f.assertAuthority });
  });

  it('preserves next after authority is lost during writing', async context => {
    const f = await fixture(context);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actual.open(...args);
      return new Proxy(file, { get(target, key) {
        if (key === 'writeFile') return async (...input: Parameters<typeof file.writeFile>) => {
          await file.writeFile(...input);
          f.assertAuthority.mockImplementation(() => { throw new Error('synthetic authority lost'); });
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    await expect(f.store.createSelected(journal, f.assertAuthority)).rejects.toThrow('UPDATE_JOURNAL_UNAVAILABLE');
    expect(await fs.readFile(`${f.path}.next`)).toEqual(bytes);
    await expect(fs.lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('holds store exclusion until the owned file has actually closed', async context => {
    const f = await fixture(context);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let release = () => {};
    let closing = () => {};
    const released = new Promise<void>(resolve => { release = resolve; });
    const closeStarted = new Promise<void>(resolve => { closing = resolve; });
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actual.open(...args);
      return new Proxy(file, { get(target, key) {
        if (key === 'close') return async () => { closing(); await released; await file.close(); };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    const pending = f.store.createSelected(journal, f.assertAuthority);
    try {
      await closeStarted;
      await expect(f.store.read()).rejects.toThrow('UPDATE_JOURNAL_BUSY');
      await expect(f.store.confirmAbsent(f.assertAuthority)).rejects.toThrow('UPDATE_JOURNAL_BUSY');
    } finally { release(); await pending; }
    expect(await f.store.read()).toEqual(journal);
  });
});

describe('selected journal synchronization', () => {
  it('rechecks authority after selection resolves and before deleting current', async context => {
    const f = await fixture(context);
    await f.store.createSelected(journal, f.assertAuthority);
    const lost = new Error('synthetic authority lost between selection and unlink');
    let checks = 0;
    let owned = true;
    const assertAuthority = () => {
      if (!owned) throw lost;
      if (++checks === 4) queueMicrotask(() => { owned = false; });
    };
    await expect(f.store.clearSelected({ expectedBytes: bytes, assertAuthority }))
      .rejects.toMatchObject({ message: 'UPDATE_JOURNAL_UNAVAILABLE', cause: lost });
    expect(await fs.readFile(f.path)).toEqual(bytes);
  });

  it('does not create a missing directory while confirming absence', async context => {
    const f = await fixture(context);
    await f.store.confirmAbsent(f.assertAuthority);
    await expect(fs.lstat(dirname(f.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a new slot during absence confirmation', async context => {
    const f = await fixture(context);
    await fs.mkdir(dirname(f.path), { mode: 0o700 });
    await fs.writeFile(`${f.path}.backup`, bytes);
    await expect(f.store.confirmAbsent(f.assertAuthority)).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
    expect(await fs.readFile(`${f.path}.backup`)).toEqual(bytes);
  });

  it('preserves directory synchronization failure and close failure in the modeled non-Windows branch', async context => {
    const f = await fixture(context);
    await f.store.createSelected(journal, f.assertAuthority);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const first = new Error('synthetic directory sync failed');
    const closing = new Error('synthetic directory close failed');
    let checks = 0;
    const assertAuthority = () => {
      // Four selection checks and the private-directory check precede sync.
      if (++checks === 5) Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    };
    const sync = vi.fn(async () => { throw first; });
    const close = vi.fn(async () => { Object.defineProperty(process, 'platform', platform); throw closing; });
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      if (String(path) !== dirname(f.path)) return actual.open(path, flags, mode);
      return { sync, close } as unknown as fs.FileHandle;
    });
    const failure = await f.store.confirmSelected({ expectedBytes: bytes, assertAuthority }).catch(error => error);
    expect(failure.message).toBe('UPDATE_JOURNAL_UNAVAILABLE');
    expect(failure.cause.errors).toEqual([first, closing]);
    expect(failure.cause.cause).toBe(first);
    expect(sync).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(await fs.readFile(f.path)).toEqual(bytes);
  });
});
