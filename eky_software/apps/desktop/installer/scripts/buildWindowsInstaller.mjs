import { spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInstallerProductCode,
  INSTALLER_UPGRADE_CODE,
} from '../installerIdentity.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
import { generateInstallerPayload } from './generateInstallerPayload.mjs';

const installerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const projectPath = join(installerDirectory, 'Eky.Installer.wixproj');
const releaseConfigPath = join(installerDirectory, 'installer-release.json');
const desktopPackagePath = join(desktopDirectory, 'package.json');
const payloadRoot = join(desktopDirectory, 'out', 'Eky-win32-x64');
const generatedPayloadPath = join(installerDirectory, 'wix', 'GeneratedPayload.wxs');
const artifactsRoot = join(installerDirectory, 'artifacts');

await access(join(payloadRoot, 'Eky.exe'));
const release = await readInstallerReleaseConfig(
  releaseConfigPath,
  desktopPackagePath,
);
const generated = await generateInstallerPayload({
  outputPath: generatedPayloadPath,
  payloadRoot,
});
await rm(artifactsRoot, { force: true, recursive: true });
await mkdir(artifactsRoot, { recursive: true });

const dotnetExecutable = process.env.EKY_DOTNET_EXE ?? 'dotnet';
const argumentsList = [
  'build',
  projectPath,
  '--no-restore',
  '--configuration',
  'Release',
  `-p:EkyAppVersion=${release.appVersion}`,
  `-p:EkyMsiProductVersion=${release.msiProductVersion}`,
  `-p:EkyPayloadRoot=${payloadRoot}`,
  `-p:EkyProductCode=${createInstallerProductCode(release.msiProductVersion)}`,
  `-p:EkyUpgradeCode=${INSTALLER_UPGRADE_CODE}`,
  `-p:OutputPath=${artifactsRoot}${process.platform === 'win32' ? '\\' : '/'}`,
  '-p:DebugType=none',
  '--verbosity',
  'minimal',
];

await runProcess(dotnetExecutable, argumentsList);
console.log(
  JSON.stringify({
    artifact: join(artifactsRoot, `Eky-${release.appVersion}-x64.msi`),
    inventory: generated.inventory,
    payloadFileCount: generated.payloadFileCount,
  }),
);

function runProcess(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
      },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`INSTALLER_BUILD_FAILED:${code ?? signal}`));
    });
  });
}
