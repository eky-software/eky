import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  INSTALLER_MANIFEST_MAX_BYTES,
  INSTALLER_PACKAGE_MAX_BYTES,
  parseInstallerManifestBytes,
} from '../installerManifest.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import {
  WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME,
  validateWorkspaceSuccessArtifactDescriptor,
} from './workspaceSuccessArtifactDescriptor.mjs';

const INVALID = 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_INVALID';
const CHANGED = 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_IDENTITY_MISMATCH';

function sameMetadata(left, right) {
  return ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs']
    .every((key) => left[key] === right[key]);
}

function requireFile(metadata, maximumBytes) {
  if (
    !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
    metadata.size < 1n || metadata.size > BigInt(maximumBytes)
  ) {
    throw new Error(INVALID);
  }
}

async function inspectArtifactFile(path, maximumBytes, retainBytes = false) {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    requireFile(before, maximumBytes);
    handle = await open(path, 'r');
    if (!sameMetadata(before, await handle.stat({ bigint: true }))) {
      throw new Error(CHANGED);
    }
    const hash = createHash('sha256');
    const chunks = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > maximumBytes || BigInt(size) > before.size) {
        throw new Error(CHANGED);
      }
      hash.update(chunk);
      if (retainBytes) chunks.push(chunk);
    }
    const after = await lstat(path, { bigint: true });
    requireFile(after, maximumBytes);
    if (
      !sameMetadata(before, after) || BigInt(size) !== before.size ||
      !sameMetadata(before, await handle.stat({ bigint: true }))
    ) {
      throw new Error(CHANGED);
    }
    return Object.freeze({
      sha256: hash.digest('hex'), size,
      ...(retainBytes ? { bytes: Buffer.concat(chunks) } : {}),
    });
  } catch (error) {
    throw new Error(error?.message === CHANGED ? CHANGED : INVALID);
  } finally {
    await handle?.close().catch(() => { throw new Error(INVALID); });
  }
}

export async function hashWorkspaceSuccessArtifactFile(path) {
  return inspectArtifactFile(path, INSTALLER_PACKAGE_MAX_BYTES);
}

async function requireClosedDirectory(path, expectedNames) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(INVALID);
    }
    const names = (await readdir(path)).sort();
    const expected = [...expectedNames].sort();
    if (
      names.length !== expected.length ||
      names.some((name, index) => name !== expected[index])
    ) {
      throw new Error(INVALID);
    }
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_INVENTORY_INVALID');
  }
}

async function verifyRole(root, roleName, role) {
  const roleRoot = resolve(root, roleName);
  const packageFilename = `Eky-${role.appVersion}-x64.msi`;
  const names = ['installer.manifest.json', packageFilename];
  await requireClosedDirectory(roleRoot, names);
  const manifestPath = resolve(root, role.manifestPath);
  const manifestFile = await inspectArtifactFile(
    manifestPath, INSTALLER_MANIFEST_MAX_BYTES, true,
  );
  if (manifestFile.sha256 !== role.manifestSha256) throw new Error(CHANGED);
  let manifest;
  try {
    manifest = parseInstallerManifestBytes(manifestFile.bytes);
  } catch {
    throw new Error(INVALID);
  }
  for (const key of [
    'appVersion', 'buildRevision', 'msiProductVersion', 'packageSha256', 'packageSize',
  ]) {
    if (manifest[key] !== role[key]) throw new Error(CHANGED);
  }
  const installerPath = resolve(roleRoot, packageFilename);
  const installer = await hashWorkspaceSuccessArtifactFile(installerPath);
  if (installer.sha256 !== role.packageSha256 || installer.size !== role.packageSize) {
    throw new Error(CHANGED);
  }
  await requireClosedDirectory(roleRoot, names);
  return Object.freeze({ ...role, installerPath, manifestPath, manifest });
}

export async function verifyWorkspaceSuccessArtifact({
  artifactRoot: inputRoot, expectedBuildRevision, expectedDescriptorSha256,
}) {
  if (
    typeof inputRoot !== 'string' || inputRoot.trim() === '' ||
    typeof expectedBuildRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(expectedBuildRevision) ||
    typeof expectedDescriptorSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedDescriptorSha256)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_IDENTITY_INVALID');
  }
  const requestedRoot = resolve(inputRoot);
  const names = [WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME, 'source', 'target'];
  await requireClosedDirectory(requestedRoot, names);
  const artifactRoot = await realpath(requestedRoot).catch(() => { throw new Error(INVALID); });
  const descriptorPath = resolve(artifactRoot, WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME);
  const before = await inspectArtifactFile(descriptorPath, INSTALLER_MANIFEST_MAX_BYTES, true);
  if (before.sha256 !== expectedDescriptorSha256) throw new Error(CHANGED);
  const descriptor = validateWorkspaceSuccessArtifactDescriptor(
    parseStrictJsonObjectBytes(before.bytes, { errorCode: INVALID }),
  );
  if (descriptor.buildRevision !== expectedBuildRevision) throw new Error(CHANGED);
  const source = await verifyRole(artifactRoot, 'source', descriptor.source);
  const target = await verifyRole(artifactRoot, 'target', descriptor.target);
  const after = await inspectArtifactFile(descriptorPath, INSTALLER_MANIFEST_MAX_BYTES);
  if (before.sha256 !== after.sha256 || before.size !== after.size) throw new Error(CHANGED);
  await requireClosedDirectory(artifactRoot, names);
  return Object.freeze({
    schemaVersion: 1,
    status: 'completed',
    resultCode: 'workspaceSuccessArtifactVerified',
    artifactRoot, descriptorPath, descriptorSha256: after.sha256,
    buildRevision: descriptor.buildRevision, descriptor, source, target,
  });
}
