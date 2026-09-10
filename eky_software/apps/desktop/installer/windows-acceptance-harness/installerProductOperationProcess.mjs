import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { spawnSupervisorProcess } from './supervisorProcessLaunch.mjs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { validateProductOperationRequest } from './installerProductOperationWorker.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SUPERVISOR = resolve(DIRECTORY, '../bin/windows-process-supervisor/Release/net10.0/Eky.WindowsProcessSupervisor.dll');
const WORKER = resolve(DIRECTORY, 'installerProductOperationWorker.mjs');
const MAX_BYTES = 192 * 1024;
const invalid = () => { throw new Error('productOperationResultInvalid'); };
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === keys.sort().join(',');

export function validateProductOperationReply(bytes, request, exitCode) {
  const reply = parseStrictJsonObjectBytes(bytes, { errorCode: 'productOperationResultInvalid', maximumBytes: MAX_BYTES });
  if (!exact(reply, ['schemaVersion', 'nonce', 'operation', 'supervisor', 'worker']) ||
    reply.schemaVersion !== 1 || reply.nonce !== request.nonce || reply.operation !== request.operation) invalid();
  const supervisor = validateWindowsAcceptanceSupervisorResult(reply.supervisor, {
    runNonce: request.nonce, scenario: 'installerProductOperation', artifactDescriptorSha256: request.nonce,
    supervisorExitCode: exitCode,
  });
  let worker = null;
  try {
    if (reply.worker !== null) {
      if (typeof reply.worker !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(reply.worker)) invalid();
      worker = parseStrictJsonObjectBytes(Buffer.from(reply.worker, 'base64'),
        { errorCode: 'productOperationResultInvalid', maximumBytes: 128 * 1024 });
      if (!exact(worker, ['schemaVersion', 'nonce', 'operation', 'status', 'state', 'errorCode', 'resultCleanup']) ||
        worker.schemaVersion !== 1 || worker.nonce !== request.nonce || worker.operation !== request.operation ||
        !['completed', 'failed'].includes(worker.status) || !['completed', 'failed'].includes(worker.resultCleanup) ||
        (worker.status === 'completed' ? worker.errorCode !== null || worker.resultCleanup !== 'completed'
          : !['preparationFailed', 'commandFailed', 'resultReadFailed', 'resultCleanupFailed'].includes(worker.errorCode))) invalid();
    }
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
    return Object.freeze({ status: 'failed',
      resultCode: supervisor.processResultCode === 'deadlineExceeded' ? 'timedOut'
        : supervisor.status === 'failed' ? supervisor.processResultCode : 'workerResultInvalid',
      exitCode, directProcessAbsent: supervisor.processTreeAbsent, supervisor, worker: null });
  }
}

// The caller bounds its supervisor; that supervisor alone owns the auxiliary Job.
export async function runInstallerProductOperation({ operation, productCode, scenarioRoot,
  timeoutMilliseconds, terminationTimeoutMilliseconds, deliveryReserveMilliseconds = 1_000 },
{ spawnProcess = spawnSupervisorProcess, observe = () => {} } = {}) {
  const notify = (phase, status) => { try { observe(phase, status); } catch { /* Observation is not control. */ } };
  notify('productChannelSetup', 'started');
  const nonce = randomBytes(32).toString('hex');
  const request = validateProductOperationRequest({ schemaVersion: 1, nonce, operation, productCode, scenarioRoot,
    nodeExecutable: process.execPath, workerPath: WORKER,
    timeoutMilliseconds: timeoutMilliseconds + terminationTimeoutMilliseconds,
    cleanupReserveMilliseconds: terminationTimeoutMilliseconds, deliveryReserveMilliseconds });
  const sockets = new Set();
  let channelFailed = false, connections = 0, size = 0, bytes = [], messageReceived = false;
  let closed = false, supervisorExitCode = null, errorSeen = false;
  const server = createServer((socket) => {
    socket.on('error', () => { channelFailed = true; });
    if (++connections !== 1) { channelFailed = true; socket.destroy(); return; }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('data', (part) => {
      size += part.length;
      if (size > MAX_BYTES || messageReceived) { channelFailed = true; socket.destroy(); return; }
      bytes.push(part);
      const boundary = part.indexOf(10);
      if (boundary === -1) return;
      if (boundary !== part.length - 1) { channelFailed = true; socket.destroy(); return; }
      messageReceived = true;
      // Acknowledge reception, not success. Supervisor exit and strict validation remain mandatory.
      socket.write(Buffer.from([1]), (error) => { if (error) channelFailed = true; });
    });
  });
  server.on('error', () => { channelFailed = true; });
  try {
    await new Promise((ready, reject) => {
      server.once('error', reject);
      server.listen(`\\\\.\\pipe\\eky-product-caller-${nonce}`, () => {
        server.off('error', reject); ready();
      });
    });
    notify('productChannelSetup', 'completed');
    notify('productSupervisorWait', 'started');
    const invocation = await runBoundedWindowsAdapterProcess({
      command: process.env.EKY_DOTNET_EXE || 'dotnet',
      arguments: [SUPERVISOR, '--product-operation', Buffer.from(JSON.stringify(request)).toString('base64')],
      cwd: DIRECTORY, timeoutMilliseconds: request.timeoutMilliseconds + terminationTimeoutMilliseconds,
      terminationTimeoutMilliseconds,
      spawnProcess(command, args, options) {
        const child = spawnProcess(command, args, options);
        child.once('exit', () => notify('productSupervisorExit', 'completed'));
        child.on('error', () => { errorSeen = true; });
        child.once('close', (code, signal) => {
          closed = true; supervisorExitCode = signal === null ? code : null;
          notify('productSupervisorClose', 'completed');
        });
        return child;
      },
    });
    notify('productSupervisorWait', invocation.status === 'completed' ? 'completed' : 'failed');
    if (invocation.status !== 'completed') {
      // Even an acknowledged reply cannot prove final Job cleanup after forced host exit.
      let delivered = null;
      if (!channelFailed && messageReceived) {
        try { delivered = validateProductOperationReply(Buffer.concat(bytes), request, 1); } catch { /* Untrusted reply. */ }
      }
      return Object.freeze({ ...delivered, status: 'failed',
        resultCode: delivered?.status === 'failed' ? delivered.resultCode : invocation.resultCode,
        exitCode: supervisorExitCode, directProcessAbsent: false, invocation });
    }
    if (!closed || errorSeen || channelFailed || connections !== 1 || !messageReceived) invalid();
    return validateProductOperationReply(Buffer.concat(bytes), request, supervisorExitCode);
  } catch {
    return Object.freeze({ status: 'failed', resultCode: 'productOperationUnverified', exitCode: supervisorExitCode,
      directProcessAbsent: false });
  } finally {
    notify('productChannelCleanup', 'started');
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((done) => server.close(done));
    bytes = [];
    notify('productChannelCleanup', 'completed');
  }
}
