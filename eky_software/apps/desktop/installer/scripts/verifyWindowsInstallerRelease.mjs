import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
import { createInstallerSidecarPath } from './releaseWindowsInstaller.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const releaseConfigPath = join(installerDirectory, 'installer-release.json');
const desktopPackagePath = join(desktopDirectory, 'package.json');
const artifactsRoot = join(installerDirectory, 'artifacts');

export async function verifyWindowsInstallerRelease({
  buildRevision,
  installerPath,
  manifestPath,
  release,
}) {
  const manifest = await readInstallerManifest(manifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: release,
    installerPath,
    manifest,
  });
  return Object.freeze({ installerPath, manifest, manifestPath, release });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const buildRevision = await readInstallerReleaseGitState({ repositoryRoot });
  const release = await readInstallerReleaseConfig(
    releaseConfigPath,
    desktopPackagePath,
  );
  const installerPath = join(
    artifactsRoot,
    `Eky-${release.appVersion}-x64.msi`,
  );
  const manifestPath = createInstallerSidecarPath(installerPath);
  const verified = await verifyWindowsInstallerRelease({
    buildRevision,
    installerPath,
    manifestPath,
    release,
  });
  console.log(
    JSON.stringify({
      buildRevision: verified.manifest.buildRevision,
      packageFilename: verified.manifest.packageFilename,
      packageSha256: verified.manifest.packageSha256,
      packageSize: verified.manifest.packageSize,
      verified: true,
    }),
  );
}
