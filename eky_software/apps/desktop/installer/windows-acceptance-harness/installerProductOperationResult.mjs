import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { validateWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

const MAX_BYTES = 192 * 1024;
const invalid = () => { throw new Error('productOperationResultInvalid'); };
const exact = (value, keys) => value && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function validateProductOperationWorkerResult(worker, request) {
  if (!exact(worker, ['schemaVersion', 'nonce', 'operation', 'status', 'state', 'errorCode', 'resultCleanup']) ||
    worker.schemaVersion !== 1 || worker.nonce !== request.nonce || worker.operation !== request.operation ||
    !['completed', 'failed'].includes(worker.status) || !['completed', 'failed'].includes(worker.resultCleanup) ||
    (worker.status === 'completed' ? worker.errorCode !== null || worker.resultCleanup !== 'completed'
      : !['preparationFailed', 'commandFailed', 'resultReadFailed', 'resultCleanupFailed'].includes(worker.errorCode))) invalid();
  return worker;
}

function failed(supervisor, exitCode) {
  return Object.freeze({ status: 'failed',
    resultCode: supervisor.processResultCode === 'deadlineExceeded' ? 'timedOut'
      : supervisor.status === 'failed' ? supervisor.processResultCode : 'workerResultInvalid',
    exitCode, directProcessAbsent: supervisor.processTreeAbsent, supervisor, worker: null });
}

async function readProductResult(root) {
  const path = resolve(root, 'product-result.json');
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
    before.size < 2n || before.size > BigInt(MAX_BYTES)) invalid();
  const same = (after) => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs']
    .every((key) => before[key] === after[key]);
  const handle = await open(path, 'r');
  try {
    if (!same(await handle.stat({ bigint: true }))) invalid();
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (BigInt(length) !== before.size || !same(await handle.stat({ bigint: true })) ||
      !same(await lstat(path, { bigint: true }))) invalid();
    return parseStrictJsonObjectBytes(bytes.subarray(0, length),
      { maximumBytes: MAX_BYTES, errorCode: 'productOperationResultInvalid' });
  } finally {
    await handle.close();
  }
}

// Both transports use the same operation/cleanup/state rules. A valid worker
// result never upgrades a failed or unverified process outcome.
function operationOutcome(supervisor, request, exitCode, readWorker) {
  try {
    const value = readWorker();
    const worker = value === null ? null : validateProductOperationWorkerResult(value, request);
    if (supervisor.status === 'completed' && worker?.status !== 'completed') invalid();
    let state;
    if (supervisor.status === 'completed' && request.operation === 'inspect') {
      if (typeof worker.state !== 'string') invalid();
      state = validateInstallerProductStateResult(parseStrictJsonObjectBytes(Buffer.from(worker.state, 'base64'),
        { errorCode: 'productOperationResultInvalid' }));
    }
    if (request.operation === 'uninstall' && worker !== null && worker.state !== null) invalid();
    return Object.freeze({ status: supervisor.status,
      resultCode: supervisor.processResultCode === 'deadlineExceeded' ? 'timedOut' : supervisor.processResultCode,
      exitCode, directProcessAbsent: supervisor.processTreeAbsent, state, supervisor, worker });
  } catch {
    return failed(supervisor, exitCode);
  }
}

export function validateProductOperationReply(bytes, request, exitCode) {
  const reply = parseStrictJsonObjectBytes(bytes, { errorCode: 'productOperationResultInvalid', maximumBytes: MAX_BYTES });
  if (!exact(reply, ['schemaVersion', 'nonce', 'operation', 'supervisor', 'worker']) ||
    reply.schemaVersion !== 1 || reply.nonce !== request.nonce || reply.operation !== request.operation) invalid();
  const supervisor = validateWindowsAcceptanceSupervisorResult(reply.supervisor, {
    runNonce: request.nonce, scenario: 'installerProductOperation', artifactDescriptorSha256: request.nonce,
    supervisorExitCode: exitCode,
  });
  return operationOutcome(supervisor, request, exitCode, () => {
    if (reply.worker === null) return null;
    if (typeof reply.worker !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(reply.worker)) invalid();
    return parseStrictJsonObjectBytes(Buffer.from(reply.worker, 'base64'),
      { errorCode: 'productOperationResultInvalid', maximumBytes: 128 * 1024 });
  });
}

// Called only from an owned read-only phase after the command owner observed
// the preceding phase return. It neither launches nor supervises a process.
export async function readOwnedProductOperationResult({ request, binding, supervisorResult, supervisorExitCode }) {
  if (!request || typeof request.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(request.nonce) ||
    !['inspect', 'uninstall'].includes(request.operation) ||
    typeof request.scenarioRoot !== 'string' || !isAbsolute(request.scenarioRoot) || request.scenarioRoot.includes('\0') ||
    !exact(binding, ['schemaVersion', 'runNonce', 'scenario', 'artifactDescriptorSha256']) ||
    binding.schemaVersion !== 1 || binding.runNonce !== request.nonce ||
    binding.scenario !== 'installerProductOperation') invalid();
  const supervisor = validateWindowsAcceptanceSupervisorResult(supervisorResult, {
    ...binding, supervisorExitCode,
  });
  if (!supervisor.processTreeAbsent) return failed(supervisor, supervisorExitCode);
  try {
    const root = resolve(request.scenarioRoot);
    const rootMetadata = await lstat(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() ||
      (await realpath(root)).toLowerCase() !== root.toLowerCase()) invalid();
    const value = await readProductResult(root);
    if ((await realpath(root)).toLowerCase() !== root.toLowerCase() || (await lstat(root)).isSymbolicLink()) invalid();
    if (!exact(value, ['binding', 'result']) || !exact(value.binding, Object.keys(binding)) ||
      Object.keys(binding).some((key) => value.binding[key] !== binding[key])) invalid();
    return operationOutcome(supervisor, request, supervisorExitCode, () => value.result);
  } catch {
    return failed(supervisor, supervisorExitCode);
  }
}
