import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import {
  WORKSPACE_SUCCESS_EXIT_CODES, WORKSPACE_SUCCESS_PHASES, readWorkspaceSuccessRequest,
  validateWorkspaceSuccessResult, workspaceSuccessErrorCode, workspaceSuccessResultPath,
  workspaceSuccessWorkerResult, writeJsonAtomicExclusive,
} from './workspaceSuccessContracts.mjs';
import { executeWorkspaceSuccessLifecycle } from './workspaceSuccessLifecycle.mjs';
import { createWorkspaceSuccessWorkerRuntime } from './workspaceWorkerRuntime.mjs';
import { createNativeFailureEvidence } from './nativeFailureEvidence.mjs';
export { createWorkspaceSuccessWorkerRuntime } from './workspaceWorkerRuntime.mjs';

export async function runWorkspaceSuccessWorker(arguments_, {
  platform = process.platform, readRequest = readWorkspaceSuccessRequest,
  verifyArtifact = verifyWorkspaceSuccessArtifact, createRuntime = createWorkspaceSuccessWorkerRuntime,
  execute = executeWorkspaceSuccessLifecycle, writeResult = writeJsonAtomicExclusive,
  reportProgress = (value) => console.log(JSON.stringify(value)),
  createFailureEvidence = request => createNativeFailureEvidence(import.meta.url, request),
} = {}) {
  if (platform !== 'win32' || arguments_.length !== 2 || arguments_[0] !== '--request' ||
    typeof arguments_[1] !== 'string' || arguments_[1].includes('\0')) return WORKSPACE_SUCCESS_EXIT_CODES.invalidRequest;
  let request;
  let requestPath;
  try { requestPath = resolve(arguments_[1]); request = await readRequest(requestPath); }
  catch { return WORKSPACE_SUCCESS_EXIT_CODES.invalidRequest; }
  const observeFailure = createFailureEvidence(request);
  let result;
  try {
    const artifact = await verifyArtifact({ artifactRoot: request.fixtureRoot,
      expectedDescriptorSha256: request.artifactDescriptorSha256, expectedBuildRevision: request.buildRevision });
    const runtime = await createRuntime(requestPath, request, artifact);
    try {
      result = await execute({ ...runtime, reportProgress, reportInstallationProgress: reportProgress, observeFailure });
    } finally { runtime.disposeSessionEvidence(); }
  } catch (error) {
    observeFailure(error, 'workerPreparation');
    result = { schemaVersion: 1, status: 'failed', resultCode: 'workspaceSuccessFailed',
      errorCode: workspaceSuccessErrorCode(error), failedPhase: WORKSPACE_SUCCESS_PHASES[0], completedPhases: [] };
  }
  try {
    const bound = validateWorkspaceSuccessResult({ ...result, scenario: request.scenario,
      runNonce: request.runNonce, artifactDescriptorSha256: request.artifactDescriptorSha256 }, request);
    await writeResult(workspaceSuccessResultPath(requestPath), bound);
    await writeResult(resolve(dirname(requestPath), 'worker-result.json'), workspaceSuccessWorkerResult(request, bound));
    return WORKSPACE_SUCCESS_EXIT_CODES[bound.status];
  } catch (error) { observeFailure(error, 'resultPublication'); return WORKSPACE_SUCCESS_EXIT_CODES.failed; }
  finally { await observeFailure.finish(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await runWorkspaceSuccessWorker(process.argv.slice(2)));
}
