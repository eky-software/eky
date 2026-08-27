import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import { resolveElectronDevelopmentRuntime } from '../../scripts/electron-development-runtime.mjs';
import { buildW6b2PackagedSuccessInstallers } from './buildW6b2PackagedSuccessInstallers.mjs';
import {
  createW6b2PackagedSuccessRunFixture,
  removeW6b2PackagedSuccessRunFixture,
  verifyW6b2PackagedSuccessRunFixture,
} from './w6b2PackagedSuccessRunFixture.mjs';
import {
  runW6b2PackagedScenarioProcess,
  W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT_MILLISECONDS,
  W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS,
} from './w6b2PackagedScenarioProcess.mjs';
import {
  createW6b2PackagedSuccessCommandLifecycle,
  createW6b2PackagedSuccessRunPhase,
} from './w6b2PackagedSuccessCommandLifecycle.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..', '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const powershellScriptPath = join(
  scriptDirectory,
  'testW6b2PackagedSuccess.ps1',
);
const profileApplicationPath = join(
  desktopDirectory,
  'e2e-dist',
  'w6b2-profile',
);

const defaultDependencies = Object.freeze({
  buildInstallerPair: buildW6b2PackagedSuccessInstallers,
  createRunFixture: createW6b2PackagedSuccessRunFixture,
  removeRunFixture: removeW6b2PackagedSuccessRunFixture,
  resolveElectronRuntime: resolveElectronDevelopmentRuntime,
  runProcess,
  temporaryRoot: tmpdir,
  verifyInstallerPair: verifyW6b2PackagedSuccessInstallerPair,
  verifyProfileApplication: requireCanonicalDirectory,
  verifyRunFixture: verifyW6b2PackagedSuccessRunFixture,
});

export async function runW6b2PackagedSuccess(options = {}) {
  const dependencies = options.dependencies ?? defaultDependencies;
  const lifecycle = createW6b2PackagedSuccessCommandLifecycle(
    options.commandLifecycle,
  );
  try {
    const installerPair = await lifecycle.runPhase(
      'installerPairBuild',
      () => dependencies.buildInstallerPair(),
    );
    await lifecycle.runPhase('installerPairVerification', () =>
      dependencies.verifyInstallerPair(installerPair),
    );
    const profile = await lifecycle.runPhase(
      'profilePreparation',
      async () => {
        const electronRuntime = dependencies.resolveElectronRuntime();
        const profilePath =
          options.profileApplicationPath ?? profileApplicationPath;
        await dependencies.verifyProfileApplication(profilePath);
        const temporaryRoot = await realpath(
          resolve(dependencies.temporaryRoot()),
        );
        return Object.freeze({ electronRuntime, profilePath, temporaryRoot });
      },
    );

    for (let runNumber = 1; runNumber <= 2; runNumber += 1) {
      lifecycle.requireScenarioStartBudget(
        W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS,
      );
      const run = await lifecycle.runPhase(
        createW6b2PackagedSuccessRunPhase(runNumber, 'FixtureCreate'),
        () =>
          dependencies.createRunFixture({
            installerPair,
            temporaryRoot: profile.temporaryRoot,
          }),
      );
      try {
        const scenarioTimeoutMilliseconds =
          lifecycle.getScenarioTimeoutMilliseconds(
            W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS,
          );
        await lifecycle.runPhase(
          createW6b2PackagedSuccessRunPhase(runNumber, 'Scenario'),
          () =>
            dependencies.runProcess(
              'powershell.exe',
              createW6b2PackagedSuccessArguments({
                buildRevision: installerPair.buildRevision,
                electronPath: profile.electronRuntime.executablePath,
                profileApplicationPath: profile.profilePath,
                run,
                sourcePayloadRoot:
                  installerPair.source.packagedApplicationPath,
                targetPayloadRoot:
                  installerPair.target.packagedApplicationPath,
                temporaryRoot: profile.temporaryRoot,
              }),
              {
                proofToken: run.token,
                timeoutMilliseconds: scenarioTimeoutMilliseconds,
              },
            ),
        );
        lifecycle.observeProcessTreeAbsent(runNumber);
        await lifecycle.runPhase(
          createW6b2PackagedSuccessRunPhase(
            runNumber,
            'FixtureVerification',
          ),
          () =>
            dependencies.verifyRunFixture({
              ...run,
              temporaryRoot: profile.temporaryRoot,
            }),
        );
        await lifecycle.runPhase(
          createW6b2PackagedSuccessRunPhase(
            runNumber,
            'InstallerPairVerification',
          ),
          () => dependencies.verifyInstallerPair(installerPair),
        );
      } finally {
        await lifecycle.runCleanupPhase(
          createW6b2PackagedSuccessRunPhase(runNumber, 'FixtureRemove'),
          () =>
            dependencies.removeRunFixture({
              proofRoot: run.proofRoot,
              temporaryRoot: profile.temporaryRoot,
              token: run.token,
            }),
        );
      }
    }

    lifecycle.complete();
    return Object.freeze({
      runCount: 2,
      sourceVersion: installerPair.source.appVersion,
      status: 'completed',
      targetVersion: installerPair.target.appVersion,
    });
  } catch (error) {
    lifecycle.fail(error);
    throw error;
  }
}

export function createW6b2PackagedSuccessArguments(input) {
  requireRunInput(input);
  return Object.freeze([
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    powershellScriptPath,
    '-TemporaryRoot',
    input.temporaryRoot,
    '-ProofToken',
    input.run.token,
    '-SourceMsiPath',
    input.run.source.installerPath,
    '-TargetMsiPath',
    input.run.target.installerPath,
    '-SourcePayloadRoot',
    input.sourcePayloadRoot,
    '-TargetPayloadRoot',
    input.targetPayloadRoot,
    '-SourceProductCode',
    input.run.source.productCode,
    '-TargetProductCode',
    input.run.target.productCode,
    '-SourcePackageSha256',
    input.run.source.packageSha256,
    '-TargetPackageSha256',
    input.run.target.packageSha256,
    '-BuildRevision',
    input.buildRevision,
    '-ElectronPath',
    input.electronPath,
    '-ProfileApplicationPath',
    input.profileApplicationPath,
  ]);
}

export async function verifyW6b2PackagedSuccessInstallerPair(pair) {
  await Promise.all([
    verifyPackage(pair.source, pair.buildRevision, '0.2.7'),
    verifyPackage(pair.target, pair.buildRevision, '0.2.8'),
  ]);
}

async function verifyPackage(value, buildRevision, appVersion) {
  const manifest = await readInstallerManifest(value.manifestPath);
  if (
    value.appVersion !== appVersion ||
    value.buildRevision !== buildRevision ||
    manifest.appVersion !== appVersion ||
    manifest.buildRevision !== buildRevision ||
    manifest.packageSha256 !== value.packageSha256 ||
    manifest.packageSize !== value.packageSize
  ) {
    throw new Error('W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID');
  }
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    installerPath: value.installerPath,
    manifest,
  });
}

async function requireCanonicalDirectory(path) {
  const resolved = resolve(path);
  const metadata = await lstat(resolved);
  const canonical = await realpath(resolved);
  const child = relative(desktopDirectory, canonical);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    child === '' ||
    child.startsWith('..') ||
    !samePath(canonical, resolved)
  ) {
    throw new Error('W6B2_SUCCESS_PROFILE_APPLICATION_INVALID');
  }
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function requireRunInput(input) {
  if (
    typeof input.buildRevision !== 'string' ||
    !/^[0-9a-f]{7,40}$/u.test(input.buildRevision) ||
    typeof input.electronPath !== 'string' ||
    typeof input.profileApplicationPath !== 'string' ||
    typeof input.sourcePayloadRoot !== 'string' ||
    typeof input.targetPayloadRoot !== 'string' ||
    typeof input.temporaryRoot !== 'string' ||
    typeof input.run?.token !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(input.run.token)
  ) {
    throw new Error('W6B2_SUCCESS_ARGUMENTS_INVALID');
  }
}

function runProcess(command, arguments_, context) {
  const timeoutMilliseconds =
    context?.timeoutMilliseconds ??
    W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS;
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS
  ) {
    return Promise.reject(new Error('W6B2_SUCCESS_PROCESS_TIMEOUT_INVALID'));
  }
  return runW6b2PackagedScenarioProcess({
    arguments: arguments_,
    cleanupTimeoutMilliseconds:
      W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT_MILLISECONDS,
    command,
    cwd: repositoryRoot,
    environment: process.env,
    proofToken: context?.proofToken,
    timeoutMilliseconds,
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    console.log(JSON.stringify(await runW6b2PackagedSuccess()));
  } catch {
    process.exitCode = 1;
  }
}
