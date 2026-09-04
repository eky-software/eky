import { constants } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
  UPGRADE_ROLLBACK_ROLE_NAMES,
  hashUpgradeRollbackArtifactFile,
  verifyUpgradeRollbackArtifact,
} from './upgradeRollbackArtifact.mjs';

export async function materializeUpgradeRollbackArtifactFixture(
  descriptorInputPath,
  fixtureRootInput,
) {
  const descriptorPath = resolve(descriptorInputPath);
  if (descriptorPath !== resolve(dirname(descriptorPath), UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME)) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_INVALID');
  }
  const sourceArtifactRoot = dirname(descriptorPath);
  let descriptorIdentity;
  try {
    descriptorIdentity = await hashUpgradeRollbackArtifactFile(descriptorPath);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_INVALID');
  }
  const source = await verifyUpgradeRollbackArtifact({
    artifactRoot: sourceArtifactRoot,
    expectedDescriptorSha256: descriptorIdentity.sha256,
  }).catch(() => {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_INVALID');
  });

  const fixtureRoot = resolve(fixtureRootInput);
  let fixtureCreated = false;
  try {
    await mkdir(fixtureRoot, { recursive: false });
    fixtureCreated = true;
    await copyFile(
      source.descriptorPath,
      resolve(fixtureRoot, UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME),
      constants.COPYFILE_EXCL,
    );
    for (const roleName of UPGRADE_ROLLBACK_ROLE_NAMES) {
      const role = source.roles[roleName];
      const roleRoot = resolve(fixtureRoot, roleName);
      await mkdir(roleRoot, { recursive: false });
      await copyFile(
        role.manifestPath,
        resolve(roleRoot, 'installer.manifest.json'),
        constants.COPYFILE_EXCL,
      );
      await copyFile(
        role.installerPath,
        resolve(roleRoot, role.manifest.packageFilename),
        constants.COPYFILE_EXCL,
      );
    }
    const verified = await verifyUpgradeRollbackArtifact({
      artifactRoot: fixtureRoot,
      expectedBuildRevision: source.buildRevision,
      expectedDescriptorSha256: source.descriptorSha256,
    });
    return Object.freeze({
      ...verified,
      sourceArtifactRoot,
    });
  } catch (error) {
    if (fixtureCreated) {
      await rm(fixtureRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

export async function verifyUpgradeRollbackArtifactSourceFixture(fixture) {
  try {
    await verifyUpgradeRollbackArtifact({
      artifactRoot: fixture.sourceArtifactRoot,
      expectedBuildRevision: fixture.buildRevision,
      expectedDescriptorSha256: fixture.descriptorSha256,
    });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED');
  }
}
