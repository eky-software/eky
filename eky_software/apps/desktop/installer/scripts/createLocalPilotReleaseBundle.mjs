import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
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
const defaultBundleRoot = join(installerDirectory, 'local-pilot-releases');

export async function createLocalPilotReleaseBundle({
  buildRevision,
  installerPath,
  manifestPath,
  outputRoot,
  release,
}) {
  if (release.releaseChannel !== 'pilot') {
    throw new Error('INSTALLER_PILOT_BUNDLE_RELEASE_INVALID');
  }
  const manifest = await readInstallerManifest(manifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: release,
    installerPath,
    manifest,
  });

  await ensureOutputRoot(outputRoot);
  const bundleDirectory = join(
    outputRoot,
    `Eky-${release.appVersion}-x64-local-unsigned-pilot`,
  );
  let bundleCreated = false;
  try {
    await mkdir(bundleDirectory);
    bundleCreated = true;
    const copiedInstallerPath = join(bundleDirectory, manifest.packageFilename);
    const copiedManifestPath = join(bundleDirectory, basename(manifestPath));
    const checksumFilename = `Eky-${release.appVersion}-x64.sha256.txt`;
    const checksumPath = join(bundleDirectory, checksumFilename);

    await copyFile(installerPath, copiedInstallerPath, constants.COPYFILE_EXCL);
    await copyFile(manifestPath, copiedManifestPath, constants.COPYFILE_EXCL);
    await writeFile(
      checksumPath,
      `${manifest.packageSha256}  ${manifest.packageFilename}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );

    await verifyLocalPilotReleaseBundle({
      buildRevision,
      bundleDirectory,
      release,
    });
    return Object.freeze({
      bundleDirectory,
      checksumPath,
      installerPath: copiedInstallerPath,
      manifestPath: copiedManifestPath,
    });
  } catch (error) {
    if (bundleCreated) {
      await rm(bundleDirectory, { force: true, recursive: true });
    }
    throw error;
  }
}

export async function verifyLocalPilotReleaseBundle({
  buildRevision,
  bundleDirectory,
  release,
}) {
  await assertRegularDirectory(bundleDirectory);
  const installerFilename = `Eky-${release.appVersion}-x64.msi`;
  const manifestFilename = `Eky-${release.appVersion}-x64.manifest.json`;
  const checksumFilename = `Eky-${release.appVersion}-x64.sha256.txt`;
  const expectedFilenames = [
    checksumFilename,
    installerFilename,
    manifestFilename,
  ].sort();
  const entries = await readdir(bundleDirectory, { withFileTypes: true });
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    JSON.stringify(entries.map((entry) => entry.name).sort()) !==
      JSON.stringify(expectedFilenames)
  ) {
    throw new Error('INSTALLER_PILOT_BUNDLE_CONTENT_INVALID');
  }

  const installerPath = join(bundleDirectory, installerFilename);
  const manifestPath = join(bundleDirectory, manifestFilename);
  const manifest = await readInstallerManifest(manifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: release,
    installerPath,
    manifest,
  });
  const checksum = await readFile(join(bundleDirectory, checksumFilename), 'utf8');
  if (checksum !== `${manifest.packageSha256}  ${installerFilename}\n`) {
    throw new Error('INSTALLER_PILOT_BUNDLE_CHECKSUM_INVALID');
  }
  return Object.freeze({ installerPath, manifest, manifestPath });
}

async function ensureOutputRoot(outputRoot) {
  try {
    await mkdir(outputRoot, { recursive: true });
    await assertRegularDirectory(outputRoot);
  } catch {
    throw new Error('INSTALLER_PILOT_BUNDLE_OUTPUT_INVALID');
  }
}

async function assertRegularDirectory(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('INSTALLER_PILOT_BUNDLE_OUTPUT_INVALID');
  }
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
  const bundle = await createLocalPilotReleaseBundle({
    buildRevision,
    installerPath,
    manifestPath: createInstallerSidecarPath(installerPath),
    outputRoot: defaultBundleRoot,
    release,
  });
  console.log(
    JSON.stringify({
      appVersion: release.appVersion,
      buildRevision,
      bundleDirectory: basename(bundle.bundleDirectory),
      releaseChannel: release.releaseChannel,
    }),
  );
}
