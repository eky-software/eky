import { randomBytes } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const INSPECTOR_TIMEOUT_MILLISECONDS = 30_000;
export const SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS = 120_000;
export const DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS = 5_000;
const INSPECTOR_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'inspectWindowsInstallerProductState.ps1');

export function areProductProcessesAbsent(runtime) {
  if (runtime === null) return true;
  try { return runtime.outcome().productProcessAbsent === true; }
  catch { return false; }
}

function failure(result, operation) {
  const suffix = result?.directProcessAbsent !== true ? 'ProcessRemains'
    : result.resultCode === 'timedOut' ? 'TimedOut' : 'Failed';
  return Object.freeze({ status: 'failed', errorCode: `${operation}${suffix}` });
}

async function readInspectorResult(resultPath) {
  const metadata = await lstat(resultPath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
    metadata.size < 2n || metadata.size > 64n * 1024n) throw new Error('productStateVerificationFailed');
  return validateInstallerProductStateResult(parseStrictJsonObjectBytes(await readFile(resultPath), {
    errorCode: 'productStateVerificationFailed',
  }));
}

// Owns only the existing direct-child adapter; product classification belongs to each scenario.
export function createInstallerProductOperationRuntime({ scenarioRoot, environmentErrorCode }, {
  runProcess = runBoundedWindowsAdapterProcess,
  readResult = readInspectorResult,
  removeResult = (path) => rm(path, { force: true }),
  systemRoot = process.env.SystemRoot,
} = {}) {
  if (!systemRoot) throw new Error(environmentErrorCode);
  const powershell = resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const msiexec = resolve(systemRoot, 'System32', 'msiexec.exe');
  let productProcessAbsent = true;

  async function execute(request) {
    productProcessAbsent = false;
    try {
      const result = await runProcess(request);
      productProcessAbsent = result?.directProcessAbsent === true;
      return result;
    } catch {
      // A rejected invocation is not proof that no child was created.
      return { status: 'failed', directProcessAbsent: false };
    }
  }

  async function inspect(productCode) {
    if (!productProcessAbsent) return failure(null, 'productStateVerification');
    const resultPath = resolve(scenarioRoot, `post-supervisor-product-state-${randomBytes(8).toString('hex')}.json`);
    try {
      const result = await execute({ command: powershell,
        arguments: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', INSPECTOR_PATH,
          '-ProductCode', productCode, '-ResultPath', resultPath],
        cwd: scenarioRoot, timeoutMilliseconds: INSPECTOR_TIMEOUT_MILLISECONDS,
        terminationTimeoutMilliseconds: DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS });
      if (!productProcessAbsent || result.status !== 'completed' || result.exitCode !== 0) {
        return failure(result, 'productStateVerification');
      }
      return Object.freeze({ status: 'completed', state: await readResult(resultPath) });
    } catch {
      return Object.freeze({ status: 'failed', errorCode: 'productStateVerificationFailed' });
    } finally {
      if (productProcessAbsent) await removeResult(resultPath).catch(() => undefined);
    }
  }

  async function uninstall(productCode) {
    if (!productProcessAbsent) return failure(null, 'semanticCleanup');
    const result = await execute({ command: msiexec, arguments: ['/x', productCode, '/qn', '/norestart'],
      cwd: scenarioRoot, timeoutMilliseconds: SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS,
      terminationTimeoutMilliseconds: DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS });
    if (!productProcessAbsent || result.status !== 'completed' || result.exitCode !== 0) return failure(result, 'semanticCleanup');
    return Object.freeze({ status: 'completed', resultCode: 'semanticCleanupCompleted' });
  }

  return Object.freeze({ inspect, uninstall, outcome: () => Object.freeze({ productProcessAbsent }) });
}
