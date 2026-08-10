import { spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const defaultReleaseConfigPath = join(installerDirectory, 'installer-release.json');
const defaultDesktopPackagePath = join(desktopDirectory, 'package.json');
const defaultPayloadRoot = join(desktopDirectory, 'out', 'Eky-win32-x64');
const generatedPayloadPath = join(installerDirectory, 'wix', 'GeneratedPayload.wxs');
const defaultArtifactsRoot = join(installerDirectory, 'artifacts');

export async function buildWindowsInstaller({
  artifactsRoot = defaultArtifactsRoot,
  desktopPackagePath = defaultDesktopPackagePath,
  payloadRoot = defaultPayloadRoot,
  releaseConfigPath = defaultReleaseConfigPath,
} = {}) {
  const resolvedArtifactsRoot = resolve(artifactsRoot);
  const resolvedDesktopPackagePath = resolve(desktopPackagePath);
  const resolvedReleaseConfigPath = resolve(releaseConfigPath);
  const resolvedPayloadRoot = resolve(payloadRoot);
  await access(join(resolvedPayloadRoot, 'Eky.exe'));
  const release = await readInstallerReleaseConfig(
    resolvedReleaseConfigPath,
    resolvedDesktopPackagePath,
  );
  const generated = await generateInstallerPayload({
    outputPath: generatedPayloadPath,
    payloadRoot: resolvedPayloadRoot,
  });
  await rm(resolvedArtifactsRoot, { force: true, recursive: true });
  await mkdir(resolvedArtifactsRoot, { recursive: true });

  const dotnetExecutable = process.env.EKY_DOTNET_EXE ?? 'dotnet';
  const argumentsList = createInstallerBuildArguments({
    artifactsRoot: resolvedArtifactsRoot,
    payloadRoot: resolvedPayloadRoot,
    productCode: createInstallerProductCode(release.msiProductVersion),
    release,
  });

  await runProcess(dotnetExecutable, argumentsList);
  return Object.freeze({
    artifact: join(resolvedArtifactsRoot, `Eky-${release.appVersion}-x64.msi`),
    inventory: generated.inventory,
    payloadFileCount: generated.payloadFileCount,
    productCode: createInstallerProductCode(release.msiProductVersion),
    release,
  });
}

export function createInstallerBuildArguments({
  artifactsRoot,
  payloadRoot,
  productCode,
  release,
}) {
  const pathSuffix = process.platform === 'win32' ? '\\' : '/';
  return Object.freeze([
    'build',
    projectPath,
    '--no-restore',
    '--configuration',
    'Release',
    `-p:EkyAppVersion=${release.appVersion}`,
    `-p:EkyMsiProductVersion=${release.msiProductVersion}`,
    `-p:EkyPayloadRoot=${payloadRoot}`,
    `-p:EkyProductCode=${productCode}`,
    `-p:EkyUpgradeCode=${INSTALLER_UPGRADE_CODE}`,
    `-p:OutputPath=${artifactsRoot}${pathSuffix}`,
    `-p:IntermediateOutputPath=${join(artifactsRoot, '.intermediate')}${pathSuffix}`,
    '-p:DebugType=none',
    '--verbosity',
    'minimal',
  ]);
}

export function parseInstallerBuildArguments(args) {
  const options = {};
  const optionNames = new Map([
    ['--artifacts-root', 'artifactsRoot'],
    ['--desktop-package', 'desktopPackagePath'],
    ['--release-config', 'releaseConfigPath'],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const optionName = optionNames.get(args[index]);
    const optionValue = args[index + 1];
    if (
      optionName === undefined ||
      typeof optionValue !== 'string' ||
      optionValue === '' ||
      Object.hasOwn(options, optionName)
    ) {
      throw new Error('INSTALLER_BUILD_ARGUMENTS_INVALID');
    }
    options[optionName] = optionValue;
  }
  return Object.freeze(options);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  console.log(
    JSON.stringify(
      await buildWindowsInstaller(parseInstallerBuildArguments(process.argv.slice(2))),
    ),
  );
}

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
