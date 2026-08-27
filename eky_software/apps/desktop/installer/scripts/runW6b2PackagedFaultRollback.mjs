import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveElectronDevelopmentRuntime } from '../../scripts/electron-development-runtime.mjs';
import { buildW6b2PackagedSuccessInstallers } from './buildW6b2PackagedSuccessInstallers.mjs';
import {
  createW6b2PackagedFaultRunFixture,
  removeW6b2PackagedFaultRunFixture,
  requireW6b2PackagedFaultScenario,
  verifyW6b2PackagedFaultRunFixture,
  w6b2PackagedFaultScenarios,
} from './w6b2PackagedFaultRunFixture.mjs';
import {
  runW6b2PackagedScenarioProcess,
  W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT_MILLISECONDS,
  W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS,
} from './w6b2PackagedScenarioProcess.mjs';
import { verifyW6b2PackagedSuccessInstallerPair } from './runW6b2PackagedSuccess.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..', '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const powershellScriptPath = join(
  scriptDirectory,
  'testW6b2PackagedFaultRollback.ps1',
);
const profileApplicationPath = join(
  desktopDirectory,
  'e2e-dist',
  'w6b2-profile',
);

const defaultDependencies = Object.freeze({
  buildInstallerPair: buildW6b2PackagedSuccessInstallers,
  createRunFixture: createW6b2PackagedFaultRunFixture,
  removeRunFixture: removeW6b2PackagedFaultRunFixture,
  resolveElectronRuntime: resolveElectronDevelopmentRuntime,
  resolveTemporaryRoot: () => realpath(resolve(tmpdir())),
  runProcess,
  verifyInstallerPair: verifyW6b2PackagedSuccessInstallerPair,
  verifyProfileApplication: requireCanonicalDirectory,
  verifyRunFixture: verifyW6b2PackagedFaultRunFixture,
});

export async function runW6b2PackagedFaultRollback(options = {}) {
  const dependencies = options.dependencies ?? defaultDependencies;
  const scenarios = requireScenarios(
    options.scenarios ?? w6b2PackagedFaultScenarios,
  );
  const runCount = requireRunCount(options.runCount ?? 2);
  const installerPair = await dependencies.buildInstallerPair();
  await dependencies.verifyInstallerPair(installerPair);
  const electronRuntime = dependencies.resolveElectronRuntime();
  const profilePath = options.profileApplicationPath ?? profileApplicationPath;
  await dependencies.verifyProfileApplication(profilePath);
  const temporaryRoot = await dependencies.resolveTemporaryRoot();

  for (const faultScenario of scenarios) {
    for (let runNumber = 1; runNumber <= runCount; runNumber += 1) {
      const run = await dependencies.createRunFixture({
        faultScenario,
        installerPair,
        temporaryRoot,
      });
      try {
        await dependencies.runProcess(
          'powershell.exe',
          createW6b2PackagedFaultArguments({
            buildRevision: installerPair.buildRevision,
            electronPath: electronRuntime.executablePath,
            faultScenario,
            profileApplicationPath: profilePath,
            run,
            sourcePayloadRoot: installerPair.source.packagedApplicationPath,
            targetPayloadRoot: installerPair.target.packagedApplicationPath,
            temporaryRoot,
          }),
          { proofToken: run.token },
        );
        await dependencies.verifyRunFixture({ ...run, temporaryRoot });
        await dependencies.verifyInstallerPair(installerPair);
      } finally {
        await dependencies.removeRunFixture({
          proofRoot: run.proofRoot,
          temporaryRoot,
          token: run.token,
        });
      }
    }
  }

  return Object.freeze({
    runCount: runCount * scenarios.length,
    scenarioCount: scenarios.length,
    sourceVersion: installerPair.source.appVersion,
    status: 'completed',
    targetVersion: installerPair.target.appVersion,
  });
}

export function createW6b2PackagedFaultArguments(input) {
  requireArgumentInput(input);
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
    '-FaultScenario',
    input.faultScenario,
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

export function parseW6b2PackagedFaultCliArguments(arguments_) {
  if (arguments_.length === 0) return Object.freeze({});
  if (
    arguments_.length === 1 &&
    arguments_[0]?.startsWith('--scenario=')
  ) {
    const scenario = arguments_[0].slice('--scenario='.length);
    requireW6b2PackagedFaultScenario(scenario);
    return Object.freeze({ runCount: 2, scenarios: Object.freeze([scenario]) });
  }
  throw new Error('W6B2_FAULT_CLI_ARGUMENTS_INVALID');
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
    throw new Error('W6B2_FAULT_PROFILE_APPLICATION_INVALID');
  }
}

function requireScenarios(values) {
  if (!Array.isArray(values) || values.length < 1) {
    throw new Error('W6B2_FAULT_SCENARIO_INVALID');
  }
  const unique = new Set();
  for (const value of values) {
    requireW6b2PackagedFaultScenario(value);
    if (unique.has(value)) throw new Error('W6B2_FAULT_SCENARIO_INVALID');
    unique.add(value);
  }
  return Object.freeze([...values]);
}

function requireRunCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2) {
    throw new Error('W6B2_FAULT_RUN_COUNT_INVALID');
  }
  return value;
}

function requireArgumentInput(input) {
  requireW6b2PackagedFaultScenario(input.faultScenario);
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
    throw new Error('W6B2_FAULT_ARGUMENTS_INVALID');
  }
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function runProcess(command, arguments_, context) {
  return runW6b2PackagedScenarioProcess({
    arguments: arguments_,
    cleanupTimeoutMilliseconds:
      W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT_MILLISECONDS,
    command,
    cwd: repositoryRoot,
    environment: process.env,
    proofToken: context?.proofToken,
    timeoutMilliseconds: W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS,
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const options = parseW6b2PackagedFaultCliArguments(process.argv.slice(2));
  console.log(JSON.stringify(await runW6b2PackagedFaultRollback(options)));
}
