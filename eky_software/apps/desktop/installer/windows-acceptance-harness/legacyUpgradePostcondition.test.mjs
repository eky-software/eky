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
    schemaVersion: 1,
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

test('legacy semantic postcondition exposes only closed failure classes', () => {
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
