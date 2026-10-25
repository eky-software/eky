import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { createSelectorAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from './localUpdateRuntimePaths.js';
import { migrateLegacyLocalUpdateState, prepareSelectorLocalUpdateState } from './migrateLegacyLocalUpdateState.js';
import { parseUpdateJournal, type UpdateJournalState } from './updateJournal.js';
import { UpdateJournalStore } from './updateJournalStore.js';

afterEach(() => { vi.restoreAllMocks(); });
const workspaceId = '11111111-1111-4111-8111-111111111111';
const time = '2026-10-25T12:00:00.000Z';
const source = { formatVersion: 1 as const, acceptedAt: time, appVersion: '0.1.0',
  buildRevision: 'a'.repeat(40), releaseChannel: 'pilot' as const };
const target = { ...source, appVersion: '0.2.0', buildRevision: 'b'.repeat(40) };
const registry = { formatVersion: 2, activeWorkspaceId: null, workspaces: [{
  workspaceId, workspaceLabel: 'Synthetic company', lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) },
  layoutVersion: 1, lifecycleState: 'ready', createdAt: time,
}] };
const locations = ['current', 'legacy', 'both'] as const;
const terminalStates = ['accepted', 'installerNotApplied', 'rolledBack'] as const;
const slots = ['', '.next', '.backup'] as const;
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const conflict = 'LOCAL_UPDATE_STATE_MIGRATION_CONFLICT';

function journal(state: UpdateJournalState = 'accepted') {
  return parseUpdateJournal({
    formatVersion: 1, correlationId: workspaceId, state, revision: 1,
    binaryRollbackAttemptCount: state === 'rolledBack' ? 1 : 0, handoffAttemptCount: state === 'prepared' ? 0 : 1,
    currentVersion: source.appVersion, targetVersion: target.appVersion, releaseChannel: 'pilot',
    createdAt: time, updatedAt: time, recoveryPointReference: workspaceId,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    currentPackageIdentity: { buildRevision: source.buildRevision, msiProductVersion: '0.1.0',
      packageSha256: 'a'.repeat(64), packageSize: 1024 },
    candidatePackageIdentity: { buildRevision: target.buildRevision, msiProductVersion: '0.2.0',
      packageSha256: 'b'.repeat(64), packageSize: 2048 },
  });
}

async function fixture(context: TestContext, options: {
  metadata?: typeof locations[number]; journal?: typeof locations[number]; state?: typeof terminalStates[number];
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-state-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const paths = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: join(root, 'runtime') });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const metadata = options.metadata ?? 'legacy';
  const journalLocation = options.journal ?? 'legacy';
  const state = options.state ?? 'accepted';
  const accepted = state === 'accepted' ? target : source;
  async function put(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, encode(value), { mode: 0o600 });
  }
  if (metadata !== 'legacy') await put(paths.acceptedBuildMetadataPath, accepted);
  if (metadata !== 'current') await put(paths.legacyAcceptedBuildMetadataPath, accepted);
  if (journalLocation !== 'legacy') await put(paths.journalPath, journal(state));
  if (journalLocation !== 'current') await put(paths.legacyJournalPath, journal(state));
  await put(registryPath, registry);
  const stores = {
    acceptedBuild: { current: new AcceptedBuildMetadataStore(paths.acceptedBuildMetadataPath),
      legacy: new AcceptedBuildMetadataStore(paths.legacyAcceptedBuildMetadataPath) },
    journal: { current: new UpdateJournalStore(paths.journalPath), legacy: new UpdateJournalStore(paths.legacyJournalPath) },
    registry: new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath }),
    assertAuthority: vi.fn(() => {}), assertRecoveryAuthority: vi.fn(async () => {}),
  };
  const allPaths = [paths.acceptedBuildMetadataPath, paths.legacyAcceptedBuildMetadataPath,
    paths.journalPath, paths.legacyJournalPath, registryPath].flatMap(path => slots.map(slot => `${path}${slot}`));
  async function contents() {
    return Promise.all(allPaths.map(path => readFile(path).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    })));
  }
  return { root, paths, registryPath, accepted, stores, put, contents };
}

describe('selector installation-state preparation', () => {
  const matrix = terminalStates.flatMap(state => locations.flatMap(metadata =>
    locations.map(journal => ({ state, metadata, journal }))));
  it.for(matrix)('prepares $state from metadata=$metadata and journal=$journal', async (options, context) => {
    const f = await fixture(context, options);
    const registryBytes = await readFile(f.registryPath);
    const sentinel = join(f.root, 'retained-profile-evidence');
    await writeFile(sentinel, 'synthetic recovery point and package evidence');
    for (const store of [f.stores.acceptedBuild.current, f.stores.acceptedBuild.legacy,
      f.stores.journal.current, f.stores.journal.legacy]) {
      vi.spyOn(store, 'read').mockRejectedValue(new Error('repairing read forbidden'));
      vi.spyOn(store, 'clear').mockRejectedValue(new Error('unconditional clear forbidden'));
    }
    await prepareSelectorLocalUpdateState(f.stores);
    await prepareSelectorLocalUpdateState(f.stores);
    expect((await f.stores.acceptedBuild.current.inspectSlots()).current?.value).toEqual(f.accepted);
    for (const store of [f.stores.acceptedBuild.legacy, f.stores.journal.current, f.stores.journal.legacy]) {
      expect(await store.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
    }
    expect(await readFile(f.registryPath)).toEqual(registryBytes);
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic recovery point and package evidence');
  });

  it('uses application acceptance, not the older business baseline', async context => {
    const f = await fixture(context);
    const scoped = createSelectorAcceptedBuildMetadata(source, target);
    await f.put(f.paths.legacyAcceptedBuildMetadataPath, scoped);
    await prepareSelectorLocalUpdateState(f.stores);
    expect((await f.stores.acceptedBuild.current.inspectSlots()).current?.value).toEqual(scoped);
  });

  it.for(['metadata', 'journal', 'registry'] as const)('preserves all files when %s has recovery slots', async (kind, context) => {
    const f = await fixture(context);
    const path = kind === 'metadata' ? f.paths.legacyAcceptedBuildMetadataPath
      : kind === 'journal' ? f.paths.legacyJournalPath : f.registryPath;
    await writeFile(`${path}.next`, await readFile(path));
    const before = await f.contents();
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['metadata', 'journal'] as const)('checks a conflicting %s pair before changing either location', async (kind, context) => {
    const f = await fixture(context, { metadata: 'both', journal: 'both' });
    await f.put(kind === 'metadata' ? f.paths.legacyAcceptedBuildMetadataPath : f.paths.legacyJournalPath,
      kind === 'metadata' ? { ...target, acceptedAt: '2026-10-25T12:01:00.000Z' } : { ...journal(), revision: 2 });
    const before = await f.contents();
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['metadata', 'journal'] as const)('rejects duplicate keys in %s before parsed equality can hide them', async (kind, context) => {
    const f = await fixture(context);
    const path = kind === 'metadata' ? f.paths.legacyAcceptedBuildMetadataPath : f.paths.legacyJournalPath;
    const value = kind === 'metadata' ? target : journal();
    const duplicate = kind === 'metadata' ? '"appVersion":"0.0.1",' : '"state":"failed",';
    await writeFile(path, `{${duplicate}${JSON.stringify(value).slice(1)}`);
    const before = await f.contents();
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['metadata', 'journal'] as const)('reconfirms existing %s durability before removing the legacy copy', async (kind, context) => {
    const f = await fixture(context, { metadata: 'both', journal: 'both' });
    const failure = new Error('synthetic destination sync failed');
    if (kind === 'metadata') vi.spyOn(f.stores.acceptedBuild.current, 'confirmSelected').mockRejectedValue(failure);
    else vi.spyOn(f.stores.journal.current, 'confirmSelected').mockRejectedValue(failure);
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toBe(failure);
    const source = kind === 'metadata' ? f.stores.acceptedBuild.legacy : f.stores.journal.legacy;
    expect((await source.inspectSlots()).current).toBeDefined();
    expect((await f.stores.journal.current.inspectSlots()).current).toBeDefined();
  });

  it.for(['metadata', 'journal'] as const)('checks copied %s again after a lost publication acknowledgement', async (kind, context) => {
    const f = await fixture(context);
    const lost = new Error('synthetic publication sync failed');
    if (kind === 'metadata') {
      const write = f.stores.acceptedBuild.current.write.bind(f.stores.acceptedBuild.current);
      vi.spyOn(f.stores.acceptedBuild.current, 'write').mockImplementationOnce(async (...args) => { await write(...args); throw lost; });
    } else {
      const write = f.stores.journal.current.createSelected.bind(f.stores.journal.current);
      vi.spyOn(f.stores.journal.current, 'createSelected').mockImplementationOnce(async (...args) => { await write(...args); throw lost; });
    }
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toBe(lost);
    const retained = await f.contents();
    if (kind === 'metadata') vi.spyOn(f.stores.acceptedBuild.current, 'confirmSelected').mockRejectedValue(lost);
    else vi.spyOn(f.stores.journal.current, 'confirmSelected').mockRejectedValue(lost);
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toBe(lost);
    expect(await f.contents()).toEqual(retained);
  });

  it.for(['failed', 'failedSafe', 'recoveryRequired', 'prepared'] as const)('leaves %s to the existing recovery owner', async (state, context) => {
    const f = await fixture(context);
    await f.put(f.paths.legacyJournalPath, journal(state));
    const before = await f.contents();
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(terminalStates)('requires the exact application identity for %s', async (state, context) => {
    const f = await fixture(context, { state });
    await f.put(f.paths.legacyAcceptedBuildMetadataPath, state === 'accepted' ? source : target);
    const before = await f.contents();
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it.for(['missingRegistry', 'activeRegistry', 'missingAcceptance'] as const)('does not infer selector authority from %s', async (kind, context) => {
    const f = await fixture(context);
    if (kind === 'missingRegistry') await rm(f.registryPath);
    if (kind === 'activeRegistry') await f.put(f.registryPath, { ...registry, activeWorkspaceId: workspaceId });
    if (kind === 'missingAcceptance') await rm(f.paths.legacyAcceptedBuildMetadataPath);
    const before = await f.contents();
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect(await f.contents()).toEqual(before);
  });

  it('does not create a missing legacy directory during final synchronization', async context => {
    const f = await fixture(context, { metadata: 'current', journal: 'current' });
    await prepareSelectorLocalUpdateState(f.stores);
    await expect(lstat(dirname(f.paths.legacyJournalPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.for(['initial', 'lastRead'] as const)('preserves files when installation authority is lost at $0', async (when, context) => {
    const f = await fixture(context);
    const before = await f.contents();
    if (when === 'lastRead') {
      const inspect = f.stores.registry.inspectSlots.bind(f.stores.registry);
      vi.spyOn(f.stores.registry, 'inspectSlots').mockImplementationOnce(async () => {
        const value = await inspect();
        f.stores.assertAuthority.mockImplementation(() => { throw new Error('synthetic authority lost'); });
        return value;
      });
    } else f.stores.assertAuthority.mockImplementation(() => { throw new Error('synthetic authority lost'); });
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow('synthetic authority lost');
    expect(await f.contents()).toEqual(before);
  });

  it('does not mistake pending recovery for exclusive mutation authority', async context => {
    const f = await fixture(context);
    const before = await f.contents();
    f.stores.assertRecoveryAuthority.mockRejectedValue(new Error('synthetic recovery active'));
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow('synthetic recovery active');
    expect(await f.contents()).toEqual(before);
  });

  it.for(['metadataCopy', 'journalCopy', 'legacyClear', 'terminalClear'] as const)(
    'resumes a lost $0 acknowledgement only after fresh selection and synchronization', async (cut, context) => {
      const f = await fixture(context);
      const lost = new Error('synthetic acknowledgement lost');
      if (cut === 'metadataCopy') {
        const original = f.stores.acceptedBuild.current.write.bind(f.stores.acceptedBuild.current);
        vi.spyOn(f.stores.acceptedBuild.current, 'write').mockImplementationOnce(async (...args) => { await original(...args); throw lost; });
      } else if (cut === 'journalCopy') {
        const original = f.stores.journal.current.createSelected.bind(f.stores.journal.current);
        vi.spyOn(f.stores.journal.current, 'createSelected').mockImplementationOnce(async (...args) => { await original(...args); throw lost; });
      } else {
        const store = cut === 'legacyClear' ? f.stores.journal.legacy : f.stores.journal.current;
        const original = store.clearSelected.bind(store);
        vi.spyOn(store, 'clearSelected').mockImplementationOnce(async (...args) => { await original(...args); throw lost; });
      }
      await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toBe(lost);
      expect((await f.stores.acceptedBuild.current.inspectSlots()).current?.value).toEqual(target);
      if (cut === 'metadataCopy') expect((await f.stores.acceptedBuild.legacy.inspectSlots()).current?.value).toEqual(target);
      if (cut === 'journalCopy') expect((await f.stores.journal.legacy.inspectSlots()).current?.value).toEqual(journal());
      const synchronization = vi.spyOn(f.stores.journal.current, 'confirmAbsent');
      await prepareSelectorLocalUpdateState(f.stores);
      expect(synchronization).toHaveBeenCalledOnce();
      expect((await f.stores.journal.current.inspectSlots()).current).toBeUndefined();
    },
  );

  it('does not grant completion when final synchronization fails', async context => {
    const f = await fixture(context);
    const failure = new Error('synthetic sync failure');
    vi.spyOn(f.stores.journal.current, 'confirmAbsent').mockRejectedValue(failure);
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toBe(failure);
    expect((await f.stores.acceptedBuild.current.inspectSlots()).current?.value).toEqual(target);
    expect((await f.stores.journal.current.inspectSlots()).current).toBeUndefined();
  });

  it('stops before source deletion when the registry changes during a copy', async context => {
    const f = await fixture(context);
    const original = f.stores.acceptedBuild.current.write.bind(f.stores.acceptedBuild.current);
    vi.spyOn(f.stores.acceptedBuild.current, 'write').mockImplementationOnce(async (...args) => {
      await original(...args);
      await f.put(f.registryPath, { ...registry, workspaces: [{ ...registry.workspaces[0], workspaceLabel: 'Changed' }] });
    });
    await expect(prepareSelectorLocalUpdateState(f.stores)).rejects.toThrow(conflict);
    expect((await f.stores.acceptedBuild.legacy.inspectSlots()).current?.value).toEqual(target);
    expect((await f.stores.journal.legacy.inspectSlots()).current?.value).toEqual(journal());
  });
});

describe('unchanged legacy recovery', () => {
  it.for(['current', 'backup'] as const)('retains $0 recovery over a malformed unused next slot', async (selected, context) => {
    const f = await fixture(context);
    for (const path of [f.paths.legacyAcceptedBuildMetadataPath, f.paths.legacyJournalPath]) {
      if (selected === 'backup') {
        await writeFile(`${path}.backup`, await readFile(path));
        await rm(path);
      }
      await writeFile(`${path}.next`, '{partial');
    }
    await migrateLegacyLocalUpdateState(f.stores);
    expect(await f.stores.acceptedBuild.current.read()).toEqual(target);
    expect(await f.stores.journal.current.read()).toEqual(journal());
  });
});
