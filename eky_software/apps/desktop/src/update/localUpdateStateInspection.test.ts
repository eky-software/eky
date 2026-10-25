import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { createSelectorAcceptedBuildMetadata, parseVersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore, acceptedBuildMetadataFileName } from './acceptedBuildMetadataStore.js';
import { parseUpdateJournal } from './updateJournal.js';
import { UpdateJournalStore, updateJournalFileName } from './updateJournalStore.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
afterEach(() => { vi.restoreAllMocks(); });

const accepted = {
  formatVersion: 1 as const, appVersion: '0.1.0', buildRevision: 'a'.repeat(40),
  acceptedAt: '2026-10-25T12:00:00.000Z', releaseChannel: 'pilot' as const,
};
const scoped = createSelectorAcceptedBuildMetadata(accepted, {
  ...accepted, appVersion: '0.2.0', buildRevision: 'b'.repeat(40),
});
const journal = parseUpdateJournal({
  formatVersion: 1, correlationId: '22222222-2222-4222-8222-222222222222',
  binaryRollbackAttemptCount: 0, handoffAttemptCount: 0, revision: 1,
  state: 'prepared', currentVersion: '0.1.0', targetVersion: '0.2.0', releaseChannel: 'pilot',
  createdAt: accepted.acceptedAt, updatedAt: accepted.acceptedAt,
  currentPackageIdentity: { buildRevision: accepted.buildRevision, msiProductVersion: '0.1.0',
    packageSha256: 'a'.repeat(64), packageSize: 1024 },
  candidatePackageIdentity: { buildRevision: 'b'.repeat(40), msiProductVersion: '0.2.0',
    packageSha256: 'b'.repeat(64), packageSize: 2048 },
});
const cases = [
  { name: 'accepted metadata', fileName: acceptedBuildMetadataFileName, limit: 4 * 1024,
    source: accepted, target: scoped, create: (path: string) => new AcceptedBuildMetadataStore(path),
    parse: parseVersionedAcceptedBuildMetadata, error: 'ACCEPTED_BUILD_METADATA_INVALID' },
  { name: 'update journal', fileName: updateJournalFileName, limit: 32 * 1024,
    source: journal, target: { ...journal, revision: 2 }, create: (path: string) => new UpdateJournalStore(path),
    parse: parseUpdateJournal, error: 'UPDATE_JOURNAL_INVALID' },
] as const;
const slots = ['current', 'next', 'backup'] as const;
type Slot = typeof slots[number];
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

describe.each(cases)('$name non-repairing inspection', scenario => {
  async function fixture(context: TestContext) {
    const root = await fs.mkdtemp(join(tmpdir(), 'eky-update-inspection-'));
    context.onTestFinished(async ({ task }) => {
      if (task.result?.state === 'pass') await fs.rm(root, { recursive: true, force: true });
    });
    const path = join(root, 'runtime', scenario.fileName);
    const paths = { current: path, next: `${path}.next`, backup: `${path}.backup` };
    const store = scenario.create(path);
    return { root, path, paths, store,
      async write(slot: Slot, bytes: Uint8Array) {
        await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await fs.writeFile(paths[slot], bytes, { mode: 0o600 });
      },
      async contents() {
        return Promise.all(slots.map(async slot => fs.readFile(paths[slot]).catch(error => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        })));
      },
    };
  }

  it('leaves a missing installation directory absent', async context => {
    const f = await fixture(context);
    expect(await f.store.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
    await expect(fs.lstat(dirname(f.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns every actual slot and its exact bytes without choosing or deleting one', async context => {
    const f = await fixture(context);
    await f.write('current', encode(scenario.source));
    await f.write('next', encode(scenario.target));
    await f.write('backup', encode(scenario.source));
    const before = await f.contents();
    const result = await f.store.inspectSlots();
    expect(result.current?.value).toEqual(scenario.parse(scenario.source));
    expect(result.next?.value).toEqual(scenario.parse(scenario.target));
    expect(result.backup?.value).toEqual(scenario.parse(scenario.source));
    expect(slots.map(slot => Buffer.from(result[slot]!.bytes))).toEqual(before);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['next', 'backup'] as const)('does not promote a lone %s slot', async (slot, context) => {
    const f = await fixture(context);
    await f.write(slot, encode(scenario.target));
    const before = await f.contents();
    const result = await f.store.inspectSlots();
    expect(result.current).toBeUndefined();
    expect(result[slot]?.value).toEqual(scenario.parse(scenario.target));
    expect(await f.contents()).toEqual(before);
  });

  it.for(slots)('preserves all evidence when %s contains an invalid record', async (slot, context) => {
    const f = await fixture(context);
    for (const name of slots) await f.write(name, encode(name === slot ? { invalid: true } : scenario.source));
    const before = await f.contents();
    await expect(f.store.inspectSlots()).rejects.toThrow(scenario.error);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['next', 'backup'] as const)('does not hide malformed UTF-8 in %s behind a valid current', async (slot, context) => {
    const f = await fixture(context);
    await f.write('current', encode(scenario.source));
    await f.write(slot, Buffer.from([0xff]));
    const before = await f.contents();
    await expect(f.store.inspectSlots()).rejects.toThrow(scenario.error);
    expect(await f.contents()).toEqual(before);
  });

  it('enforces the existing byte limit for every slot without truncation', async context => {
    const f = await fixture(context);
    const boundary = Buffer.from(JSON.stringify(scenario.source).padEnd(scenario.limit, ' '));
    for (const slot of slots) await f.write(slot, boundary);
    const result = await f.store.inspectSlots();
    expect(slots.map(slot => result[slot]?.bytes.byteLength)).toEqual([scenario.limit, scenario.limit, scenario.limit]);
    for (const slot of slots) {
      await f.write(slot, Buffer.concat([boundary, Buffer.from(' ')]));
      const before = await f.contents();
      await expect(f.store.inspectSlots()).rejects.toThrow(scenario.error);
      expect(await f.contents()).toEqual(before);
      await f.write(slot, boundary);
    }
  });

  it('does not normalize a disappearing file to an absent slot', async context => {
    const f = await fixture(context);
    await f.write('current', encode(scenario.source));
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.open).mockImplementationOnce(async (path, flags, mode) => {
      await fs.rm(f.path);
      return real.open(path, flags, mode);
    });
    await expect(f.store.inspectSlots()).rejects.toThrow(scenario.error);
  });

  it('propagates a safe read failure instead of treating it as absence', async context => {
    const f = await fixture(context);
    await f.write('current', encode(scenario.source));
    const before = await f.contents();
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error('synthetic denied read'), { code: 'EACCES' }));
    const failure = await f.store.inspectSlots().catch(error => error);
    expect(failure.message).toBe(scenario.error);
    expect(failure.cause).toBeInstanceOf(Error);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['current', 'next', 'backup'] as const)('rejects a directory in the %s slot without deleting it', async (slot, context) => {
    const f = await fixture(context);
    await fs.mkdir(f.paths[slot], { recursive: true, mode: 0o700 });
    await expect(f.store.inspectSlots()).rejects.toThrow(scenario.error);
    expect((await fs.lstat(f.paths[slot])).isDirectory()).toBe(true);
  });

  it('rejects a linked parent even when the metadata does not exist', async context => {
    const f = await fixture(context);
    const target = join(f.root, 'target');
    await fs.mkdir(target, { mode: 0o700 });
    await fs.symlink(target, dirname(f.path), 'junction');
    await expect(f.store.inspectSlots()).rejects.toThrow(scenario.error);
    expect((await fs.lstat(dirname(f.path))).isSymbolicLink()).toBe(true);
    expect(await fs.readdir(target)).toEqual([]);
  });
});
