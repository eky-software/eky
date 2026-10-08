import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  LEGACY_UPGRADE_WORKER_EXIT_CODES,
  LEGACY_WORKER_OBSERVATION_OPERATION,
  LEGACY_PROCESS_OBSERVATIONS,
  LEGACY_RUNTIME_PROCESS_ROLES,
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
import { createWorkspacePhaseWriter } from './workspacePhaseWriter.mjs';

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
    sourceNormalStartupValidated: false,
    sourcePackagedSmokeValidated: false,
    legacyBusinessFixtureValidated: false,
    majorUpgradeValidated: false,
    targetFirstStartupValidated: false,
    targetSecondStartupValidated: false,
    artifactBytesValidated: false,
  });
}

export async function runLegacyUpgradeWorker(arguments_, {
  phaseObservation,
  createPhaseWriter = createWorkspacePhaseWriter,
  verifyArtifact = verifyLegacyUpgradeArtifact,
  createRuntime = createLegacyUpgradeWindowsRuntime,
  executeLifecycle = executeLegacyUpgradeLifecycle,
} = {}) {
  if (
    process.platform !== 'win32' ||
    arguments_.length !== 2 ||
    arguments_[0] !== '--request' ||
    typeof arguments_[1] !== 'string' ||
    arguments_[1].includes('\0')
  ) {
    return LEGACY_UPGRADE_WORKER_EXIT_CODES.invalidRequest;
  }
  let requestPath;
  try {
    requestPath = resolve(arguments_[1]);
  } catch {
    return LEGACY_UPGRADE_WORKER_EXIT_CODES.invalidRequest;
  }
  let request;
  try {
    request = await readLegacyUpgradeWorkerRequest(requestPath);
  } catch {
    return LEGACY_UPGRADE_WORKER_EXIT_CODES.invalidRequest;
  }

  // Reuse the bounded leaf writer; neither output nor a delivery acknowledgement
  // runs on the scenario's execution path. Its existing Job still owns the leaf.
  let writer;
  try { if (phaseObservation) writer = createPhaseWriter(phaseObservation); } catch {}
  const startedAt = performance.now();
  function observe(phase, status, resultCode) {
    try {
      writer?.send({ schemaVersion: 1, operation: LEGACY_WORKER_OBSERVATION_OPERATION,
        scenario: request.scenario, phase, status, durationMs: 0,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(resultCode === undefined ? {} : { resultCode }) });
    } catch { /* Optional observations cannot replace a worker failure. */ }
  }
  observe('requestValidated', 'completed');
  let result;
  let activePhase = 'artifactVerification';
  try {
    observe(activePhase, 'started');
    const artifact = await verifyArtifact({
      artifactRoot: request.fixtureRoot,
      expectedDescriptorSha256: request.artifactDescriptorSha256,
    });
    observe(activePhase, 'completed');
    activePhase = 'runtimePreparation';
    observe(activePhase, 'started');
    const runtime = await createRuntime(request, artifact, {
      observeOwnedProcess(role, code) {
        if (!LEGACY_RUNTIME_PROCESS_ROLES.includes(role) || !LEGACY_PROCESS_OBSERVATIONS.includes(code)) return;
        observe(role, code.endsWith('Failed') ? 'failed' : 'completed', code);
      },
    });
    observe(activePhase, 'completed');
    activePhase = 'lifecycle';
    result = await executeLifecycle({
      ...runtime,
      versions: Object.freeze({
        source: artifact.source.msiProductVersion,
        target: artifact.target.msiProductVersion,
      }),
      reportProgress(entry) {
        if (['started', 'completed', 'failed'].includes(entry.status)) observe(entry.phase, entry.status);
        try {
          console.log(JSON.stringify(entry));
        } catch {
          // Safe evidence output cannot alter the worker result.
        }
      },
    });
  } catch (error) {
    observe(activePhase, 'failed');
    result = failedResult(safeCode(error, 'unexpectedFailure'));
  }
  try {
    return await writeLegacyUpgradeWorkerOutcome(requestPath, request, result, {
      observePublication(status) { observe('resultPublication', status); },
    });
  } finally {
    // Stop the current writer without flushing or waiting for output receipts.
    // The unchanged outer Job boundary, not this diagnostic result, proves absence.
    try { await writer?.finish(); } catch {}
  }
}

export async function writeLegacyUpgradeWorkerOutcome(requestPath, request, result, { observePublication } = {}) {
  const observed = (status) => {
    try { observePublication?.(status); } catch { /* Keep publication and scenario outcomes independent. */ }
  };
  observed('started');
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
    observed('completed');
    return LEGACY_UPGRADE_WORKER_EXIT_CODES[boundResult.status];
  } catch {
    observed('failed');
    return LEGACY_UPGRADE_WORKER_EXIT_CODES.failed;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exit(await runLegacyUpgradeWorker(process.argv.slice(2)));
}
