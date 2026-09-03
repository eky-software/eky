import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readInstallerManifest } from '../installerManifest.mjs';
import {
  cleanResultPathForRequest,
  createWorkerTerminalResult,
  readCleanInstallUninstallWorkerRequest,
  validateCleanInstallUninstallResult,
  workerResultPathForRequest,
  writeJsonAtomicExclusive,
} from './cleanInstallUninstallContracts.mjs';
import {
  executeCleanInstallUninstallLifecycle,
} from './cleanInstallUninstallLifecycle.mjs';
import {
  createCleanInstallUninstallWindowsRuntime,
} from './cleanInstallUninstallWindowsRuntime.mjs';

function safeCode(error, fallback) {
  return (
    typeof error?.message === 'string' &&
    /^[a-z][A-Za-z0-9]{0,63}$/.test(error.message)
  )
    ? error.message
    : fallback;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function runCleanInstallUninstallWorker(arguments_) {
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
    request = await readCleanInstallUninstallWorkerRequest(requestPath);
  } catch {
    return 64;
  }

  const scenarioResultPath = cleanResultPathForRequest(requestPath);
  const workerResultPath = workerResultPathForRequest(requestPath);
  let result;
  try {
    const manifestPath = resolve(request.fixtureRoot, 'installer.manifest.json');
    if ((await hashFile(manifestPath)) !== request.artifactDescriptorSha256) {
      throw new Error('fixtureVerificationFailed');
    }
    const manifest = await readInstallerManifest(manifestPath);
    const runtime = await createCleanInstallUninstallWindowsRuntime(
      request,
      manifest,
    );
    result = await executeCleanInstallUninstallLifecycle({
      expectedVersion: manifest.msiProductVersion,
      reportProgress(entry) {
        try {
          console.log(JSON.stringify(entry));
        } catch {
          // Progress output is best-effort and cannot alter the result.
        }
      },
      ...runtime,
    });
  } catch (error) {
    result = Object.freeze({
      schemaVersion: 1,
      status: 'failed',
      resultCode: 'cleanInstallUninstallFailed',
      errorCode: safeCode(error, 'unexpectedFailure'),
      cleanupResultCode: 'notRequired',
      installExitCode: null,
      uninstallExitCode: null,
      installedStateValidated: false,
      uninstalledStateValidated: false,
    });
  }

  try {
    const boundResult = validateCleanInstallUninstallResult(
      {
        ...result,
        runNonce: request.runNonce,
        scenario: request.scenario,
        artifactDescriptorSha256: request.artifactDescriptorSha256,
      },
      request,
    );
    await writeJsonAtomicExclusive(scenarioResultPath, boundResult);
    await writeJsonAtomicExclusive(
      workerResultPath,
      createWorkerTerminalResult(request, boundResult),
    );
    return 0;
  } catch {
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCleanInstallUninstallWorker(process.argv.slice(2));
}
