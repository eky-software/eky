import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CLEAN_INSTALL_UNINSTALL_SCENARIO,
  cleanResultPathForRequest,
  createCleanInstallUninstallWorkerRequest,
  readCleanInstallUninstallResult,
  writeJsonAtomicExclusive,
} from './cleanInstallUninstallContracts.mjs';
import {
  createClosedDirectoryInventory,
  inventoriesMatch,
} from './closedDirectoryInventory.mjs';
import {
  readWindowsAcceptanceSupervisorResult,
} from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import {
  materializeLocalImmutableFixture,
  verifyLocalImmutableSourceFixture,
} from './localImmutableInstallerFixture.mjs';

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
const WORKER_PATH = resolve(DIRECTORY, 'runCleanInstallUninstallWorker.mjs');
const DOTNET_EXECUTABLE = process.env.EKY_DOTNET_EXE || 'dotnet';
const SUPERVISOR_TIMEOUT_MILLISECONDS = 300_000;
const SUPERVISOR_CLEANUP_RESERVE_MILLISECONDS = 30_000;

async function requireStandaloneRegularFile(path, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1n ||
      metadata.nlink !== 1n
    ) {
      throw new Error(errorCode);
    }
    return metadata;
  } catch {
    throw new Error(errorCode);
  }
}

export function parseCleanInstallUninstallArguments(arguments_) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== '--fixture-manifest' ||
    typeof arguments_[1] !== 'string' ||
    arguments_[1].includes('\0')
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID');
  }
  return Object.freeze({ manifestPath: resolve(arguments_[1]) });
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
  return { child, completion };
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^[A-Z][A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_CLEAN_UNEXPECTED_FAILURE';
}

function scenarioErrorCode(result) {
  const codes = Object.freeze({
    cleanInstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_INSTALL_FAILED',
    cleanInstalledStateInvalid:
      'WINDOWS_ACCEPTANCE_CLEAN_INSTALLED_STATE_INVALID',
    cleanLifecyclePreconditionFailed:
      'WINDOWS_ACCEPTANCE_CLEAN_PRECONDITION_FAILED',
    cleanUninstallFailed: 'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALL_FAILED',
    cleanUninstalledStateInvalid:
      'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALLED_STATE_INVALID',
    fixtureVerificationFailed:
      'WINDOWS_ACCEPTANCE_CLEAN_FIXTURE_VERIFICATION_FAILED',
    installerStateInspectionFailed:
      'WINDOWS_ACCEPTANCE_CLEAN_STATE_INSPECTION_FAILED',
    unexpectedFailure: 'WINDOWS_ACCEPTANCE_CLEAN_UNEXPECTED_FAILURE',
  });
  return codes[result.errorCode] ?? 'WINDOWS_ACCEPTANCE_CLEAN_SCENARIO_FAILED';
}

export async function runCleanInstallUninstall(arguments_) {
  if (process.platform !== 'win32') {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_WINDOWS_REQUIRED');
  }
  const { manifestPath } = parseCleanInstallUninstallArguments(arguments_);
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_ENVIRONMENT_INVALID');
  }

  await requireStandaloneRegularFile(
    SUPERVISOR_DLL,
    'WINDOWS_ACCEPTANCE_SUPERVISOR_BINARY_INVALID',
  );
  const runRoot = await mkdtemp(join(tmpdir(), 'eky-windows-acceptance-v2-'));
  const profileRoot = resolve(appData, 'Eky');
  let activeSupervisor = null;
  let fixture = null;
  let primaryError = null;
  let profileAfter = null;
  let profileBefore = null;
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
    fixture = await materializeLocalImmutableFixture(manifestPath, runRoot);
    const scenarioRoot = resolve(runRoot, 'scenario');
    await mkdir(scenarioRoot, { recursive: false });
    const workerRequestPath = resolve(scenarioRoot, 'worker-request.json');
    const supervisorRequestPath = resolve(scenarioRoot, 'request.json');
    const workerRequest = createCleanInstallUninstallWorkerRequest({
      artifactDescriptorSha256: fixture.artifactDescriptorSha256,
      fixtureRoot: fixture.fixtureRoot,
    });
    await writeJsonAtomicExclusive(workerRequestPath, workerRequest);
    await writeJsonAtomicExclusive(supervisorRequestPath, {
      schemaVersion: 1,
      runNonce: workerRequest.runNonce,
      scenario: CLEAN_INSTALL_UNINSTALL_SCENARIO,
      artifactDescriptorSha256: fixture.artifactDescriptorSha256,
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
        artifactDescriptorSha256: fixture.artifactDescriptorSha256,
        runNonce: workerRequest.runNonce,
        scenario: CLEAN_INSTALL_UNINSTALL_SCENARIO,
        supervisorExitCode,
      },
    );
    const scenarioResult = await readCleanInstallUninstallResult(
      cleanResultPathForRequest(workerRequestPath),
      workerRequest,
    );
    if (
      supervisorResult.status !== 'completed' ||
      scenarioResult.status !== 'completed'
    ) {
      throw new Error(scenarioErrorCode(scenarioResult));
    }
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
    if (fixture !== null) {
      try {
        await verifyLocalImmutableSourceFixture(fixture);
      } catch {
        safetyError ??= new Error('WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED');
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
          throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_CLEANUP_FAILED');
        },
        (error) => {
          if (error?.code !== 'ENOENT') {
            throw error;
          }
        },
      );
    } catch {
      primaryError ??= new Error('WINDOWS_ACCEPTANCE_FIXTURE_CLEANUP_FAILED');
    }
  }

  if (safetyError) {
    throw new Error(safeErrorCode(safetyError));
  }
  if (primaryError) {
    throw new Error(safeErrorCode(primaryError));
  }
  return Object.freeze({
    schemaVersion: 1,
    scenario: CLEAN_INSTALL_UNINSTALL_SCENARIO,
    status: 'completed',
    resultCode: 'cleanInstallUninstallCompleted',
    appVersion: fixture.manifest.appVersion,
    packageSha256: fixture.packageSha256,
    businessDataPreserved: true,
    profileFileCountBefore: profileBefore.filter(
      (entry) => entry.kind === 'file',
    ).length,
    profileFileCountAfter: profileAfter.filter(
      (entry) => entry.kind === 'file',
    ).length,
    processTreeAbsent: supervisorResult.processTreeAbsent,
    fixtureRemoved: true,
  });
}

async function main() {
  try {
    const summary = await runCleanInstallUninstall(process.argv.slice(2));
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(
      JSON.stringify({
        schemaVersion: 1,
        scenario: CLEAN_INSTALL_UNINSTALL_SCENARIO,
        status: 'failed',
        errorCode: safeErrorCode(error),
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
