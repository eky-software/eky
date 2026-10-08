import { resolve } from 'node:path';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import {
  LEGACY_FIRST_START_EVIDENCE_FILENAME,
  LEGACY_SECOND_START_EVIDENCE_FILENAME,
  LEGACY_SOURCE_EVIDENCE_FILENAME,
  captureLegacyTargetEvidence,
  deriveLegacySourceUserDataRoot,
  readLegacySourceEvidence,
  readLegacyTargetEvidence,
} from './legacyUpgradeProfileEvidence.mjs';
import { verifyLegacyUpgradeArtifact } from './legacyUpgradeArtifact.mjs';
import { LEGACY_DATABASE_ERROR_CODES, isLegacyDatabaseProof, readLegacyDatabasePackageBinding } from './legacyUpgradeDatabaseEvidence.mjs';

const POSTCONDITION_FAILURE_CODES = Object.freeze({
  artifact: 'legacyArtifactReverificationFailed',
  currentEvidence: 'legacyCurrentEvidenceCaptureFailed',
  firstEvidence: 'legacyFirstEvidenceReadFailed',
  installedPayload: 'legacyInstalledPayloadInspectionFailed',
  secondEvidence: 'legacySecondEvidenceReadFailed',
  sourceEvidence: 'legacySourceEvidenceReadFailed',
});
const SEMANTIC_VALIDATION_FAILURE_CODES = new Set([
  'legacySecondStartupNotIdempotent',
  'legacySemanticEvidenceChanged',
  'legacyTargetPayloadChanged',
]);

export const LEGACY_SEMANTIC_POSTCONDITION_FAILURE_CODES = Object.freeze([
  ...Object.keys(LEGACY_DATABASE_ERROR_CODES),
  ...Object.values(POSTCONDITION_FAILURE_CODES),
  ...SEMANTIC_VALIDATION_FAILURE_CODES,
  'legacySemanticProofFailed',
]);

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function classifyLegacySemanticPostconditionFailure(stage, error) {
  if (stage === 'currentEvidence' && Object.hasOwn(LEGACY_DATABASE_ERROR_CODES, error?.message)) return error.message;
  if (
    ['semanticValidation', 'installedPayload'].includes(stage) &&
    typeof error?.message === 'string' &&
    SEMANTIC_VALIDATION_FAILURE_CODES.has(error.message)
  ) {
    return error.message;
  }
  return POSTCONDITION_FAILURE_CODES[stage] ?? 'legacySemanticProofFailed';
}

export function validateLegacyUpgradeSemanticEvidence({
  currentEvidence,
  expectedPayload,
  firstEvidence,
  installedPayload,
  secondEvidence,
}) {
  if (!equal(currentEvidence, secondEvidence)) {
    throw new Error('legacySemanticEvidenceChanged');
  }
  if (
    !isLegacyDatabaseProof(firstEvidence.databaseProof) || !isLegacyDatabaseProof(secondEvidence.databaseProof) ||
    !equal(firstEvidence.databaseProof, secondEvidence.databaseProof) ||
    firstEvidence.runtimeInstanceId === secondEvidence.runtimeInstanceId ||
    firstEvidence.workspaceId !== secondEvidence.workspaceId ||
    firstEvidence.registrySha256 !== secondEvidence.registrySha256 ||
    firstEvidence.registrySize !== secondEvidence.registrySize ||
    !equal(firstEvidence.dataInventory, secondEvidence.dataInventory) ||
    !equal(firstEvidence.storageInventory, secondEvidence.storageInventory)
  ) {
    throw new Error('legacySecondStartupNotIdempotent');
  }
  if (!equal(installedPayload, expectedPayload)) {
    throw new Error('legacyTargetPayloadChanged');
  }
  return Object.freeze({
    status: 'completed',
    resultCode: 'legacySemanticProofValidated',
    businessDataPreserved: true,
    adoptedWorkspaceCount: 1,
    idempotentSecondStartup: true,
  });
}

export async function verifyLegacyUpgradeSemanticPostcondition({
  artifact,
  runNonce,
  runtimeRoot,
}) {
  let stage = 'sourceEvidence';
  try {
    const evidenceRoot = resolve(runtimeRoot, 'private-evidence');
    const sourceEvidence = await readLegacySourceEvidence(
      resolve(evidenceRoot, LEGACY_SOURCE_EVIDENCE_FILENAME),
    );
    stage = 'firstEvidence';
    const firstEvidence = await readLegacyTargetEvidence(
      resolve(evidenceRoot, LEGACY_FIRST_START_EVIDENCE_FILENAME),
    );
    stage = 'secondEvidence';
    const secondEvidence = await readLegacyTargetEvidence(
      resolve(evidenceRoot, LEGACY_SECOND_START_EVIDENCE_FILENAME),
    );
    const identities = Object.freeze({
      source: Object.freeze({
        appVersion: artifact.source.appVersion,
        buildRevision: artifact.source.runtimeBuildRevision,
      }),
      target: Object.freeze({
        appVersion: artifact.target.appVersion,
        buildRevision: artifact.target.buildRevision,
      }),
    });
    const installRoot = resolve(process.env.LOCALAPPDATA, 'Programs', 'Eky');
    stage = 'installedPayload';
    const installedPayload = await inspectPackageArtifactInventory({ root: installRoot, stage: 'packagedApp' });
    if (!equal(installedPayload, artifact.target.payloadInventory)) throw new Error('legacyTargetPayloadChanged');
    stage = 'currentEvidence';
    const packageBinding = await readLegacyDatabasePackageBinding(installRoot, identities.target);
    const current = await captureLegacyTargetEvidence({
      identities,
      packageBinding,
      previousEvidence: firstEvidence,
      runtimeInstanceId: secondEvidence.runtimeInstanceId,
      sourceEvidence,
      userDataRoot: deriveLegacySourceUserDataRoot(runtimeRoot, runNonce),
    });
    stage = 'semanticValidation';
    const semanticResult = validateLegacyUpgradeSemanticEvidence({
      currentEvidence: current,
      expectedPayload: artifact.target.payloadInventory,
      firstEvidence,
      installedPayload,
      secondEvidence,
    });
    stage = 'artifact';
    await verifyLegacyUpgradeArtifact({
      artifactRoot: artifact.artifactRoot,
      expectedBuildRevision: artifact.buildRevision,
      expectedDescriptorSha256: artifact.descriptorSha256,
    });
    return semanticResult;
  } catch (error) {
    return Object.freeze({
      status: 'failed',
      errorCode: classifyLegacySemanticPostconditionFailure(stage, error),
    });
  }
}
