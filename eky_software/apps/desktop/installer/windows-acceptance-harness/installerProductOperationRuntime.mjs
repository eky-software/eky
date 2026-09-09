import { runInstallerProductOperation } from './installerProductOperationProcess.mjs';

export const INSPECTOR_TIMEOUT_MILLISECONDS = 30_000;
export const SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS = 120_000;
export const DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS = 5_000;

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

export function createInstallerProductOperationRuntime({ scenarioRoot, environmentErrorCode }, {
  runProcess = runInstallerProductOperation,
  systemRoot = process.env.SystemRoot,
} = {}) {
  if (!systemRoot) throw new Error(environmentErrorCode);
  let productProcessAbsent = true;

  async function execute(operation, productCode, timeoutMilliseconds) {
    if (!productProcessAbsent) return null;
    productProcessAbsent = false;
    try {
      const result = await runProcess({ operation, productCode, scenarioRoot, timeoutMilliseconds,
        terminationTimeoutMilliseconds: DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS });
      productProcessAbsent = result?.directProcessAbsent === true;
      return result;
    } catch {
      // A rejected invocation is not proof that no child was created.
      return { status: 'failed', directProcessAbsent: false };
    }
  }

  async function inspect(productCode) {
    const result = await execute('inspect', productCode, INSPECTOR_TIMEOUT_MILLISECONDS);
    return productProcessAbsent && result?.status === 'completed' && result.exitCode === 0
      ? Object.freeze({ status: 'completed', state: result.state }) : failure(result, 'productStateVerification');
  }

  async function uninstall(productCode) {
    const result = await execute('uninstall', productCode, SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS);
    if (!productProcessAbsent || result?.status !== 'completed' || result.exitCode !== 0) return failure(result, 'semanticCleanup');
    return Object.freeze({ status: 'completed', resultCode: 'semanticCleanupCompleted' });
  }

  return Object.freeze({ inspect, uninstall, outcome: () => Object.freeze({ productProcessAbsent }) });
}
