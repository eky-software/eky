import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createLegacyUpgradeWorkerTerminalResult,
  legacyUpgradeResultPathForRequest,
  legacyUpgradeWorkerResultPathForRequest,
  readLegacyUpgradeWorkerRequest,
  validateLegacyUpgradeResult,
  writeJsonAtomicExclusive,
} from './legacyUpgradeContracts.mjs';
import { executeLegacyUpgradeLifecycle } from './legacyUpgradeLifecycle.mjs';
import { verifyLegacyUpgradeArtifact } from './legacyUpgradeArtifact.mjs';
import { createLegacyUpgradeWindowsRuntime } from './legacyUpgradeWindowsRuntime.mjs';

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
    resultCode: 'historicalLegacyUpgradeFailed',
    errorCode,
    sourceInstallExitCode: null,
    upgradeExitCode: null,
    sourceStateValidated: false,
    sourcePackagedSmokeValidated: false,
    legacyBusinessFixtureValidated: false,
    majorUpgradeValidated: false,
    targetFirstStartupValidated: false,
    targetSecondStartupValidated: false,
    artifactBytesValidated: false,
  });
}

export async function runLegacyUpgradeWorker(arguments_) {
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
    request = await readLegacyUpgradeWorkerRequest(requestPath);
  } catch {
    return 64;
  }

  let result;
  try {
    const artifact = await verifyLegacyUpgradeArtifact({
      artifactRoot: request.fixtureRoot,
      expectedDescriptorSha256: request.artifactDescriptorSha256,
    });
    const runtime = await createLegacyUpgradeWindowsRuntime(request, artifact);
    result = await executeLegacyUpgradeLifecycle({
      ...runtime,
      versions: Object.freeze({
        source: artifact.source.msiProductVersion,
        target: artifact.target.msiProductVersion,
      }),
      reportProgress(entry) {
        try {
          console.log(JSON.stringify(entry));
        } catch {
          // Safe evidence output cannot alter the worker result.
        }
      },
    });
  } catch (error) {
    result = failedResult(safeCode(error, 'unexpectedFailure'));
  }

  try {
    const boundResult = validateLegacyUpgradeResult(
      {
        ...result,
        runNonce: request.runNonce,
        scenario: request.scenario,
        artifactDescriptorSha256: request.artifactDescriptorSha256,
      },
      request,
    );
    await writeJsonAtomicExclusive(
      legacyUpgradeResultPathForRequest(requestPath),
      boundResult,
    );
    await writeJsonAtomicExclusive(
      legacyUpgradeWorkerResultPathForRequest(requestPath),
      createLegacyUpgradeWorkerTerminalResult(request, boundResult),
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
  process.exitCode = await runLegacyUpgradeWorker(process.argv.slice(2));
}
