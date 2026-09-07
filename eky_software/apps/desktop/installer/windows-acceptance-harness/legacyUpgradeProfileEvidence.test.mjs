import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  captureLegacySourceEvidence,
  captureLegacyTargetEvidence,
  deriveLegacySourceUserDataRoot,
  readAcceptedBuildSlot,
  resolveAcceptedBuildCandidates,
} from './legacyUpgradeProfileEvidence.mjs';

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
