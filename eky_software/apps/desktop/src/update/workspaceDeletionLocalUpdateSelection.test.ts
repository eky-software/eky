import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { createSelectorAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import { createDirectSetupMigrationRecovery, transitionDirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import { DirectSetupMigrationRecoveryStore } from './directSetupMigrationRecoveryStore.js';
import { createLocalUpdateRuntimePaths } from './localUpdateRuntimePaths.js';
import { parseUpdateJournal, type UpdateJournalState } from './updateJournal.js';
import { UpdateJournalStore } from './updateJournalStore.js';
import { captureWorkspaceDeletionLocalUpdateSelection as capture, createWorkspaceDeletionLocalUpdateReaders } from './workspaceDeletionLocalUpdateSelection.js';

afterEach(() => vi.restoreAllMocks());
const time = '2026-10-25T12:00:00.000Z';
const id = '11111111-1111-4111-8111-111111111111';
const source = { formatVersion: 1 as const, acceptedAt: time, appVersion: '0.1.0', buildRevision: 'a'.repeat(40), releaseChannel: 'pilot' as const };
const target = { ...source, appVersion: '0.2.0', buildRevision: 'b'.repeat(40) };
const releaseInfo = { schemaVersion: 1 as const, appIdentity: 'Eky' as const, appVersion: target.appVersion,
  msiProductVersion: target.appVersion, buildRevision: target.buildRevision, platform: 'win32' as const,
  architecture: 'x64' as const, releaseChannel: 'pilot' as const, upgradeCode: id };
const buildInfo = { schemaVersion: 1 as const, appVersion: target.appVersion, buildRevision: target.buildRevision, buildCreatedAt: time, buildDirty: false };
const conflict = 'LOCAL_UPDATE_STATE_MIGRATION_CONFLICT';
const suffixes = ['', '.next', '.backup'] as const;
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

function journal(state: UpdateJournalState = 'accepted') {
  return parseUpdateJournal({ formatVersion: 1, correlationId: id, state, revision: 1,
    binaryRollbackAttemptCount: state === 'rolledBack' ? 1 : 0, handoffAttemptCount: state === 'prepared' ? 0 : 1,
    currentVersion: source.appVersion, targetVersion: target.appVersion, releaseChannel: 'pilot',
    createdAt: time, updatedAt: time, recoveryPointReference: id, preUpdateMigrationChainIdentity: 'c'.repeat(64),
    currentPackageIdentity: { buildRevision: source.buildRevision, msiProductVersion: source.appVersion, packageSha256: 'a'.repeat(64), packageSize: 1024 },
    candidatePackageIdentity: { buildRevision: target.buildRevision, msiProductVersion: target.appVersion, packageSha256: 'b'.repeat(64), packageSize: 2048 } });
}

function directSetup() {
  const prepared = createDirectSetupMigrationRecovery({ appliedMigrationCount: 38, at: time, correlationId: id,
    migrationPrefixIdentity: 'a'.repeat(64),
    previousAcceptedBuildIdentity: { appVersion: source.appVersion, buildRevision: source.buildRevision },
    runningTargetBuildIdentity: { appVersion: target.appVersion, buildRevision: target.buildRevision }, recoveryPointReference: id });
  return transitionDirectSetupMigrationRecovery(transitionDirectSetupMigrationRecovery(prepared,
    { at: time, state: 'migrationRunning' }), { at: time, state: 'accepted' });
}

async function fixture(context: TestContext, location: 'current' | 'legacy' | 'both' = 'current') {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-update-selection-'));
  context.onTestFinished(async ({ task }) => { if (task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: join(root, 'runtime') });
  async function put(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encode(value));
  }
  if (location !== 'legacy') await put(paths.acceptedBuildMetadataPath, target);
  if (location !== 'current') await put(paths.legacyAcceptedBuildMetadataPath, target);
  const readers = createWorkspaceDeletionLocalUpdateReaders(paths);
  const input = { readers, buildInfo: { ...buildInfo }, releaseInfo: { ...releaseInfo },
    assertCurrent: vi.fn(() => { context.signal.throwIfAborted(); }), assertOwned: vi.fn(async () => {}) };
  const files = Object.values(paths).flatMap(path => suffixes.map(suffix => `${path}${suffix}`));
  async function contents() {
    const result = [];
    for (const path of files) {
      try {
        const stat = await lstat(path);
        result.push({ bytes: await readFile(path), dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        result.push(undefined);
      }
    }
    return result;
  }
  return { root, paths, readers, input, put, contents };
}

describe('deletion read-only installation selection', () => {
  it.for(['current', 'legacy', 'both'] as const)('observes %s without any repair and revokes its receipt', async (location, context) => {
    const f = await fixture(context, location), before = await f.contents();
    const forbidden = [vi.spyOn(AcceptedBuildMetadataStore.prototype, 'read'), vi.spyOn(AcceptedBuildMetadataStore.prototype, 'write'),
      vi.spyOn(AcceptedBuildMetadataStore.prototype, 'clear'), vi.spyOn(UpdateJournalStore.prototype, 'read'),
      vi.spyOn(UpdateJournalStore.prototype, 'write'), vi.spyOn(UpdateJournalStore.prototype, 'clear'),
      vi.spyOn(DirectSetupMigrationRecoveryStore.prototype, 'read')];
    const result = await capture(f.input);
    expect(result.admission).toBe('exactAcceptedBuild');
    await result.assertSelected();
    expect(await f.contents()).toEqual(before);
    for (const method of forbidden) expect(method).not.toHaveBeenCalled();
    result.revoke();
    await expect(result.assertSelected()).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['accepted', 'rolledBack', 'installerNotApplied'] as const)('requires the exact %s terminal relationship', async (state, context) => {
    const f = await fixture(context, 'both');
    const metadata = state === 'accepted' ? target : source;
    for (const path of [f.paths.acceptedBuildMetadataPath, f.paths.legacyAcceptedBuildMetadataPath]) await f.put(path, metadata);
    for (const path of [f.paths.journalPath, f.paths.legacyJournalPath]) await f.put(path, journal(state));
    const before = await f.contents(), result = await capture(f.input);
    expect(result.admission).toBe(state === 'accepted' ? 'exactAcceptedBuild' : 'authorizedNewerBuild');
    result.revoke();
    expect(await f.contents()).toEqual(before);
    const wrong = state === 'accepted' ? source : target;
    for (const path of [f.paths.acceptedBuildMetadataPath, f.paths.legacyAcceptedBuildMetadataPath]) await f.put(path, wrong);
    const changed = await f.contents();
    await expect(capture(f.input)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(changed);
  });

  it('uses selector application acceptance without upgrading its business baseline', async context => {
    const f = await fixture(context);
    await f.put(f.paths.acceptedBuildMetadataPath, createSelectorAcceptedBuildMetadata(source, target));
    await f.put(f.paths.journalPath, journal());
    const before = await f.contents(), result = await capture(f.input);
    expect(result.admission).toBe('exactAcceptedBuild'); result.revoke();
    expect(await f.contents()).toEqual(before);
  });

  it.for(['target', 'selector', 'source'] as const)('keeps Direct Setup accepted with %s metadata distinct', async (kind, context) => {
    const f = await fixture(context);
    await f.put(f.paths.acceptedBuildMetadataPath, kind === 'target' ? target : kind === 'source' ? source : createSelectorAcceptedBuildMetadata(source, target));
    await f.put(f.paths.directSetupMigrationRecoveryPath, directSetup());
    const before = await f.contents();
    if (kind === 'target') { const result = await capture(f.input); expect(result.admission).toBe('exactAcceptedBuild'); result.revoke(); }
    else await expect(capture(f.input)).rejects.toThrow();
    expect(await f.contents()).toEqual(before);
  });

  it.for(['acceptedAt', 'scope', 'baseline'] as const)('rejects unequal duplicate metadata: %s', async (kind, context) => {
    const f = await fixture(context, 'both');
    const changed = kind === 'acceptedAt' ? { ...target, acceptedAt: '2026-10-25T12:00:01.000Z' }
      : kind === 'scope' ? createSelectorAcceptedBuildMetadata(source, target)
      : createSelectorAcceptedBuildMetadata({ ...source, appVersion: '0.0.9' }, target);
    if (kind === 'baseline') await f.put(f.paths.acceptedBuildMetadataPath, createSelectorAcceptedBuildMetadata(source, target));
    await f.put(f.paths.legacyAcceptedBuildMetadataPath, changed);
    const before = await f.contents();
    await expect(capture(f.input)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['acceptedBuildMetadataPath', 'legacyAcceptedBuildMetadataPath', 'journalPath', 'legacyJournalPath', 'directSetupMigrationRecoveryPath'] as const)
  ('rejects side slots and duplicate keys at %s', async (name, context) => {
    const f = await fixture(context), path = f.paths[name];
    const value = name.includes('Metadata') ? target : name.includes('journal') || name.includes('Journal') ? journal() : directSetup();
    for (const suffix of ['.next', '.backup']) {
      await f.put(`${path}${suffix}`, value);
      const before = await f.contents();
      await expect(capture(f.input)).rejects.toThrow(conflict);
      expect(await f.contents()).toEqual(before);
      await rm(`${path}${suffix}`);
    }
    await f.put(path, value);
    await writeFile(path, `{"formatVersion":99,${JSON.stringify(value).slice(1)}`);
    const before = await f.contents();
    await expect(capture(f.input)).rejects.toThrow();
    expect(await f.contents()).toEqual(before);
  });

  it.for(['bytes', 'identity', 'sideSlot', 'absentLocation'] as const)('rejects a late %s change and retains the first failure', async (kind, context) => {
    const f = await fixture(context), result = await capture(f.input);
    if (kind === 'bytes') await f.put(f.paths.acceptedBuildMetadataPath, { ...target, acceptedAt: '2026-10-25T12:00:01.000Z' });
    if (kind === 'identity') {
      const bytes = await readFile(f.paths.acceptedBuildMetadataPath);
      await rename(f.paths.acceptedBuildMetadataPath, join(f.root, 'retained-metadata'));
      await writeFile(f.paths.acceptedBuildMetadataPath, bytes);
    }
    if (kind === 'sideSlot') await f.put(`${f.paths.acceptedBuildMetadataPath}.next`, target);
    if (kind === 'absentLocation') await f.put(f.paths.legacyAcceptedBuildMetadataPath, target);
    const before = await f.contents();
    const failure = await result.assertSelected().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    await expect(result.assertSelected()).rejects.toBe(failure);
    expect(await f.contents()).toEqual(before); result.revoke();
  });

  it.for(['downgrade', 'revision', 'dirty', 'mixed'] as const)('retains packaged build rejection: %s', async (kind, context) => {
    const f = await fixture(context);
    if (kind === 'downgrade') await f.put(f.paths.acceptedBuildMetadataPath, { ...target, appVersion: '0.3.0' });
    if (kind === 'revision') await f.put(f.paths.acceptedBuildMetadataPath, { ...target, buildRevision: source.buildRevision });
    if (kind === 'dirty') f.input.buildInfo.buildDirty = true;
    if (kind === 'mixed') f.input.buildInfo.buildRevision = source.buildRevision;
    const before = await f.contents();
    await expect(capture(f.input)).rejects.toThrow('DESKTOP_BUILD_ADMISSION_REJECTED');
    expect(await f.contents()).toEqual(before);
  });

  it('does not turn initial installation or an unfinished update into deletion authority', async context => {
    const f = await fixture(context);
    await rm(f.paths.acceptedBuildMetadataPath);
    await expect(capture(f.input)).rejects.toThrow(conflict);
    await f.put(f.paths.acceptedBuildMetadataPath, source);
    await f.put(f.paths.journalPath, journal('awaitingFirstStart'));
    const before = await f.contents();
    await expect(capture(f.input)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['none', 'source', 'selector'] as const)('rejects missing packaged identity with %s Setup evidence before reading', async (kind, context) => {
    const f = await fixture(context);
    if (kind !== 'none') {
      await f.put(f.paths.acceptedBuildMetadataPath, kind === 'source' ? source : createSelectorAcceptedBuildMetadata(source, target));
      await f.put(f.paths.directSetupMigrationRecoveryPath, directSetup());
    }
    const before = await f.contents(), read = vi.fn(f.readers.metadata);
    await expect(capture({ ...f.input, readers: { ...f.readers, metadata: read }, releaseInfo: undefined,
      buildInfo: { ...buildInfo, buildRevision: 'development', buildDirty: true } })).rejects.toThrow(conflict);
    expect(read).not.toHaveBeenCalled(); expect(f.input.assertOwned).not.toHaveBeenCalled();
    expect(await f.contents()).toEqual(before);
  });

  it.for(['bytes', 'identity'] as const)('rejects a %s change between initial observation and receipt publication', async (kind, context) => {
    const f = await fixture(context);
    let passes = 0;
    f.input.assertOwned.mockImplementation(async () => {
      if (++passes !== 2) return;
      if (kind === 'bytes') await f.put(f.paths.acceptedBuildMetadataPath, { ...target, acceptedAt: '2026-10-25T12:00:01.000Z' });
      else {
        const bytes = await readFile(f.paths.acceptedBuildMetadataPath);
        await rename(f.paths.acceptedBuildMetadataPath, join(f.root, 'retained-first-observation'));
        await writeFile(f.paths.acceptedBuildMetadataPath, bytes);
      }
    });
    await expect(capture(f.input)).rejects.toThrow(conflict);
    expect((await f.readers.metadata()).current?.value).toMatchObject({ formatVersion: 1,
      acceptedAt: kind === 'bytes' ? '2026-10-25T12:00:01.000Z' : time });
    if (kind === 'identity') expect((await readFile(join(f.root, 'retained-first-observation'))).equals(encode(target))).toBe(true);
  });

  it('joins an already started receipt read after revoke and never revives its first failure', async context => {
    const f = await fixture(context), before = await f.contents();
    let hold = false, unblock!: () => void, entered!: () => void, settled = false;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const result = await capture({ ...f.input, readers: { ...f.readers, metadata: async () => {
      if (hold) { entered(); await held; }
      return f.readers.metadata();
    } } });
    hold = true;
    const task = result.assertSelected().finally(() => { settled = true; });
    context.onTestFinished(async () => { unblock(); await Promise.allSettled([task]); result.revoke(); });
    await started; result.revoke();
    await Promise.resolve(); expect(settled).toBe(false); unblock();
    const failure = await task.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toBe(conflict);
    await expect(result.assertSelected()).rejects.toBe(failure);
    expect(await f.contents()).toEqual(before);
  });

  it('joins a held original read before rejecting lost authority and keeps its first cause', async context => {
    const f = await fixture(context), before = await f.contents();
    let unblock!: () => void, entered!: () => void, settled = false;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const failure = new Error('synthetic main ownership lost');
    const input = { ...f.input, readers: { ...f.readers, metadata: async () => { entered(); await held; return f.readers.metadata(); } } };
    const task = capture(input).finally(() => { settled = true; });
    context.onTestFinished(async () => { unblock(); await Promise.allSettled([task]); });
    await started;
    f.input.assertCurrent.mockImplementation(() => { throw failure; });
    await Promise.resolve(); expect(settled).toBe(false);
    unblock();
    await expect(task).rejects.toBe(failure);
    expect(await f.contents()).toEqual(before);
  });
});
