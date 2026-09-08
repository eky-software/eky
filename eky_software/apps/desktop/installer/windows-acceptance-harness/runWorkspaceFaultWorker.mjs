import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import { writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';
import { WORKSPACE_FAULT_EXIT_CODES, readWorkspaceFaultRequest, validateWorkspaceFaultResult,
  workspaceFaultErrorCode, workspaceFaultPlan, workspaceFaultResultPath, workspaceFaultWorkerResult } from './workspaceFaultContracts.mjs';
import { executeWorkspaceFaultLifecycle } from './workspaceFaultLifecycle.mjs';
import { createWorkspaceFaultWorkerRuntime } from './workspaceWorkerRuntime.mjs';

export async function runWorkspaceFaultWorker(arguments_, {
  platform = process.platform, readRequest = readWorkspaceFaultRequest,
  verifyArtifact = verifyWorkspaceSuccessArtifact, createRuntime = createWorkspaceFaultWorkerRuntime,
  execute = executeWorkspaceFaultLifecycle, writeResult = writeJsonAtomicExclusive,
  reportProgress = (value) => console.log(JSON.stringify(value)),
} = {}) {
  if (platform !== 'win32' || arguments_.length !== 2 || arguments_[0] !== '--request' ||
    typeof arguments_[1] !== 'string' || arguments_[1].includes('\0')) return WORKSPACE_FAULT_EXIT_CODES.invalidRequest;
  let request;
  let requestPath;
  try { requestPath = resolve(arguments_[1]); request = await readRequest(requestPath); }
  catch { return WORKSPACE_FAULT_EXIT_CODES.invalidRequest; }
  let result;
  try {
    const artifact = await verifyArtifact({ artifactRoot: request.fixtureRoot,
      expectedDescriptorSha256: request.artifactDescriptorSha256, expectedBuildRevision: request.buildRevision });
    const runtime = await createRuntime(requestPath, request, artifact);
    try { result = await execute(request.faultScenario, { ...runtime, reportProgress }); }
    finally { runtime.disposeSessionEvidence(); }
  } catch (error) {
    result = { schemaVersion: 1, status: 'failed', resultCode: 'workspaceFaultFailed',
      errorCode: workspaceFaultErrorCode(error), failedPhase: workspaceFaultPlan(request.faultScenario).phases[0], completedPhases: [] };
  }
  try {
    const bound = validateWorkspaceFaultResult({ ...result, scenario: request.scenario,
      faultScenario: request.faultScenario, runNonce: request.runNonce,
      artifactDescriptorSha256: request.artifactDescriptorSha256 }, request);
    await writeResult(workspaceFaultResultPath(requestPath), bound);
    await writeResult(resolve(dirname(requestPath), 'worker-result.json'), workspaceFaultWorkerResult(request, bound));
    return WORKSPACE_FAULT_EXIT_CODES[bound.status];
  } catch { return WORKSPACE_FAULT_EXIT_CODES.failed; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await runWorkspaceFaultWorker(process.argv.slice(2)));
}
