import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openReservedPreparation, publicationOptions, publishRequest, readProtocol, waitForObject } from './sourceHandoffPhase.mjs';
import { readWorkspaceCommandPhase, runWorkspaceCommandPhase } from '../../../../windows-acceptance-harness/workspaceCommandPhase.mjs';
import { createWorkspaceFaultWorkerRuntime } from '../../../../windows-acceptance-harness/workspaceWorkerRuntime.mjs';
import { createNativeFailureEvidence } from '../../../../windows-acceptance-harness/nativeFailureEvidence.mjs';

const invalid = () => new Error('requestInvalid');
const allowedErrors = ['sourceLaunchRequestInvalid', 'ownedProcessStartFailed', 'ownedProcessExitInvalid'];
const reservedInspectionAssembly = fileURLToPath(new URL('../../../../bin/source-handoff-joint/' +
  'Eky.WindowsProcessSupervisor.ContractFixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll', import.meta.url));

export function createReservedProductInspectionCommand(productCode, resultPath, environment) {
  return { command: environment.EKY_DOTNET_EXE || 'dotnet',
    arguments: [reservedInspectionAssembly, '--joint-passive-product-inspection', productCode, resultPath] };
}

export function readSourceMeasurementExit(result, envelope) {
  const keys = (value) => Object.keys(value ?? {}).sort().join(',');
  if (keys(result) !== 'binding,errorCode,exitCode,operation,schemaVersion,status' ||
      result.schemaVersion !== envelope.schemaVersion || result.operation !== envelope.operation ||
      keys(result.binding) !== keys(envelope.binding) ||
      Object.entries(envelope.binding).some(([key, value]) => result.binding[key] !== value)) throw invalid();
  if (result.status === 'failed' && result.exitCode === null && allowedErrors.includes(result.errorCode))
    throw new Error(result.errorCode);
  if (result.status !== 'completed' || result.errorCode !== null || !Number.isInteger(result.exitCode) ||
      result.exitCode < -2147483648 || result.exitCode > 2147483647) throw invalid();
  return result.exitCode;
}

export async function runWorkspaceSourceMeasurementPhase(args) {
  if (args.length !== 4 || args[0] !== '--phase-request' || args[2] !== '--reserved-run-root' ||
      [args[1], args[3]].some(path => !isAbsolute(path) || resolve(path) !== path) ||
      process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_JOB !== 'packaged-boundary-diagnostic' ||
      process.env.EKY_M51_PASSIVE_SOURCE_MEASUREMENT !== '1') throw invalid();
  const context = await readWorkspaceCommandPhase(args[1]);
  if (context.commandKind !== 'workspaceFault' ||
      context.callerBinding.faultScenario !== 'passiveWorkspaceMigrationFailure') throw invalid();
  const reservedPreparation = await openReservedPreparation(context, args[3], true);
  let consumed = false;
  return runWorkspaceCommandPhase(args.slice(0, 2), {
    reservedPreparation,
    createRuntime(requestPath, request, artifact, dependencies) {
      if (context.phase !== 'scenario') throw invalid();
      const scenarioRoot = resolve(context.state.runRoot, 'scenario');
      if (dirname(requestPath) !== scenarioRoot || request.runNonce !== context.scenarioRunNonce ||
          request.faultScenario !== 'passiveWorkspaceMigrationFailure' ||
          request.artifactDescriptorSha256 !== context.callerBinding.artifactDescriptorSha256 ||
          request.buildRevision !== context.callerBinding.buildRevision ||
          dependencies.resourceSelectionDirectory !== context.phaseRoot) throw invalid();
      return createWorkspaceFaultWorkerRuntime(requestPath, request, artifact, {
        ...dependencies,
        reservedProductInspectionCommand: createReservedProductInspectionCommand,
        async runSourceHandoff(sourceExecutableSha256) {
          if (consumed || typeof sourceExecutableSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceExecutableSha256))
            throw invalid();
          consumed = true;
          const controller = new AbortController();
          const operation = { signal: controller.signal, assertActive: () => controller.signal.throwIfAborted() };
          try {
            const protocol = await readProtocol();
            const options = await publicationOptions(context.phaseRoot, operation);
            const envelope = { schemaVersion: protocol.schemaVersion, operation: protocol.operation,
              binding: { runNonce: request.runNonce, scenario: request.scenario,
                artifactDescriptorSha256: request.artifactDescriptorSha256, buildRevision: request.buildRevision, scenarioRoot } };
            await publishRequest(context.phaseRoot, protocol, { ...envelope, sourceExecutableSha256 }, options);
            const { value } = await waitForObject(resolve(context.phaseRoot, protocol.resultFile),
              protocol.resultMaxBytes, options);
            return readSourceMeasurementExit(value, envelope);
          } finally { controller.abort(); }
        },
      });
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runWorkspaceSourceMeasurementPhase(process.argv.slice(2)); }
  catch (error) {
    const observe = createNativeFailureEvidence(import.meta.url, { scenario: 'workspaceCommandPhase' });
    observe(error, 'phaseRequest');
    await observe.finish();
    process.exitCode = 1;
  }
}
