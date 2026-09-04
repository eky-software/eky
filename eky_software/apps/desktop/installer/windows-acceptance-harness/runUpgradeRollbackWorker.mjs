import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createUpgradeRollbackWorkerTerminalResult,
  readUpgradeRollbackWorkerRequest,
  upgradeRollbackResultPathForRequest,
  upgradeRollbackWorkerResultPathForRequest,
  validateUpgradeRollbackResult,
  writeJsonAtomicExclusive,
} from './upgradeRollbackContracts.mjs';
import { executeUpgradeRollbackLifecycle } from './upgradeRollbackLifecycle.mjs';
import { verifyUpgradeRollbackArtifact } from './upgradeRollbackArtifact.mjs';
import { createUpgradeRollbackWindowsRuntime } from './upgradeRollbackWindowsRuntime.mjs';

function safeCode(error, fallback) {
  return (
    typeof error?.message === 'string' &&
    /^[a-z][A-Za-z0-9]{0,63}$/.test(error.message)
  )
    ? error.message
    : fallback;
}

function failedResult(errorCode) {
  return Object.freeze({
    schemaVersion: 1,
    status: 'failed',
    resultCode: 'upgradeRollbackFailed',
    errorCode,
    cleanupResultCode: 'notRequired',
    sourceInstallExitCode: null,
    upgradeExitCode: null,
    downgradeExitCode: null,
    binaryRollbackExitCode: null,
    windowsInstallerRollbackExitCode: null,
    finalUninstallExitCode: null,
    sourceInstalledStateValidated: false,
    majorUpgradeValidated: false,
    downgradeRejected: false,
    binaryRollbackRestoredSource: false,
    windowsInstallerRollbackRestoredSource: false,
    finalStateValidated: false,
    artifactBytesValidated: false,
  });
}

export async function runUpgradeRollbackWorker(arguments_) {
  if (
    process.platform !== 'win32' ||
    arguments_.length !== 2 ||
    arguments_[0] !== '--request' ||
    typeof arguments_[1] !== 'string' ||
    arguments_[1].includes('\0')
  ) {
    return 64;
  }
  let requestPath;
  try {
    requestPath = resolve(arguments_[1]);
  } catch {
    return 64;
  }
  let request;
  try {
    request = await readUpgradeRollbackWorkerRequest(requestPath);
  } catch {
    return 64;
  }

  let result;
  try {
    const artifact = await verifyUpgradeRollbackArtifact({
      artifactRoot: request.fixtureRoot,
      expectedDescriptorSha256: request.artifactDescriptorSha256,
    });
    const runtime = await createUpgradeRollbackWindowsRuntime(
      request,
      artifact,
    );
    result = await executeUpgradeRollbackLifecycle({
      ...runtime,
      versions: Object.freeze({
        source: artifact.roles.source.msiProductVersion,
        target: artifact.roles.target.msiProductVersion,
      }),
      reportProgress(entry) {
        try {
          console.log(JSON.stringify(entry));
        } catch {
          // Evidence output cannot alter the worker result.
        }
      },
    });
  } catch (error) {
    result = failedResult(safeCode(error, 'unexpectedFailure'));
  }

  try {
    const boundResult = validateUpgradeRollbackResult(
      {
        ...result,
        runNonce: request.runNonce,
        scenario: request.scenario,
        artifactDescriptorSha256: request.artifactDescriptorSha256,
      },
      request,
    );
    await writeJsonAtomicExclusive(
      upgradeRollbackResultPathForRequest(requestPath),
      boundResult,
    );
    await writeJsonAtomicExclusive(
      upgradeRollbackWorkerResultPathForRequest(requestPath),
      createUpgradeRollbackWorkerTerminalResult(request, boundResult),
    );
    return 0;
  } catch {
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runUpgradeRollbackWorker(process.argv.slice(2));
}
