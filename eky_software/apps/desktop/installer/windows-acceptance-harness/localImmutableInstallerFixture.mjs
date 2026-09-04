import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  realpath,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';

async function hashFile(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return Object.freeze({ sha256: hash.digest('hex'), size });
}

async function requireStandaloneRegularFile(path, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1n ||
      metadata.nlink !== 1n
    ) {
      throw new Error(errorCode);
    }
    return metadata;
  } catch {
    throw new Error(errorCode);
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function materializeLocalImmutableFixture(
  manifestInputPath,
  runRoot,
) {
  const requestedManifestPath = resolve(manifestInputPath);
  await requireStandaloneRegularFile(
    requestedManifestPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID',
  );
  const sourceManifestPath = await realpath(requestedManifestPath).catch(() => {
    throw new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID');
  });
  const sourceManifestMetadata = await requireStandaloneRegularFile(
    sourceManifestPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID',
  );
  const manifest = await readInstallerManifest(sourceManifestPath);
  const sourceInstallerPath = resolve(
    dirname(sourceManifestPath),
    manifest.packageFilename,
  );
  if (dirname(sourceInstallerPath) !== dirname(sourceManifestPath)) {
    throw new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID');
  }
  const sourceInstallerMetadata = await requireStandaloneRegularFile(
    sourceInstallerPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID',
  );
  await verifyInstallerManifestPackage({
    installerPath: sourceInstallerPath,
    manifest,
  });
  const sourceManifestIdentity = await hashFile(sourceManifestPath);

  const fixtureRoot = resolve(runRoot, 'fixture');
  await mkdir(fixtureRoot, { recursive: false });
  const fixtureManifestPath = resolve(fixtureRoot, 'installer.manifest.json');
  const fixtureInstallerPath = resolve(fixtureRoot, manifest.packageFilename);
  await copyFile(
    sourceManifestPath,
    fixtureManifestPath,
    constants.COPYFILE_EXCL,
  );
  await copyFile(
    sourceInstallerPath,
    fixtureInstallerPath,
    constants.COPYFILE_EXCL,
  );

  const fixtureManifestMetadata = await requireStandaloneRegularFile(
    fixtureManifestPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_COPY_INVALID',
  );
  const fixtureInstallerMetadata = await requireStandaloneRegularFile(
    fixtureInstallerPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_COPY_INVALID',
  );
  if (
    sameFileIdentity(sourceManifestMetadata, fixtureManifestMetadata) ||
    sameFileIdentity(sourceInstallerMetadata, fixtureInstallerMetadata)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_COPY_INVALID');
  }
  const copiedManifest = await readInstallerManifest(fixtureManifestPath);
  if (JSON.stringify(copiedManifest) !== JSON.stringify(manifest)) {
    throw new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_COPY_INVALID');
  }
  await verifyInstallerManifestPackage({
    installerPath: fixtureInstallerPath,
    manifest: copiedManifest,
  });
  const descriptorIdentity = await hashFile(fixtureManifestPath);
  if (
    descriptorIdentity.sha256 !== sourceManifestIdentity.sha256 ||
    descriptorIdentity.size !== sourceManifestIdentity.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_COPY_INVALID');
  }

  return Object.freeze({
    artifactDescriptorSha256: descriptorIdentity.sha256,
    fixtureRoot,
    manifest,
    packageSha256: manifest.packageSha256,
    sourceInstallerPath,
    sourceManifestIdentity,
    sourceManifestPath,
  });
}

export async function verifyLocalImmutableSourceFixture(fixture) {
  await requireStandaloneRegularFile(
    fixture.sourceManifestPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED',
  );
  await requireStandaloneRegularFile(
    fixture.sourceInstallerPath,
    'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED',
  );
  const identity = await hashFile(fixture.sourceManifestPath);
  if (
    identity.sha256 !== fixture.sourceManifestIdentity.sha256 ||
    identity.size !== fixture.sourceManifestIdentity.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED');
  }
  const manifest = await readInstallerManifest(fixture.sourceManifestPath);
  await verifyInstallerManifestPackage({
    installerPath: fixture.sourceInstallerPath,
    manifest,
  });
}
