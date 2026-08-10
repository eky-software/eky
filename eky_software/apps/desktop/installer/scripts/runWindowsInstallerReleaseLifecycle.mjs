import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
import { createInstallerSidecarPath } from './releaseWindowsInstaller.mjs';
import { verifyWindowsInstallerRelease } from './verifyWindowsInstallerRelease.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const releaseConfigPath = join(installerDirectory, 'installer-release.json');
const desktopPackagePath = join(desktopDirectory, 'package.json');
const artifactsRoot = join(installerDirectory, 'artifacts');
const payloadRoot = join(desktopDirectory, 'out', 'Eky-win32-x64');
const lifecycleScriptPath = join(
  scriptDirectory,
  'testWindowsInstallerLifecycle.ps1',
);

export function createInstallerLifecycleArguments({
  installerPath,
  payloadPath,
  productCode,
}) {
  return Object.freeze([
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    lifecycleScriptPath,
    '-MsiPath',
    installerPath,
    '-PayloadRoot',
    payloadPath,
    '-ProductCode',
    productCode,
  ]);
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
  await verifyWindowsInstallerRelease({
    buildRevision,
    installerPath,
    manifestPath: createInstallerSidecarPath(installerPath),
    release,
  });
  await runProcess(
    'powershell.exe',
    createInstallerLifecycleArguments({
      installerPath,
      payloadPath: payloadRoot,
      productCode: createInstallerProductCode(release.msiProductVersion),
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
      rejectPromise(new Error('INSTALLER_LIFECYCLE_FAILED'));
    });
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error('INSTALLER_LIFECYCLE_FAILED'));
    });
  });
}
