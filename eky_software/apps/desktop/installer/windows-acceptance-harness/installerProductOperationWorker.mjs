import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 64 * 1024;
export function validateProductOperationRequest(value) {
  const keys = ['schemaVersion', 'nonce', 'operation', 'productCode', 'scenarioRoot', 'nodeExecutable',
    'workerPath', 'timeoutMilliseconds', 'cleanupReserveMilliseconds', 'deliveryReserveMilliseconds'].sort();
  if (!value || Object.keys(value).sort().join(',') !== keys.join(',') || value.schemaVersion !== 1 ||
    !/^[0-9a-f]{64}$/.test(value.nonce) || !['inspect', 'uninstall'].includes(value.operation) ||
    !/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/.test(value.productCode) ||
    ['scenarioRoot', 'nodeExecutable', 'workerPath'].some((key) =>
      typeof value[key] !== 'string' || !isAbsolute(value[key]) || value[key].includes('\0')) ||
    !Number.isInteger(value.timeoutMilliseconds) || value.timeoutMilliseconds < 200 || value.timeoutMilliseconds > 125_000 ||
    !Number.isInteger(value.cleanupReserveMilliseconds) || value.cleanupReserveMilliseconds < 50 ||
    value.cleanupReserveMilliseconds > 5_000 || value.cleanupReserveMilliseconds >= value.timeoutMilliseconds ||
    !Number.isInteger(value.deliveryReserveMilliseconds) || value.deliveryReserveMilliseconds < 50 ||
    value.deliveryReserveMilliseconds > 1_000 || value.deliveryReserveMilliseconds >= value.cleanupReserveMilliseconds) {
    throw new Error('productRequestInvalid');
  }
  return Object.freeze({ ...value });
}

function runCommand(command, args, cwd) {
  return new Promise((done, reject) => {
    let failed = false;
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => { failed = true; });
    child.once('close', (code, signal) => {
      if (failed || code !== 0 || signal !== null) reject(new Error('productCommandFailed'));
      else done();
    });
  });
}

async function prepare(root) {
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    (await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()) throw new Error('productRootInvalid');
}

async function readState(path) {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
    metadata.size < 2n || metadata.size > BigInt(MAX_BYTES)) throw new Error('productStateInvalid');
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error('productStateInvalid');
  return bytes.toString('base64');
}

// The Job owns native query, result I/O and failure-path removal, not just the child wait.
export async function executeProductOperation(input, {
  prepareRoot = prepare, execute = runCommand, readResult = readState,
  createDirectory = mkdir, removeDirectory = rmdir,
  removeResult = (path) => rm(path, { force: true }), systemRoot = process.env.SystemRoot,
} = {}) {
  const request = validateProductOperationRequest(input);
  const operationRoot = resolve(request.scenarioRoot, `product-operation-${request.nonce}`);
  const resultPath = resolve(operationRoot, 'state.json');
  let errorCode = null, state = null, resultCleanup = 'completed', prepared = false;
  let phase = 'preparation';
  try {
    if (!systemRoot) throw new Error('productEnvironmentInvalid');
    await prepareRoot(request.scenarioRoot);
    await createDirectory(operationRoot);
    prepared = true;
    phase = 'command';
    if (request.operation === 'inspect') {
      await execute(resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          resolve(DIRECTORY, 'inspectWindowsInstallerProductState.ps1'), '-ProductCode', request.productCode,
          '-ResultPath', resultPath], request.scenarioRoot);
      phase = 'resultRead';
      state = await readResult(resultPath);
    } else {
      await execute(resolve(systemRoot, 'System32/msiexec.exe'),
        ['/x', request.productCode, '/qn', '/norestart'], request.scenarioRoot);
    }
  } catch { errorCode = `${phase}Failed`; }
  finally {
    if (prepared) {
      try {
        if (request.operation === 'inspect') await removeResult(resultPath);
        await removeDirectory(operationRoot);
      }
      catch { resultCleanup = 'failed'; errorCode ??= 'resultCleanupFailed'; }
    }
  }
  return Object.freeze({ schemaVersion: 1, nonce: request.nonce, operation: request.operation,
    status: errorCode === null ? 'completed' : 'failed', state, errorCode, resultCleanup });
}

export async function sendProductOperationResult(request, result) {
  const bytes = Buffer.from(JSON.stringify(result));
  if (bytes.length > 2 * MAX_BYTES) throw new Error('productResultInvalid');
  await new Promise((done, reject) => {
    const socket = connect(`\\\\.\\pipe\\eky-product-worker-${request.nonce}`);
    socket.once('error', reject);
    socket.once('connect', () => socket.end(bytes));
    socket.once('close', (hadError) => hadError ? reject(new Error('productChannelFailed')) : done());
  });
}

// The command-entrypoint migration uses the existing supervisor's worker-result
// contract. Preparation, operation, publication and their failure paths all run
// inside its Job; this worker does not start a supervisor or own emergency cleanup.
export async function runOwnedProductOperation(input, {
  operationDependencies,
  publishResult = writeJsonAtomicExclusive,
} = {}) {
  const exactKeys = (value, keys) => value && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (!exactKeys(input, ['request', 'binding'])) throw new Error('productRequestInvalid');
  const request = validateProductOperationRequest(input.request);
  const binding = input.binding;
  if (!exactKeys(binding, ['schemaVersion', 'runNonce', 'scenario', 'artifactDescriptorSha256']) ||
    binding.schemaVersion !== 1 || binding.runNonce !== request.nonce ||
    binding.scenario !== 'installerProductOperation' ||
    typeof binding.artifactDescriptorSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(binding.artifactDescriptorSha256)) {
    throw new Error('productRequestInvalid');
  }
  await prepare(request.scenarioRoot);
  const productResultPath = resolve(request.scenarioRoot, 'product-result.json');
  const terminalPath = resolve(request.scenarioRoot, 'worker-result.json');
  for (const path of [productResultPath, terminalPath]) {
    await lstat(path).then(
      () => { throw new Error('productResultPathOccupied'); },
      (error) => { if (error?.code !== 'ENOENT') throw new Error('productResultPathInvalid'); },
    );
  }
  const result = await executeProductOperation(request, operationDependencies);
  // The detailed original failure survives a later terminal-publication failure.
  await publishResult(productResultPath, { binding, result });
  await publishResult(terminalPath, {
    ...binding, status: result.status,
    resultCode: result.status === 'completed' ? 'productCompleted' : 'productFailed',
    errorCode: result.errorCode,
  });
  return result.status === 'completed' ? 0 : 1;
}

async function readOwnedRequest(path) {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('productRequestInvalid');
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
    metadata.size < 2n || metadata.size > BigInt(MAX_BYTES)) throw new Error('productRequestInvalid');
  return parseStrictJsonObjectBytes(await readFile(path),
    { errorCode: 'productRequestInvalid', maximumBytes: MAX_BYTES });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length === 4 && process.argv[2] === '--owned-request') {
      process.exitCode = await runOwnedProductOperation(await readOwnedRequest(process.argv[3]));
    } else {
      if (process.argv.length !== 3) throw new Error('productRequestInvalid');
      const request = validateProductOperationRequest(parseStrictJsonObjectBytes(Buffer.from(process.argv[2], 'base64'),
        { errorCode: 'productRequestInvalid' }));
      const result = await executeProductOperation(request);
      await sendProductOperationResult(request, result);
      process.exitCode = result.status === 'completed' ? 0 : 1;
    }
  } catch { process.exitCode = 1; }
}
