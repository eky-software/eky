import { constants } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  hashLegacyUpgradeArtifactFile,
  verifyLegacyUpgradeArtifact,
} from './legacyUpgradeArtifact.mjs';

async function copyExclusive(sourcePath, targetPath) {
  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
}

export async function materializeLegacyUpgradeArtifactFixture(
  descriptorInputPath,
  fixtureRootInput,
) {
  const descriptorPath = resolve(descriptorInputPath);
  if (
    descriptorPath !==
    resolve(dirname(descriptorPath), LEGACY_UPGRADE_DESCRIPTOR_FILENAME)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_INVALID');
  }
  const sourceArtifactRoot = dirname(descriptorPath);
  let descriptorIdentity;
  try {
    descriptorIdentity = await hashLegacyUpgradeArtifactFile(descriptorPath);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_INVALID');
  }
  const source = await verifyLegacyUpgradeArtifact({
    artifactRoot: sourceArtifactRoot,
    expectedDescriptorSha256: descriptorIdentity.sha256,
  }).catch(() => {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_INVALID');
  });

  const fixtureRoot = resolve(fixtureRootInput);
  let fixtureCreated = false;
  try {
    await mkdir(fixtureRoot, { recursive: false });
    fixtureCreated = true;
    await copyExclusive(
      source.descriptorPath,
      resolve(fixtureRoot, LEGACY_UPGRADE_DESCRIPTOR_FILENAME),
    );
    for (const roleName of ['source', 'target']) {
      const role = source[roleName];
      const roleRoot = resolve(fixtureRoot, roleName);
      await mkdir(roleRoot, { recursive: false });
      await copyExclusive(
        role.manifestPath,
        resolve(roleRoot, 'installer.manifest.json'),
      );
      await copyExclusive(
        role.installerPath,
        resolve(roleRoot, role.manifest.packageFilename),
      );
    }
    await copyExclusive(
      source.source.provenancePath,
      resolve(fixtureRoot, 'source', 'historical-fixture-provenance.json'),
    );
    const verified = await verifyLegacyUpgradeArtifact({
      artifactRoot: fixtureRoot,
      expectedBuildRevision: source.buildRevision,
      expectedDescriptorSha256: source.descriptorSha256,
    });
    return Object.freeze({ ...verified, sourceArtifactRoot });
  } catch (error) {
    if (fixtureCreated) {
      await rm(fixtureRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

export async function verifyLegacyUpgradeArtifactSourceFixture(fixture) {
  try {
    await verifyLegacyUpgradeArtifact({
      artifactRoot: fixture.sourceArtifactRoot,
      expectedBuildRevision: fixture.buildRevision,
      expectedDescriptorSha256: fixture.descriptorSha256,
    });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED');
  }
}
