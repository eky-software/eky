import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, toNamespacedPath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  captureLegacySourceEvidence,
  captureLegacyTargetEvidence,
  deriveLegacySourceUserDataRoot,
  readAcceptedBuildSlot,
  resolveAcceptedBuildCandidates,
  validateLegacyTargetEvidence,
  writeLegacyTargetEvidence,
  readLegacyTargetEvidence,
  writeLegacySourceEvidence,
  LEGACY_SOURCE_EVIDENCE_FILENAME,
  LEGACY_FIRST_START_EVIDENCE_FILENAME,
  LEGACY_SECOND_START_EVIDENCE_FILENAME,
} from './legacyUpgradeProfileEvidence.mjs';
import { createLegacyDatabaseFixture, createLegacyDatabasePackageFixture, TARGET_DATABASE_IDENTITY,
  writeLegacyDatabaseBuildInfoFixture } from './legacyUpgradeDatabaseEvidence.fixture.mjs';
import { readLegacyDatabaseContract, verifyLegacyUpgradeDatabaseEvidence } from './legacyUpgradeDatabaseEvidence.mjs';
import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import { verifyLegacyUpgradeSemanticPostcondition } from './legacyUpgradePostcondition.mjs';

const SOURCE = Object.freeze({ appVersion: '0.2.6', buildRevision: 'a'.repeat(12) });
const TARGET = Object.freeze({ appVersion: '0.2.7', buildRevision: 'b'.repeat(40) });
const IDENTITIES = Object.freeze({ source: SOURCE, target: TARGET });
const RUN_NONCE = 'c'.repeat(64);
const WORKSPACE_ID = '12345678-1234-4abc-8abc-1234567890ab';
const RUNTIME_ONE = '22345678-1234-4abc-8abc-1234567890ab';
const RUNTIME_TWO = '32345678-1234-4abc-8abc-1234567890ab';

function accepted(identity) {
  return {
    acceptedAt: '2026-09-04T08:00:00.000Z',
    appVersion: identity.appVersion,
    buildRevision: identity.buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  };
}

function candidate(state, value = null) {
  return { state, value };
}

test('accepted build slots use deterministic precedence and reject conflicts', () => {
  const source = accepted(SOURCE);
  assert.deepEqual(
    resolveAcceptedBuildCandidates({
      current: candidate('present', source),
      backup: candidate('missing'),
      next: candidate('missing'),
    }),
    candidate('present', source),
  );
  assert.equal(
    resolveAcceptedBuildCandidates({
      current: candidate('present', source),
      backup: candidate('present', accepted(TARGET)),
      next: candidate('missing'),
    }).state,
    'invalid',
  );
  assert.equal(
    resolveAcceptedBuildCandidates({
      current: candidate('missing'),
      backup: candidate('present', source),
      next: candidate('present', { ...source }),
    }).state,
    'present',
  );
  assert.equal(
    resolveAcceptedBuildCandidates({
      current: candidate('missing'),
      backup: candidate('invalid'),
      next: candidate('missing'),
    }).state,
    'invalid',
  );
});

test('accepted build reader rejects a permanently corrupt recovery slot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-accepted-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, 'accepted-build-v1.json');
  await writeFile(`${path}.backup`, '{invalid', 'utf8');
  assert.equal((await readAcceptedBuildSlot(path)).state, 'invalid');
});

test('source and target evidence prove copy adoption and idempotent second start', async (t) => {
  const scenarioRoot = await mkdtemp(join(tmpdir(), 'eky-legacy-evidence-'));
  t.after(() => rm(scenarioRoot, { recursive: true, force: true }));
  const userDataRoot = deriveLegacySourceUserDataRoot(scenarioRoot, RUN_NONCE);
  const legacyData = resolve(userDataRoot, 'runtime', 'data');
  const legacyStorage = resolve(userDataRoot, 'runtime', 'storage', 'invoices', 'one');
  await mkdir(legacyData, { recursive: true });
  await mkdir(legacyStorage, { recursive: true });
  await writeFile(resolve(legacyData, 'eky.sqlite'), 'sqlite-fixture');
  await writeFile(resolve(legacyStorage, 'approved-invoice.pdf'), '%PDF-fixture');
  await mkdir(resolve(userDataRoot, 'update-state'), { recursive: true });
  await writeFile(
    resolve(userDataRoot, 'update-state', 'accepted-build-v1.json'),
    `${JSON.stringify(accepted(SOURCE))}\n`,
  );
  const sourceEvidence = await captureLegacySourceEvidence({
    identities: IDENTITIES,
    scenarioRoot,
    runNonce: RUN_NONCE,
  });

  await writeFile(
    resolve(userDataRoot, 'update-state', 'accepted-build-v1.json'),
    `${JSON.stringify(accepted({ ...TARGET, buildRevision: TARGET.buildRevision.slice(0, 12) }))}\n`,
  );
  const workspaceRuntime = resolve(userDataRoot, 'workspaces', WORKSPACE_ID, 'runtime');
  await mkdir(resolve(workspaceRuntime, 'data'), { recursive: true });
  await mkdir(resolve(workspaceRuntime, 'storage', 'invoices', 'one'), { recursive: true });
  await writeFile(resolve(workspaceRuntime, 'data', 'eky.sqlite'), 'sqlite-fixture');
  await writeFile(
    resolve(workspaceRuntime, 'storage', 'invoices', 'one', 'approved-invoice.pdf'),
    '%PDF-fixture',
  );
  await writeFile(
    resolve(userDataRoot, 'workspace-registry-v1.json'),
    `${JSON.stringify({
      formatVersion: 1,
      activeWorkspaceId: WORKSPACE_ID,
      workspaces: [
        {
          workspaceId: WORKSPACE_ID,
          workspaceLabel: 'Oma yritys',
          lineageIdentity: { formatVersion: 1, profileId: 'd'.repeat(64) },
          layoutVersion: 1,
          lifecycleState: 'ready',
          createdAt: '2026-09-04T08:00:00.000Z',
        },
      ],
    })}\n`,
  );

  const first = await captureLegacyTargetEvidence({
    identities: IDENTITIES,
    runtimeInstanceId: RUNTIME_ONE,
    sourceEvidence,
    userDataRoot,
  });
  const second = await captureLegacyTargetEvidence({
    identities: IDENTITIES,
    previousEvidence: first,
    runtimeInstanceId: RUNTIME_TWO,
    sourceEvidence,
    userDataRoot,
  });
  assert.equal(second.workspaceId, WORKSPACE_ID);
  assert.notEqual(second.runtimeInstanceId, first.runtimeInstanceId);

  for (const [path, original, changed, errorCode] of [
    [resolve(legacyData, 'eky.sqlite'), 'sqlite-fixture', 'changed-sqlite-fixture', 'legacySourceDataChanged'],
    [resolve(legacyStorage, 'approved-invoice.pdf'), '%PDF-fixture', '%PDF-changed-fixture', 'legacySourceStorageChanged'],
    [resolve(workspaceRuntime, 'data', 'eky.sqlite'), 'sqlite-fixture', 'changed-sqlite-fixture', 'legacyAdoptedDataMismatch'],
    [resolve(workspaceRuntime, 'storage', 'invoices', 'one', 'approved-invoice.pdf'), '%PDF-fixture', '%PDF-changed-fixture', 'legacyAdoptedStorageMismatch'],
  ]) {
    await t.test(`rejects ${errorCode} without accepting changed bytes`, async () => {
      await writeFile(path, changed);
      try {
        await assert.rejects(captureLegacyTargetEvidence({
          identities: IDENTITIES, runtimeInstanceId: RUNTIME_ONE, sourceEvidence, userDataRoot,
        }), error => error.message === errorCode);
      } finally {
        await writeFile(path, original);
      }
    });
  }
});

test('target evidence rejects changed adopted business bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-mismatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    captureLegacyTargetEvidence({
      identities: IDENTITIES,
      runtimeInstanceId: RUNTIME_ONE,
      sourceEvidence: { dataInventory: [], storageInventory: [], pdfRelativePath: 'approved-invoice.pdf' },
      userDataRoot: root,
    }),
    /acceptedBuildIdentityInvalid|acceptedBuildInvalid/,
  );
});

test('real migration is required at first adoption and complete bytes are required at the second start', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-migration-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = await createLegacyDatabaseFixture(resolve(root, 'database-fixture'));
  const userDataRoot = deriveLegacySourceUserDataRoot(root, RUN_NONCE);
  await mkdir(userDataRoot, { recursive: true });
  await rename(dirname(paths.sourceDataRoot), resolve(userDataRoot, 'runtime'));
  await mkdir(resolve(userDataRoot, 'update-state'));
  const acceptedPath = resolve(userDataRoot, 'update-state', 'accepted-build-v1.json');
  await writeFile(acceptedPath, JSON.stringify(accepted(SOURCE)));
  const sourceEvidence = await captureLegacySourceEvidence({ identities: IDENTITIES, scenarioRoot: root, runNonce: RUN_NONCE });
  await mkdir(resolve(userDataRoot, 'workspaces', WORKSPACE_ID), { recursive: true });
  const targetRoot = resolve(userDataRoot, 'workspaces', WORKSPACE_ID, 'runtime');
  await rename(dirname(paths.targetDataRoot), targetRoot);
  await writeFile(acceptedPath, JSON.stringify(accepted(TARGET_DATABASE_IDENTITY)));
  await writeFile(resolve(userDataRoot, 'workspace-registry-v1.json'), JSON.stringify({
    formatVersion: 1, activeWorkspaceId: WORKSPACE_ID, workspaces: [{ workspaceId: WORKSPACE_ID,
      workspaceLabel: 'Oma yritys', lineageIdentity: { formatVersion: 1, profileId: 'd'.repeat(64) },
      layoutVersion: 1, lifecycleState: 'ready', createdAt: '2026-09-04T08:00:00.000Z' }],
  }));
  const { contract, contractSha256 } = await readLegacyDatabaseContract();
  const packageBinding = { ...TARGET_DATABASE_IDENTITY, contractSha256, migrationCount: 39,
    migrationChainSha256: contract.migrations[38].chainSha256 };
  const input = { identities: IDENTITIES, sourceEvidence, userDataRoot };
  await assert.rejects(captureLegacyTargetEvidence({ ...input, runtimeInstanceId: RUNTIME_ONE }), /legacyAdoptedDataMismatch/);
  const first = await captureLegacyTargetEvidence({ ...input, packageBinding, runtimeInstanceId: RUNTIME_ONE });
  assert.equal(first.databaseProof.mode, 'migration038To039');
  const evidencePath = resolve(root, 'first-evidence.json');
  await writeLegacyTargetEvidence(evidencePath, first);
  assert.deepEqual(await readLegacyTargetEvidence(evidencePath), first);
  const second = await captureLegacyTargetEvidence({ ...input, packageBinding, previousEvidence: first, runtimeInstanceId: RUNTIME_TWO });
  assert.equal(second.workspaceId, first.workspaceId);
  assert.notEqual(second.runtimeInstanceId, first.runtimeInstanceId);
  const evidenceRoot = resolve(root, 'private-evidence');
  await mkdir(evidenceRoot);
  await writeLegacySourceEvidence(resolve(evidenceRoot, LEGACY_SOURCE_EVIDENCE_FILENAME), sourceEvidence);
  await writeLegacyTargetEvidence(resolve(evidenceRoot, LEGACY_FIRST_START_EVIDENCE_FILENAME), first);
  await writeLegacyTargetEvidence(resolve(evidenceRoot, LEGACY_SECOND_START_EVIDENCE_FILENAME), second);
  const localAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = resolve(root, 'local-app-data');
  t.after(() => { if (localAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = localAppData; });
  const installRoot = resolve(process.env.LOCALAPPDATA, 'Programs', 'Eky');
  await createLegacyDatabasePackageFixture(installRoot);
  const payloadInventory = await inspectPackageArtifactInventory({ root: installRoot, stage: 'packagedApp' });
  const artifact = { source: { ...SOURCE, runtimeBuildRevision: SOURCE.buildRevision },
    target: { ...TARGET, payloadInventory }, artifactRoot: resolve(root, 'missing-artifact') };
  const postconditionInput = { artifact, runtimeRoot: root, runNonce: RUN_NONCE };
  // This synthetic package exercises the real reader; final artifact acceptance remains independent.
  assert.deepEqual(await verifyLegacyUpgradeSemanticPostcondition(postconditionInput), {
    status: 'failed', errorCode: 'legacyArtifactReverificationFailed',
  });
  const buildPath = resolve(installRoot, 'resources/app.asar');
  const originalArchive = await readFile(buildPath);
  await writeLegacyDatabaseBuildInfoFixture(installRoot, { ...TARGET_DATABASE_IDENTITY,
    schemaVersion: 1, buildDirty: false, buildCreatedAt: '2026-09-04T08:00:00.000Z', buildRevision: 'c'.repeat(12) });
  assert.deepEqual(await verifyLegacyUpgradeSemanticPostcondition(postconditionInput), {
    status: 'failed', errorCode: 'legacyTargetPayloadChanged',
  });
  artifact.target.payloadInventory = await inspectPackageArtifactInventory({ root: installRoot, stage: 'packagedApp' });
  assert.deepEqual(await verifyLegacyUpgradeSemanticPostcondition(postconditionInput), {
    status: 'failed', errorCode: 'legacyDatabasePackageBindingInvalid',
  });
  await writeFile(buildPath, originalArchive);
  artifact.target.payloadInventory = payloadInventory;
  for (const proof of [undefined, {}, { ...first.databaseProof, extra: 'not-allowed' },
    { ...first.databaseProof, appVersion: ['0.2.7'] }, { ...first.databaseProof, buildRevision: ['b'.repeat(12)] }]) {
    assert.throws(() => validateLegacyTargetEvidence({ ...first, databaseProof: proof }), /legacyTargetEvidenceInvalid/);
  }
  const file = resolve(targetRoot, 'data', 'eky.sqlite');
  const bytes = await readFile(file);
  const database = new DatabaseSync(toNamespacedPath(file));
  try { database.exec('PRAGMA user_version = 99'); } finally { database.close(); }
  const proofInput = { sourceDataRoot: resolve(userDataRoot, 'runtime', 'data'),
    sourceStorageRoot: resolve(userDataRoot, 'runtime', 'storage'), targetDataRoot: resolve(targetRoot, 'data'),
    targetStorageRoot: resolve(targetRoot, 'storage'), packageBinding };
  assert.equal((await verifyLegacyUpgradeDatabaseEvidence(proofInput)).mode, 'migration038To039');
  await assert.rejects(captureLegacyTargetEvidence({ ...input, packageBinding, previousEvidence: first,
    runtimeInstanceId: RUNTIME_TWO }), /targetSecondStartupNotIdempotent/);
  await writeFile(file, bytes);
  await writeFile(resolve(targetRoot, 'data', 'unexpected.bin'), 'unexpected');
  await assert.rejects(captureLegacyTargetEvidence({ ...input, packageBinding, runtimeInstanceId: RUNTIME_TWO }), /legacyAdoptedDataMismatch/);
});
