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

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  scenarioRoot,
}) {
  try {
    const evidenceRoot = resolve(scenarioRoot, 'private-evidence');
    const sourceEvidence = await readLegacySourceEvidence(
      resolve(evidenceRoot, LEGACY_SOURCE_EVIDENCE_FILENAME),
    );
    const firstEvidence = await readLegacyTargetEvidence(
      resolve(evidenceRoot, LEGACY_FIRST_START_EVIDENCE_FILENAME),
    );
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
    const current = await captureLegacyTargetEvidence({
      identities,
      previousEvidence: firstEvidence,
      runtimeInstanceId: secondEvidence.runtimeInstanceId,
      sourceEvidence,
      userDataRoot: deriveLegacySourceUserDataRoot(scenarioRoot, runNonce),
    });
    const installedPayload = await inspectPackageArtifactInventory({
      root: resolve(process.env.LOCALAPPDATA, 'Programs', 'Eky'),
      stage: 'packagedApp',
    });
    const semanticResult = validateLegacyUpgradeSemanticEvidence({
      currentEvidence: current,
      expectedPayload: artifact.target.payloadInventory,
      firstEvidence,
      installedPayload,
      secondEvidence,
    });
    await verifyLegacyUpgradeArtifact({
      artifactRoot: artifact.artifactRoot,
      expectedBuildRevision: artifact.buildRevision,
      expectedDescriptorSha256: artifact.descriptorSha256,
    });
    return semanticResult;
  } catch {
    return Object.freeze({
      status: 'failed',
      errorCode: 'legacySemanticProofFailed',
    });
  }
}
