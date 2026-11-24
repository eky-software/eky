import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyLegacySemanticPostconditionFailure,
  validateLegacyUpgradeSemanticEvidence,
} from './legacyUpgradePostcondition.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evidence(overrides = {}) {
  return {
    schemaVersion: 3,
    acceptedCurrentClass: 'targetIdentity',
    acceptedLegacyClass: 'sourceIdentity',
    dataInventory: [
      {
        kind: 'file',
        relativePath: 'eky.sqlite',
        sha256: '1'.repeat(64),
        size: 4096,
      },
    ],
    databaseProof: {
      schemaVersion: 1, mode: 'migration038To039', appVersion: '0.2.7', buildRevision: 'a'.repeat(12),
      contractSha256: '7'.repeat(64), sourceChainSha256: '8'.repeat(64), targetChainSha256: '9'.repeat(64),
    },
    registryFormatVersion: 1,
    promotedRegistrySha256: null,
    registrySha256: '2'.repeat(64),
    registrySize: 512,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    storageInventory: [
      {
        kind: 'file',
        relativePath: 'invoices/approved-invoice.pdf',
        sha256: '3'.repeat(64),
        size: 1024,
      },
    ],
    workspaceId: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

function proof(overrides = {}) {
  const firstEvidence = evidence();
  const secondEvidence = evidence({
    runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
  });
  const expectedPayload = [{ relativePath: 'Eky.exe', sha256: '4'.repeat(64) }];
  return {
    currentEvidence: clone(secondEvidence),
    expectedPayload,
    firstEvidence,
    installedPayload: clone(expectedPayload),
    secondEvidence,
    ...overrides,
  };
}

test('legacy semantic evidence accepts an unchanged second startup and payload', () => {
  assert.deepEqual(validateLegacyUpgradeSemanticEvidence(proof()), {
    status: 'completed',
    resultCode: 'legacySemanticProofValidated',
    businessDataPreserved: true,
    adoptedWorkspaceCount: 1,
    idempotentSecondStartup: true,
  });
});

test('legacy semantic evidence rejects changed current evidence', () => {
  const value = proof();
  value.currentEvidence.registrySha256 = '5'.repeat(64);
  assert.throws(
    () => validateLegacyUpgradeSemanticEvidence(value),
    /legacySemanticEvidenceChanged/,
  );
});

for (const targetAppVersion of ['0.3.1', '0.3.2']) test(`${targetAppVersion} semantic evidence accepts exact promotion and still requires the actual final registry`, () => {
  const value = proof({ targetAppVersion });
  value.firstEvidence.databaseProof.appVersion = value.targetAppVersion;
  value.secondEvidence.databaseProof.appVersion = value.targetAppVersion;
  value.firstEvidence.promotedRegistrySha256 = '5'.repeat(64);
  value.secondEvidence.registryFormatVersion = 2;
  value.secondEvidence.registrySha256 = value.firstEvidence.promotedRegistrySha256;
  value.currentEvidence = clone(value.secondEvidence);
  assert.equal(validateLegacyUpgradeSemanticEvidence(value).resultCode, 'legacySemanticProofValidated');
  assert.throws(() => validateLegacyUpgradeSemanticEvidence({ ...value, targetAppVersion: '0.2.7' }),
    /legacySecondStartupNotIdempotent/);
  const finalChanged = clone(value);
  finalChanged.currentEvidence.registrySha256 = value.firstEvidence.registrySha256;
  assert.throws(() => validateLegacyUpgradeSemanticEvidence(finalChanged), /legacySemanticEvidenceChanged/);
  const alreadyV2 = clone(value);
  alreadyV2.firstEvidence = { ...alreadyV2.secondEvidence, runtimeInstanceId: value.firstEvidence.runtimeInstanceId };
  assert.throws(() => validateLegacyUpgradeSemanticEvidence(alreadyV2), /legacySecondStartupNotIdempotent/);
  for (const field of ['registrySize', 'registrySha256', 'workspaceId', 'dataInventory', 'storageInventory']) {
    const changed = clone(value);
    changed.secondEvidence[field] = value.firstEvidence.runtimeInstanceId;
    changed.currentEvidence = clone(changed.secondEvidence);
    assert.throws(() => validateLegacyUpgradeSemanticEvidence(changed), /legacySecondStartupNotIdempotent/);
  }
});

test('legacy semantic evidence rejects changed installed payload', () => {
  const value = proof();
  value.installedPayload[0].sha256 = '5'.repeat(64);
  assert.throws(
    () => validateLegacyUpgradeSemanticEvidence(value),
    /legacyTargetPayloadChanged/,
  );
});

test('legacy semantic evidence rejects the same runtime generation twice', () => {
  const value = proof();
  value.firstEvidence.runtimeInstanceId = value.secondEvidence.runtimeInstanceId;
  assert.throws(
    () => validateLegacyUpgradeSemanticEvidence(value),
    /legacySecondStartupNotIdempotent/,
  );
});

for (const databaseProof of [null, undefined, {}, { schemaVersion: 1, mode: 'migration038To039' }]) {
  test(`legacy postcondition rejects an absent or incomplete database proof: ${JSON.stringify(databaseProof)}`, () => {
    const value = proof();
    value.firstEvidence.databaseProof = databaseProof;
    value.secondEvidence.databaseProof = databaseProof;
    value.currentEvidence = clone(value.secondEvidence);
    assert.throws(() => validateLegacyUpgradeSemanticEvidence(value), /legacySecondStartupNotIdempotent/);
  });
}

test('legacy postcondition rejects changed database bytes and changed package bindings independently', () => {
  for (const field of ['dataInventory', 'databaseProof']) {
    const value = proof();
    if (field === 'dataInventory') value.firstEvidence.dataInventory[0].sha256 = '5'.repeat(64);
    else value.firstEvidence.databaseProof.buildRevision = 'c'.repeat(12);
    assert.throws(() => validateLegacyUpgradeSemanticEvidence(value), /legacySecondStartupNotIdempotent/);
  }
});

test('legacy semantic postcondition exposes only closed failure classes', () => {
  assert.equal(classifyLegacySemanticPostconditionFailure('installedPayload', new Error('legacyTargetPayloadChanged')), 'legacyTargetPayloadChanged');
  assert.equal(classifyLegacySemanticPostconditionFailure('currentEvidence', new Error('legacyDatabaseLedgerInvalid')), 'legacyDatabaseLedgerInvalid');
  assert.equal(
    classifyLegacySemanticPostconditionFailure(
      'semanticValidation',
      new Error('legacyTargetPayloadChanged'),
    ),
    'legacyTargetPayloadChanged',
  );
  assert.equal(
    classifyLegacySemanticPostconditionFailure(
      'currentEvidence',
      new Error('private detail'),
    ),
    'legacyCurrentEvidenceCaptureFailed',
  );
  assert.equal(
    classifyLegacySemanticPostconditionFailure(
      'unknown',
      new Error('legacyTargetPayloadChanged'),
    ),
    'legacySemanticProofFailed',
  );
});
