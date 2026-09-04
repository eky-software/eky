import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  upgradeRollbackFailureDetails,
  resolveUpgradeRollbackTerminalOutcome,
} from './upgradeRollbackFailureBoundary.mjs';
import {
  materializeUpgradeRollbackArtifactFixture,
  verifyUpgradeRollbackArtifactSourceFixture,
} from './upgradeRollbackArtifactFixture.mjs';
import { UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME } from './upgradeRollbackArtifact.mjs';
import { createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';
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

export async function runUpgradeRollback(arguments_) {
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

  const runRoot = await mkdtemp(join(tmpdir(), 'eky-windows-acceptance-v2-upgrade-'));
  const profileRoot = resolve(appData, 'Eky');
  let activeSupervisor = null;
  let artifact = null;
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
    profileBefore = await createClosedDirectoryInventory(profileRoot);
    artifact = await materializeUpgradeRollbackArtifactFixture(
      descriptorPath,
      resolve(runRoot, 'fixture'),
    );
    const scenarioRoot = resolve(runRoot, 'scenario');
    await mkdir(scenarioRoot, { recursive: false });
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

    activeSupervisor = startSupervisor(supervisorRequestPath, scenarioRoot);
    const supervisorExitCode = await activeSupervisor.completion;
    activeSupervisor = null;
    supervisorResult = await readWindowsAcceptanceSupervisorResult(
      resolve(scenarioRoot, 'result.json'),
      {
        artifactDescriptorSha256: artifact.descriptorSha256,
        runNonce: workerRequest.runNonce,
        scenario: UPGRADE_ROLLBACK_SCENARIO,
        supervisorExitCode,
      },
    );
    await resolveUpgradeRollbackTerminalOutcome({
      ...createUpgradeRollbackPostSupervisorWindowsRuntime({
        artifact,
        scenarioRoot,
      }),
      supervisorResult,
      readScenarioResult: () =>
        readUpgradeRollbackResult(
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
    if (artifact !== null) {
      try {
        await verifyUpgradeRollbackArtifactSourceFixture(artifact);
      } catch {
        safetyError ??= new Error(
          'WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED',
        );
      }
    }
    if (profileBefore !== null) {
      try {
        profileAfter = await createClosedDirectoryInventory(profileRoot);
        if (!inventoriesMatch(profileBefore, profileAfter)) {
          throw new Error('WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
        }
      } catch {
        safetyError ??= new Error('WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
      }
    }
    try {
      await rm(runRoot, { force: true, recursive: true });
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
    } catch {
      primaryError ??= new Error(
        'WINDOWS_ACCEPTANCE_UPGRADE_FIXTURE_CLEANUP_FAILED',
      );
    }
  }

  if (safetyError) {
    throw new Error(safeErrorCode(safetyError));
  }
  if (primaryError) {
    if (upgradeRollbackFailureDetails(primaryError) !== null) {
      throw primaryError;
    }
    throw new Error(safeErrorCode(primaryError));
  }
  return Object.freeze({
    schemaVersion: 1,
    scenario: UPGRADE_ROLLBACK_SCENARIO,
    status: 'completed',
    resultCode: 'upgradeRollbackCompleted',
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
    fixtureRemoved: true,
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
