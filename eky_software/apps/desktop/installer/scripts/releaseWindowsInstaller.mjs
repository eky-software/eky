import { spawn } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { INSTALLER_UPGRADE_CODE } from '../installerIdentity.mjs';
import {
  createInstallerManifest,
  readInstallerManifest,
  verifyInstallerManifestPackage,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { buildWindowsInstaller } from './buildWindowsInstaller.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..', '..', '..');
const inspectorPath = join(scriptDirectory, 'inspectWindowsInstaller.ps1');

export function createInstallerSidecarPath(installerPath) {
  if (extname(installerPath).toLowerCase() !== '.msi') {
    throw new Error('INSTALLER_RELEASE_ARTIFACT_INVALID');
  }
  return `${installerPath.slice(0, -4)}.manifest.json`;
}

export async function createWindowsInstallerRelease({
  buildInstaller = buildWindowsInstaller,
  buildRevision,
  inspectInstaller = inspectWindowsInstaller,
  manifestPath,
} = {}) {
  const built = await buildInstaller();
  const resolvedManifestPath =
    manifestPath ?? createInstallerSidecarPath(built.artifact);
  const manifest = await createInstallerManifest({
    buildRevision,
    installerPath: built.artifact,
    release: built.release,
  });

  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: built.release,
    installerPath: built.artifact,
    manifest,
  });
  await inspectInstaller(built);
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: built.release,
    installerPath: built.artifact,
    manifest,
  });

  await writeInstallerManifest(resolvedManifestPath, manifest);
  const persistedManifest = await readInstallerManifest(resolvedManifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: built.release,
    installerPath: built.artifact,
    manifest: persistedManifest,
  });

  return Object.freeze({
    installerPath: built.artifact,
    manifest: persistedManifest,
    manifestPath: resolvedManifestPath,
    payloadFileCount: built.payloadFileCount,
    productCode: built.productCode,
    release: built.release,
  });
}

export async function inspectWindowsInstaller(built) {
  await runProcess('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    inspectorPath,
    '-MsiPath',
    built.artifact,
    '-ExpectedProductVersion',
    built.release.msiProductVersion,
    '-ExpectedProductCode',
    built.productCode,
    '-ExpectedUpgradeCode',
    INSTALLER_UPGRADE_CODE,
    '-ExpectedPayloadFileCount',
    String(built.payloadFileCount),
  ]);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const buildRevision = await readInstallerReleaseGitState({ repositoryRoot });
  const release = await createWindowsInstallerRelease({ buildRevision });
  console.log(
    JSON.stringify({
      buildRevision: release.manifest.buildRevision,
      manifestFilename: release.manifestPath.split(/[\\/]/).at(-1),
      msiProductVersion: release.release.msiProductVersion,
      packageFilename: release.manifest.packageFilename,
      packageSha256: release.manifest.packageSha256,
      packageSize: release.manifest.packageSize,
    }),
  );
}

function runProcess(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => {
      rejectPromise(new Error('INSTALLER_INSPECTION_FAILED'));
    });
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error('INSTALLER_INSPECTION_FAILED'));
    });
  });
}
