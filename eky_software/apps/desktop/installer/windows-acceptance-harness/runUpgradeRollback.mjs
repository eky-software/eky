import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  UPGRADE_ROLLBACK_SCENARIO,
  createUpgradeRollbackWorkerRequest,
  readUpgradeRollbackResult,
  upgradeRollbackResultPathForRequest,
  writeJsonAtomicExclusive,
} from './upgradeRollbackContracts.mjs';
import {
  UpgradeRollbackCommandFailure,
  upgradeRollbackFailureDetails,
  resolveUpgradeRollbackTerminalOutcome,
} from './upgradeRollbackFailureBoundary.mjs';
import {
  materializeUpgradeRollbackArtifactFixture,
  verifyUpgradeRollbackArtifactSourceFixture,
} from './upgradeRollbackArtifactFixture.mjs';
import { UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME } from './upgradeRollbackArtifact.mjs';
import { createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';
import { areProductProcessesAbsent } from './installerProductOperationRuntime.mjs';
import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_DLL = resolve(
  DIRECTORY,
  '..',
  'bin',
  'windows-process-supervisor',
  'Release',
  'net10.0',
  'Eky.WindowsProcessSupervisor.dll',
);
const WORKER_PATH = resolve(DIRECTORY, 'runUpgradeRollbackWorker.mjs');
const DOTNET_EXECUTABLE = process.env.EKY_DOTNET_EXE || 'dotnet';
const SUPERVISOR_TIMEOUT_MILLISECONDS = 600_000;
const SUPERVISOR_CLEANUP_RESERVE_MILLISECONDS = 30_000;

async function requireStandaloneRegularFile(path, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 1n
    ) {
      throw new Error(errorCode);
    }
  } catch {
    throw new Error(errorCode);
  }
}

export function parseUpgradeRollbackArguments(arguments_) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== '--artifact-descriptor'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID');
  }
  const descriptorPath = parseAbsoluteWindowsAcceptancePath(
    arguments_[1],
    'WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID',
  );
  if (
    descriptorPath !==
    resolve(dirname(descriptorPath), UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID');
  }
  return Object.freeze({ descriptorPath });
}

function startSupervisor(requestPath, scenarioRoot) {
  const child = spawn(
    DOTNET_EXECUTABLE,
    [SUPERVISOR_DLL, '--request', requestPath],
    {
      cwd: scenarioRoot,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', () =>
      rejectPromise(new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_START_FAILED')),
    );
    child.once('close', (exitCode, signal) => {
      if (signal !== null || !Number.isInteger(exitCode)) {
        rejectPromise(new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_EXIT_INVALID'));
        return;
      }
      resolvePromise(exitCode);
    });
  });
  return Object.freeze({ child, completion });
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^[A-Z][A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_UPGRADE_UNEXPECTED_FAILURE';
}

export function requireUpgradeRollbackProductPrecondition(result) {
  if (
    result?.status !== 'completed' ||
    result.resultCode !== 'exactProductsAbsent' ||
    result.sourcePresent !== false ||
    result.targetPresent !== false ||
    result.installerRegistryPresent !== false
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED');
  }
}

export async function resolveUpgradeRollbackTemporaryRoot(
  temporaryRoot = tmpdir(),
) {
  try {
    const canonicalRoot = await realpath(resolve(temporaryRoot));
    const metadata = await lstat(canonicalRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_TEMP_ROOT_INVALID');
    }
    return canonicalRoot;
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_TEMP_ROOT_INVALID');
  }
}

export async function runUpgradeRollback(arguments_, {
  inventoryProfile = createClosedDirectoryInventory,
  materializeFixture = materializeUpgradeRollbackArtifactFixture,
  verifyArtifact = verifyUpgradeRollbackArtifactSourceFixture,
  createProductRuntime = createUpgradeRollbackPostSupervisorWindowsRuntime,
  launchSupervisor = startSupervisor,
  readSupervisorResult = readWindowsAcceptanceSupervisorResult,
  readScenarioResult = readUpgradeRollbackResult,
  removeRunRoot = (path) => rm(path, { force: true, recursive: true }),
} = {}) {
  if (process.platform !== 'win32') {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_WINDOWS_REQUIRED');
  }
  const { descriptorPath } = parseUpgradeRollbackArguments(arguments_);
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ENVIRONMENT_INVALID');
  }
  await requireStandaloneRegularFile(
    SUPERVISOR_DLL,
    'WINDOWS_ACCEPTANCE_SUPERVISOR_BINARY_INVALID',
  );

  const temporaryRoot = await resolveUpgradeRollbackTemporaryRoot();
  const runRoot = await mkdtemp(
    join(temporaryRoot, 'eky-windows-acceptance-v2-upgrade-'),
  );
  const profileRoot = resolve(appData, 'Eky');
  let activeSupervisor = null;
  let artifact = null;
  let productRuntime = null;
  let supervisorAttempted = false;
  let terminal = null;
  let fixtureRemoved = false;
  let fixtureCleanupResultCode = 'retainedUnverified';
  let primaryError = null;
  let profileBefore = null;
  let profileAfter = null;
  let safetyError = null;
  let supervisorResult = null;
  const stopActiveSupervisor = () => {
    if (
      activeSupervisor?.child.exitCode === null &&
      activeSupervisor.child.signalCode === null
    ) {
      activeSupervisor.child.kill();
    }
  };
  process.once('SIGINT', stopActiveSupervisor);
  process.once('SIGTERM', stopActiveSupervisor);
  try {
    profileBefore = await inventoryProfile(profileRoot);
    artifact = await materializeFixture(
      descriptorPath,
      resolve(runRoot, 'fixture'),
    );
    const scenarioRoot = resolve(runRoot, 'scenario');
    await mkdir(scenarioRoot, { recursive: false });
    productRuntime = createProductRuntime({
      artifact,
      scenarioRoot,
    });
    requireUpgradeRollbackProductPrecondition(
      await productRuntime.verifyExactProductStates(),
    );
    if (!areProductProcessesAbsent(productRuntime)) throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_PRODUCT_PROCESS_UNVERIFIED');
    const workerRequestPath = resolve(scenarioRoot, 'worker-request.json');
    const supervisorRequestPath = resolve(scenarioRoot, 'request.json');
    const workerRequest = createUpgradeRollbackWorkerRequest({
      artifactDescriptorSha256: artifact.descriptorSha256,
      fixtureRoot: artifact.artifactRoot,
    });
    await writeJsonAtomicExclusive(workerRequestPath, workerRequest);
    await writeJsonAtomicExclusive(supervisorRequestPath, {
      schemaVersion: 1,
      runNonce: workerRequest.runNonce,
      scenario: UPGRADE_ROLLBACK_SCENARIO,
      artifactDescriptorSha256: artifact.descriptorSha256,
      command: process.execPath,
      arguments: [WORKER_PATH, '--request', workerRequestPath],
      workingDirectory: scenarioRoot,
      timeoutMilliseconds: SUPERVISOR_TIMEOUT_MILLISECONDS,
      cleanupReserveMilliseconds: SUPERVISOR_CLEANUP_RESERVE_MILLISECONDS,
    });

    supervisorAttempted = true;
    activeSupervisor = launchSupervisor(supervisorRequestPath, scenarioRoot);
    const supervisorExitCode = await activeSupervisor.completion;
    activeSupervisor = null;
    supervisorResult = await readSupervisorResult(
      resolve(scenarioRoot, 'result.json'),
      {
        artifactDescriptorSha256: artifact.descriptorSha256,
        runNonce: workerRequest.runNonce,
        scenario: UPGRADE_ROLLBACK_SCENARIO,
        supervisorExitCode,
      },
    );
    terminal = await resolveUpgradeRollbackTerminalOutcome({
      ...productRuntime,
      supervisorResult,
      readScenarioResult: () =>
        readScenarioResult(
          upgradeRollbackResultPathForRequest(workerRequestPath),
          workerRequest,
        ),
    });
  } catch (error) {
    primaryError = error;
  } finally {
    process.off('SIGINT', stopActiveSupervisor);
    process.off('SIGTERM', stopActiveSupervisor);
    if (
      activeSupervisor?.child.exitCode === null &&
      activeSupervisor.child.signalCode === null
    ) {
      activeSupervisor.child.kill();
      await activeSupervisor.completion.catch(() => undefined);
    }
    if (!areProductProcessesAbsent(productRuntime)) safetyError ??= new Error('WINDOWS_ACCEPTANCE_UPGRADE_PRODUCT_PROCESS_UNVERIFIED');
    if (artifact !== null && areProductProcessesAbsent(productRuntime)) {
      try {
        await verifyArtifact(artifact);
      } catch {
        safetyError ??= new Error(
          'WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED',
        );
      }
    }
    if (profileBefore !== null && areProductProcessesAbsent(productRuntime)) {
      try {
        profileAfter = await inventoryProfile(profileRoot);
        if (!inventoriesMatch(profileBefore, profileAfter)) {
          throw new Error('WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
        }
      } catch {
        safetyError ??= new Error('WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
      }
    }
    const failure = upgradeRollbackFailureDetails(primaryError);
    const cleanupVerified = terminal !== null || (
      failure?.applicationCleanupResultCode !== 'cleanupUnverified' &&
      ['notRequired', 'semanticCleanupCompleted'].includes(failure?.semanticCleanupResultCode) &&
      ['exactProductsAbsent', 'exactProductsAbsentAfterCleanup'].includes(failure?.postconditionResultCode)
    );
    if (safetyError === null && (!supervisorAttempted || (supervisorResult?.processTreeAbsent === true && cleanupVerified))) {
      try {
        await removeRunRoot(runRoot);
        await lstat(runRoot).then(
          () => {
            throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_FIXTURE_CLEANUP_FAILED');
          },
          (error) => {
            if (error?.code !== 'ENOENT') {
              throw error;
            }
          },
        );
        fixtureRemoved = true;
        fixtureCleanupResultCode = 'fixtureRemoved';
      } catch {
        fixtureCleanupResultCode = 'fixtureCleanupFailed';
        primaryError ??= new Error(
          'WINDOWS_ACCEPTANCE_UPGRADE_FIXTURE_CLEANUP_FAILED',
        );
      }
    }
  }

  if (primaryError || safetyError) {
    throw new UpgradeRollbackCommandFailure({ schemaVersion: 1, scenario: UPGRADE_ROLLBACK_SCENARIO,
      status: 'failed', errorCode: safeErrorCode(primaryError ?? safetyError),
      ...upgradeRollbackFailureDetails(primaryError),
      processTreeAbsent: supervisorResult?.processTreeAbsent === true,
      productProcessAbsent: areProductProcessesAbsent(productRuntime),
      safetyErrorCode: safetyError === null ? null : safeErrorCode(safetyError),
      fixtureRemoved, fixtureCleanupResultCode });
  }
  return Object.freeze({
    schemaVersion: 1,
    scenario: UPGRADE_ROLLBACK_SCENARIO,
    status: 'completed',
    resultCode: 'upgradeRollbackCompleted',
    runningUpgradeInitialExitCode: terminal.runningUpgradeInitialExitCode,
    runningUpgradeObservation: terminal.runningUpgradeObservation,
    upgradeExitCode: terminal.upgradeExitCode,
    sourceVersion: artifact.roles.source.appVersion,
    targetVersion: artifact.roles.target.appVersion,
    sourcePackageSha256: artifact.roles.source.packageSha256,
    targetPackageSha256: artifact.roles.target.packageSha256,
    windowsRollbackPackageSha256:
      artifact.roles.windowsRollback.packageSha256,
    businessDataPreserved: true,
    profileFileCountBefore: profileBefore.filter((entry) => entry.kind === 'file')
      .length,
    profileFileCountAfter: profileAfter.filter((entry) => entry.kind === 'file')
      .length,
    processTreeAbsent: supervisorResult.processTreeAbsent,
    productProcessAbsent: areProductProcessesAbsent(productRuntime),
    fixtureRemoved, fixtureCleanupResultCode,
  });
}

async function main() {
  try {
    console.log(
      JSON.stringify(await runUpgradeRollback(process.argv.slice(2))),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        upgradeRollbackFailureDetails(error) ?? {
          schemaVersion: 1,
          scenario: UPGRADE_ROLLBACK_SCENARIO,
          status: 'failed',
          errorCode: safeErrorCode(error),
        },
      ),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
