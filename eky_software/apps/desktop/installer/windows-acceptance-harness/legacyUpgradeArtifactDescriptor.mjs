import {
  createInstallerProductCode,
  INSTALLER_UPGRADE_CODE,
} from '../installerIdentity.mjs';
import {
  compareMsiProductVersions,
  parseMsiProductVersion,
  parseNumericAppVersion,
} from '../installerVersion.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES,
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
  classifyHistoricalWindowsInstallerArtifact,
} from '../scripts/historicalWindowsInstallerFixtureProvenance.mjs';

export const LEGACY_UPGRADE_ARTIFACT_KIND =
  'windowsAcceptanceLegacyUpgrade';
export const LEGACY_UPGRADE_DESCRIPTOR_FILENAME =
  'legacy-upgrade-artifact.json';

const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const RUNTIME_BUILD_REVISION_PATTERN = /^[0-9a-f]{12}$/;
const PRODUCT_CODE_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const DESCRIPTOR_KEYS = [
  'artifactKind',
  'buildRevision',
  'schemaVersion',
  'source',
  'target',
  'upgradeCode',
];
const SOURCE_KEYS = [
  'appVersion',
  'artifactClass',
  'buildRevision',
  'manifestPath',
  'manifestSha256',
  'matchesApprovedArtifact',
  'msiProductVersion',
  'packageSha256',
  'packageSize',
  'productCode',
  'provenancePath',
  'provenanceSha256',
  'runtimeBuildRevision',
];
const TARGET_KEYS = [
  'appVersion',
  'buildRevision',
  'manifestPath',
  'manifestSha256',
  'msiProductVersion',
  'packageSha256',
  'packageSize',
  'payloadInventory',
  'productCode',
];
const PAYLOAD_INVENTORY_KEYS = [
  'fileCount',
  'identity',
  'stage',
  'totalByteSize',
];

function isRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function nextPatchVersion(version) {
  const parts = [...parseMsiProductVersion(version)];
  if (parts[2] >= 65_535) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  parts[2] += 1;
  return parts.join('.');
}

function validateCommonRole(roleName, value, expectedKeys) {
  if (
    !hasExactKeys(value, expectedKeys) ||
    value.manifestPath !== `${roleName}/installer.manifest.json` ||
    typeof value.appVersion !== 'string' ||
    typeof value.msiProductVersion !== 'string' ||
    value.appVersion !== value.msiProductVersion ||
    typeof value.buildRevision !== 'string' ||
    !BUILD_REVISION_PATTERN.test(value.buildRevision) ||
    typeof value.manifestSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.manifestSha256) ||
    typeof value.packageSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.packageSha256) ||
    !Number.isSafeInteger(value.packageSize) ||
    value.packageSize < 1 ||
    typeof value.productCode !== 'string' ||
    !PRODUCT_CODE_PATTERN.test(value.productCode)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  try {
    parseNumericAppVersion(value.appVersion);
    parseMsiProductVersion(value.msiProductVersion);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  if (value.productCode !== createInstallerProductCode(value.msiProductVersion)) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
}

function validateSource(value) {
  validateCommonRole('source', value, SOURCE_KEYS);
  if (
    value.appVersion !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion ||
    value.msiProductVersion !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion ||
    value.buildRevision !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit ||
    value.runtimeBuildRevision !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision ||
    !RUNTIME_BUILD_REVISION_PATTERN.test(value.runtimeBuildRevision) ||
    value.artifactClass !==
      HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.historicalSourceRebuild ||
    typeof value.matchesApprovedArtifact !== 'boolean' ||
    value.provenancePath !==
      'source/historical-fixture-provenance.json' ||
    typeof value.provenanceSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.provenanceSha256)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  const classification = classifyHistoricalWindowsInstallerArtifact({
    packageSha256: value.packageSha256,
    source: 'historical-source-rebuild',
  });
  if (
    classification.artifactClass !== value.artifactClass ||
    classification.matchesApprovedArtifact !== value.matchesApprovedArtifact
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  return Object.freeze({ ...value });
}

function validatePayloadInventory(value) {
  if (
    !hasExactKeys(value, PAYLOAD_INVENTORY_KEYS) ||
    value.stage !== 'packagedApp' ||
    !Number.isSafeInteger(value.fileCount) ||
    value.fileCount < 1 ||
    value.fileCount > 2_800 ||
    !Number.isSafeInteger(value.totalByteSize) ||
    value.totalByteSize < 1 ||
    value.totalByteSize > 536_870_912 ||
    typeof value.identity !== 'string' ||
    !SHA_256_PATTERN.test(value.identity)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  return Object.freeze({ ...value });
}

function validateTarget(value, buildRevision) {
  validateCommonRole('target', value, TARGET_KEYS);
  if (
    value.buildRevision !== buildRevision ||
    value.appVersion !== '0.2.7'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  return Object.freeze({
    ...value,
    payloadInventory: validatePayloadInventory(value.payloadInventory),
  });
}

export function validateLegacyUpgradeArtifactDescriptor(value) {
  if (
    !hasExactKeys(value, DESCRIPTOR_KEYS) ||
    value.schemaVersion !== 1 ||
    value.artifactKind !== LEGACY_UPGRADE_ARTIFACT_KIND ||
    typeof value.buildRevision !== 'string' ||
    !BUILD_REVISION_PATTERN.test(value.buildRevision) ||
    value.upgradeCode !== INSTALLER_UPGRADE_CODE
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  const source = validateSource(value.source);
  const target = validateTarget(value.target, value.buildRevision);
  if (
    nextPatchVersion(source.msiProductVersion) !== target.msiProductVersion ||
    compareMsiProductVersions(
      source.msiProductVersion,
      target.msiProductVersion,
    ) >= 0 ||
    source.productCode === target.productCode ||
    source.packageSha256 === target.packageSha256
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
  return Object.freeze({ ...value, source, target });
}

export function createLegacyUpgradeArtifactDescriptor({
  buildRevision,
  source,
  target,
}) {
  return validateLegacyUpgradeArtifactDescriptor({
    schemaVersion: 1,
    artifactKind: LEGACY_UPGRADE_ARTIFACT_KIND,
    buildRevision,
    source,
    target,
    upgradeCode: INSTALLER_UPGRADE_CODE,
  });
}
