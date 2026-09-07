import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { createClosedDirectoryInventory } from './closedDirectoryInventory.mjs';
import { createWorkspaceSuccessEvidenceTestFixture } from './workspaceSuccessEvidenceTestFixture.mjs';
import {
  captureWorkspaceSuccessProfileEvidence, readWorkspaceSuccessSettledSlot,
  workspaceSuccessCheckpointPath, writeWorkspaceSuccessCheckpoint, loadWorkspaceSuccessProfileSupport,
} from './workspaceSuccessProfileEvidence.mjs';

async function createProfile(t) {
  const fixture = await createWorkspaceSuccessEvidenceTestFixture();
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userDataRoot = resolve(root, 'user-data');
  const evidenceRoot = resolve(root, 'evidence');
  await mkdir(evidenceRoot);
  await mkdir(resolve(userDataRoot, 'update-state'), { recursive: true });
  const statePath = resolve(evidenceRoot, 'w6b2-profile-state-v1.json');
  const acceptedPath = resolve(userDataRoot, 'update-state', 'accepted-build-v1.json');
  await writeFile(statePath, JSON.stringify(fixture.state));
  await writeFile(resolve(userDataRoot, fixture.support.WORKSPACE_REGISTRY_FILE_NAME), JSON.stringify(fixture.checkpoints[0].registry));
  await writeFile(acceptedPath, JSON.stringify(fixture.checkpoints[0].accepted));
  const databasePaths = [];
  for (const persisted of fixture.state.fixtures) {
    const databasePath = resolve(userDataRoot, 'workspaces', persisted.workspaceId, 'runtime', 'data', 'eky.sqlite');
    await mkdir(dirname(databasePath), { recursive: true });
    await writeFile(databasePath, `synthetic database boundary ${persisted.fixtureKey}`);
    databasePaths.push(databasePath);
  }
  let sqlReads = 0;
  const support = { ...fixture.support,
    hydrateW6b2PackagedWorkspaceFixture(_root, persisted) {
      sqlReads += 1;
      return persisted;
    },
    async snapshotW6b2PackagedWorkspaceEvidence(persisted) {
      const index = fixture.state.fixtures.findIndex((item) => item.fixtureKey === persisted.fixtureKey);
      const root = resolve(userDataRoot, 'workspaces', persisted.workspaceId);
      return { ...persisted.baseline, database:
        await fixture.support.snapshotW6b2PackagedWorkspaceFileEvidence(databasePaths[index], root) };
    },
  };
  return { ...fixture, root, statePath, acceptedPath, databasePaths, support,
    input: { request: fixture.request, proofRoot: root, checkpoint: 'sourceBaseline', support },
    sqlReads: () => sqlReads };
}

test('capture uses existing read-only adapters and leaves profile bytes unchanged', async (t) => {
  const f = await createProfile(t);
  const before = await createClosedDirectoryInventory(f.root);
  const result = await captureWorkspaceSuccessProfileEvidence(f.input);
  assert.equal(result.checkpoint, 'sourceBaseline');
  assert.equal(result.profileState.fixtures.length, 3);
  assert.equal(f.sqlReads(), 3);
  assert.deepEqual(await createClosedDirectoryInventory(f.root), before);
});

test('profile inspection loads only named readers, parsers and path derivations', async () => {
  assert.deepEqual(Object.keys(await loadWorkspaceSuccessProfileSupport()).sort(), [
    'WORKSPACE_REGISTRY_FILE_NAME', 'createDesktopProfilePaths', 'createLocalUpdateRuntimePaths',
    'deriveWorkspaceRoot', 'hydrateW6b2PackagedWorkspaceFixture', 'parseAcceptedBuildMetadata',
    'parseUpdateJournal', 'parseW6b2PackagedWorkspaceProfileState',
    'snapshotW6b2PackagedWorkspaceEvidence', 'snapshotW6b2PackagedWorkspaceFileEvidence',
    'validateWorkspaceRegistry', 'w6b2PackagedWorkspaceContentPreserved',
  ].sort());
});

for (const suffix of ['.next', '.backup']) {
  test(`unsettled ${suffix} slot is rejected without recovery writes or SQLite reads`, async (t) => {
    const f = await createProfile(t);
    await writeFile(f.acceptedPath + suffix, await readFile(f.acceptedPath));
    const before = await createClosedDirectoryInventory(f.root);
    await assert.rejects(captureWorkspaceSuccessProfileEvidence(f.input), /profileEvidenceInvalid/);
    assert.equal(f.sqlReads(), 0);
    assert.deepEqual(await createClosedDirectoryInventory(f.root), before);
  });
}

test('hard-linked database is rejected before any SQLite adapter opens it', async (t) => {
  const f = await createProfile(t);
  const original = await readFile(f.databasePaths[0]);
  const alias = resolve(f.root, 'database-alias');
  await link(f.databasePaths[0], alias);
  await assert.rejects(captureWorkspaceSuccessProfileEvidence(f.input), /profileEvidenceInvalid/);
  assert.equal(f.sqlReads(), 0);
  assert.deepEqual(await readFile(alias), original);
  assert.equal((await lstat(alias)).nlink, 2);
});

test('junction workspace is rejected before any SQLite adapter opens it', async (t) => {
  const f = await createProfile(t);
  const workspace = resolve(f.root, 'user-data', 'workspaces', f.state.fixtures[0].workspaceId);
  const outside = resolve(f.root, 'foreign-workspace');
  await mkdir(outside);
  await rm(workspace, { recursive: true });
  await symlink(outside, workspace, 'junction');
  await assert.rejects(captureWorkspaceSuccessProfileEvidence(f.input), /profileEvidenceInvalid/);
  assert.equal(f.sqlReads(), 0);
  assert.equal((await lstat(workspace)).isSymbolicLink(), true);
});

test('foreign revision and missing required metadata fail before SQLite', async (t) => {
  const f = await createProfile(t);
  await assert.rejects(captureWorkspaceSuccessProfileEvidence({ ...f.input,
    request: { ...f.request, buildRevision: 'f'.repeat(40) } }), /profileEvidenceInvalid/);
  await rm(f.acceptedPath);
  await assert.rejects(captureWorkspaceSuccessProfileEvidence(f.input), /profileEvidenceInvalid/);
  assert.equal(f.sqlReads(), 0);
});

test('database mutation during inspection fails instead of recording a new baseline', async (t) => {
  const f = await createProfile(t);
  const originalSnapshot = f.support.snapshotW6b2PackagedWorkspaceEvidence;
  f.support.snapshotW6b2PackagedWorkspaceEvidence = async (persisted) => {
    await writeFile(f.databasePaths[0], 'changed during readonly inspection');
    return originalSnapshot(persisted);
  };
  await assert.rejects(captureWorkspaceSuccessProfileEvidence(f.input), /profileEvidenceInvalid/);
});

test('workspace-scoped installation metadata is rejected without rewriting it', async (t) => {
  const f = await createProfile(t);
  const path = resolve(dirname(dirname(f.databasePaths[0])), 'update-state', 'accepted-build-v1.json');
  await mkdir(dirname(path));
  await writeFile(path, await readFile(f.acceptedPath));
  const before = await createClosedDirectoryInventory(f.root);
  await assert.rejects(captureWorkspaceSuccessProfileEvidence(f.input), /profileEvidenceInvalid/);
  assert.deepEqual(await createClosedDirectoryInventory(f.root), before);
});

test('checkpoint writer publishes once and never overwrites earlier private evidence', async (t) => {
  const f = await createProfile(t);
  await writeWorkspaceSuccessCheckpoint(f.input);
  const path = workspaceSuccessCheckpointPath(f.root, 'sourceBaseline');
  const original = await readFile(path);
  await assert.rejects(writeWorkspaceSuccessCheckpoint(f.input));
  assert.deepEqual(await readFile(path), original);
});

test('optional absence does not treat malformed JSON as absent', async (t) => {
  const f = await createProfile(t);
  const path = resolve(f.root, 'optional.json');
  assert.equal(await readWorkspaceSuccessSettledSlot(path, (value) => value, true), null);
  await writeFile(path, '{invalid');
  await assert.rejects(readWorkspaceSuccessSettledSlot(path, (value) => value, true), /profileEvidenceInvalid/);
});
