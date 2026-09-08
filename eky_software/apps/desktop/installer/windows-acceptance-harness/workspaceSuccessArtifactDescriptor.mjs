import {
  createInstallerProductCode,
  INSTALLER_UPGRADE_CODE,
} from '../installerIdentity.mjs';
import { INSTALLER_PACKAGE_MAX_BYTES } from '../installerManifest.mjs';

export const WORKSPACE_SUCCESS_ARTIFACT_KIND =
  'windowsAcceptanceWorkspaceSuccess';
export const WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME =
  'workspace-success-artifact.json';
export const WORKSPACE_SUCCESS_VERSIONS = Object.freeze({
  source: '0.2.7',
  target: '0.2.8',
});

const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DESCRIPTOR_KEYS = [
  'artifactKind', 'buildRevision', 'schemaVersion', 'source', 'target',
  'upgradeCode',
];
const ROLE_KEYS = [
  'appVersion', 'buildRevision', 'manifestPath', 'manifestSha256',
  'msiProductVersion', 'packageSha256', 'packageSize', 'payloadInventory',
  'productCode',
];
const INVENTORY_KEYS = ['fileCount', 'identity', 'stage', 'totalByteSize'];
const MAX_PAYLOAD_FILES = 2_800;
const INVALID = 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_DESCRIPTOR_INVALID';

function hasExactKeys(value, keys) {
  return (
    value !== null && typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function validateRole(roleName, role, buildRevision) {
  if (
    !hasExactKeys(role, ROLE_KEYS) ||
    role.appVersion !== WORKSPACE_SUCCESS_VERSIONS[roleName] ||
    role.msiProductVersion !== role.appVersion ||
    // The package runtime uses the canonical 12-character build-info revision.
    role.buildRevision !== buildRevision.slice(0, 12) ||
    role.manifestPath !== `${roleName}/installer.manifest.json` ||
    !isSha256(role.manifestSha256) || !isSha256(role.packageSha256) ||
    !Number.isSafeInteger(role.packageSize) || role.packageSize < 1 ||
    role.packageSize > INSTALLER_PACKAGE_MAX_BYTES ||
    role.productCode !== createInstallerProductCode(role.msiProductVersion)
  ) {
    throw new Error(INVALID);
  }
  const inventory = role.payloadInventory;
  if (
    !hasExactKeys(inventory, INVENTORY_KEYS) ||
    inventory.stage !== 'packagedApp' || !isSha256(inventory.identity) ||
    !Number.isSafeInteger(inventory.fileCount) || inventory.fileCount < 1 ||
    inventory.fileCount > MAX_PAYLOAD_FILES ||
    !Number.isSafeInteger(inventory.totalByteSize) ||
    inventory.totalByteSize < 1 ||
    inventory.totalByteSize > INSTALLER_PACKAGE_MAX_BYTES
  ) {
    throw new Error(INVALID);
  }
  return Object.freeze({
    ...role,
    payloadInventory: Object.freeze({ ...inventory }),
  });
}

export function validateWorkspaceSuccessArtifactDescriptor(value) {
  if (
    !hasExactKeys(value, DESCRIPTOR_KEYS) || value.schemaVersion !== 1 ||
    value.artifactKind !== WORKSPACE_SUCCESS_ARTIFACT_KIND ||
    typeof value.buildRevision !== 'string' || !REVISION.test(value.buildRevision) ||
    value.upgradeCode !== INSTALLER_UPGRADE_CODE
  ) {
    throw new Error(INVALID);
  }
  const source = validateRole('source', value.source, value.buildRevision);
  const target = validateRole('target', value.target, value.buildRevision);
  if (
    source.packageSha256 === target.packageSha256 ||
    source.manifestSha256 === target.manifestSha256 ||
    source.payloadInventory.identity === target.payloadInventory.identity
  ) {
    throw new Error(INVALID);
  }
  return Object.freeze({ ...value, source, target });
}

export function createWorkspaceSuccessArtifactDescriptor({
  buildRevision, source, target,
}) {
  return validateWorkspaceSuccessArtifactDescriptor({
    schemaVersion: 1,
    artifactKind: WORKSPACE_SUCCESS_ARTIFACT_KIND,
    buildRevision,
    upgradeCode: INSTALLER_UPGRADE_CODE,
    source,
    target,
  });
}
