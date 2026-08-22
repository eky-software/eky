import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageW6bSyntheticNextPatchApplication } from '../../scripts/package-windows.mjs';
import { buildWindowsInstaller } from './buildWindowsInstaller.mjs';
import {
  W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS,
  createW6bSyntheticNextPatchRelease,
} from './w6bSyntheticWindowsPackageFixture.mjs';

const desktopDirectory = resolve(
  W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.fixtureRoot,
  '../../..',
);
const currentDesktopPackagePath = join(desktopDirectory, 'package.json');
const currentReleaseConfigPath = join(
  desktopDirectory,
  'installer',
  'installer-release.json',
);
const targetDesktopPackagePath = join(
  W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.inputRoot,
  'package.json',
);
const targetReleaseConfigPath = join(
  W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.inputRoot,
  'installer-release.json',
);

export async function buildW6bSyntheticNextPatchInstaller() {
  const currentPackage = JSON.parse(
    await readFile(currentDesktopPackagePath, 'utf8'),
  );
  const currentRelease = JSON.parse(
    await readFile(currentReleaseConfigPath, 'utf8'),
  );
  const targetRelease = createW6bSyntheticNextPatchRelease(currentRelease);
  if (currentPackage.version !== currentRelease.appVersion) {
    throw new Error('W6B_SYNTHETIC_PACKAGE_SOURCE_VERSION_MISMATCH');
  }

  await rm(W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.fixtureRoot, {
    force: true,
    recursive: true,
  });
  const packaged = await packageW6bSyntheticNextPatchApplication();
  assertW6bSyntheticPackagedIdentity({ packaged, targetRelease });

  await mkdir(W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.inputRoot, {
    recursive: true,
  });
  await writeFile(
    targetDesktopPackagePath,
    `${JSON.stringify({ version: targetRelease.appVersion }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    targetReleaseConfigPath,
    `${JSON.stringify(targetRelease, null, 2)}\n`,
    'utf8',
  );

  const installer = await buildWindowsInstaller({
    artifactsRoot: W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.artifactsRoot,
    desktopPackagePath: targetDesktopPackagePath,
    payloadRoot: packaged.packagedPath,
    releaseConfigPath: targetReleaseConfigPath,
  });
  if (
    installer.release.appVersion !== targetRelease.appVersion ||
    installer.release.msiProductVersion !== targetRelease.msiProductVersion ||
    installer.inventory.stage !== 'packagedApp'
  ) {
    throw new Error('W6B_SYNTHETIC_INSTALLER_IDENTITY_MISMATCH');
  }

  return Object.freeze({
    appVersion: targetRelease.appVersion,
    buildRevision: packaged.buildInfo.buildRevision,
    installerPath: installer.artifact,
    msiProductVersion: targetRelease.msiProductVersion,
    packageSha256: await hashFile(installer.artifact),
    packagedApplicationPath: packaged.packagedPath,
    productCode: installer.productCode,
  });
}

export function assertW6bSyntheticPackagedIdentity({
  packaged,
  targetRelease,
}) {
  if (
    typeof packaged !== 'object' ||
    packaged === null ||
    packaged.appVersion !== targetRelease.appVersion ||
    packaged.installerRelease?.appVersion !== targetRelease.appVersion ||
    packaged.installerRelease?.msiProductVersion !==
      targetRelease.msiProductVersion ||
    packaged.buildInfo?.appVersion !== targetRelease.appVersion ||
    packaged.buildInfo?.buildDirty !== false ||
    typeof packaged.buildInfo?.buildRevision !== 'string' ||
    !/^[0-9a-f]{7,40}$/u.test(packaged.buildInfo.buildRevision)
  ) {
    throw new Error('W6B_SYNTHETIC_PACKAGED_IDENTITY_INVALID');
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await buildW6bSyntheticNextPatchInstaller();
  console.log(
    JSON.stringify({
      appVersion: result.appVersion,
      buildRevision: result.buildRevision,
      msiProductVersion: result.msiProductVersion,
      packageSha256: result.packageSha256,
      productCode: result.productCode,
      status: 'completed',
    }),
  );
}
