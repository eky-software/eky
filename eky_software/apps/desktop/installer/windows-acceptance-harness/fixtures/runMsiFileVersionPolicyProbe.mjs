import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupRunContext, createRequest, createRunContext, startSupervisor, writeRequest,
} from '../../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { hashBytes, readPolicyBytes, readMsiPolicyDescriptor, verifyMsiPolicyFixture } from './msiFileVersionPolicyRuntime.mjs';
import { requireHostedMsiPolicyEnvironment } from './msiFileVersionPolicyWorker.mjs';
import { validateMsiPolicyResult } from './msiFileVersionPolicyLifecycle.mjs';
import { parseStrictJsonObjectBytes } from '../strictJsonObject.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(await readFile(resolve(DIRECTORY, '../../windows-process-supervisor/supervisorCommandBudgets.json')));
const [, timeoutMilliseconds, cleanupReserveMilliseconds] = budgets.legacyCommand.phases.find(([phase]) => phase === 'scenario');

async function runPhase(mode, bindingHash, contexts, descriptorPath) {
  const context = await createRunContext('msi-policy-' + mode);
  contexts.push(context);
  context.scenario = 'msiFileVersionPolicy';
  context.artifactDescriptorSha256 = bindingHash;
  const request = createRequest(context, 'exitZero', { timeoutMilliseconds, cleanupReserveMilliseconds });
  request.arguments = [resolve(DIRECTORY, 'msiFileVersionPolicyWorker.mjs'), mode, context.requestPath,
    ...(descriptorPath ? [descriptorPath] : [])];
  await writeRequest(context, request);
  const completion = await startSupervisor(context).completion;
  const supervisor = await readWindowsAcceptanceSupervisorResult(context.resultPath,
    { ...context, supervisorExitCode: completion.exitCode });
  context.provenAbsent = supervisor.processTreeAbsent;
  let detail;
  try { detail = parseStrictJsonObjectBytes(await readPolicyBytes(resolve(context.testRoot, 'policy-result.json')),
    { maximumBytes: 64 * 1024, errorCode: 'msiPolicyResultInvalid' }); } catch { /* Missing evidence is failure. */ }
  const validBinding = detail && Object.keys(detail).sort().join(',') === 'binding,result' && detail.binding && Object.keys(detail.binding).sort().join(',') ===
    'artifactDescriptorSha256,runNonce,scenario,schemaVersion' && detail.binding.schemaVersion === 1 &&
    detail.binding.runNonce === context.runNonce && detail.binding.scenario === context.scenario &&
    detail.binding.artifactDescriptorSha256 === bindingHash;
  let result;
  if (validBinding) {
    try { result = validateMsiPolicyResult(mode, detail.result); } catch { /* Malformed evidence is failure. */ }
  }
  const success = supervisor.status === 'completed' && result?.status === 'completed';
  // Never publish the private descriptor, raw MSI trace, hashes, paths or identities.
  console.log(JSON.stringify({ schemaVersion: 1, operation: 'msiFileVersionPolicy', variant: mode,
    status: success ? 'completed' : 'failed', phase: result?.phase ?? 'unknown',
    errorCode: result ? result.errorCode : 'unknown', causeCode: result ? result.causeCode : 'unknown',
    cleanupStatus: result?.cleanupStatus ?? 'notObserved',
    cleanupErrorCode: result ? result.cleanupErrorCode : 'unknown',
    cleanupCauseCode: result ? result.cleanupCauseCode : 'unknown',
    processResultCode: supervisor.processResultCode, processTreeAbsent: supervisor.processTreeAbsent }));
  if (!success) throw new Error('msiPolicyProbeFailed');
  return context;
}

export async function runMsiFileVersionPolicyProbe({ prepareOnly = false, retainEvidence = false } = {}) {
  if (!prepareOnly) requireHostedMsiPolicyEnvironment(process.env);
  if (process.platform !== 'win32') throw new Error('msiPolicyWindowsRequired');
  const contexts = [];
  let passed = false;
  let failure;
  try {
    const authoring = await readFile(resolve(DIRECTORY, '../../wix/Package.wxs'));
    const preparation = await runPhase('prepare', hashBytes(authoring), contexts);
    const descriptorPath = resolve(preparation.testRoot, 'fixture', 'descriptor.json');
    const descriptorHash = hashBytes(await readPolicyBytes(descriptorPath));
    const descriptor = await readMsiPolicyDescriptor(descriptorPath, descriptorHash);
    await verifyMsiPolicyFixture(descriptor);
    if (!prepareOnly) {
      await runPhase('uiDefault', descriptorHash, contexts, descriptorPath);
      await runPhase('uiOverride', descriptorHash, contexts, descriptorPath);
      await verifyMsiPolicyFixture(descriptor);
    }
    passed = true;
  } catch (error) {
    failure = error;
  } finally {
    // Keep all first-attempt evidence on any failure, including uncertain MSI cleanup.
    for (const context of contexts) {
      try { await cleanupRunContext(context, { preserveEvidence: true }); }
      catch {
        failure ??= new Error('msiPolicyContextCleanupFailed');
        passed = false;
      }
    }
    if (passed && !retainEvidence && contexts.every(context => context.provenAbsent)) {
      for (const context of contexts) await cleanupRunContext(context);
    }
  }
  if (failure) throw failure;
}

export function parseMsiPolicyProbeArguments(args) {
  if (args.length === 0) return {};
  if (args.length === 1 && args[0] === '--prepare-only') return { prepareOnly: true };
  if (args.length === 1 && args[0] === '--retain-evidence') return { retainEvidence: true };
  throw new Error('msiPolicyArgumentsInvalid');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runMsiFileVersionPolicyProbe(parseMsiPolicyProbeArguments(process.argv.slice(2)));
  } catch { console.error('MSI_POLICY_PROBE_FAILED'); process.exitCode = 1; }
}
