import { randomBytes } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

const INSPECTOR_TIMEOUT_MILLISECONDS = 30_000;
const SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS = 120_000;
const DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS = 5_000;
const INSPECTOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);

function adapterFailureCode(result, operation) {
  if (result.resultCode === 'timedOut') {
    return `${operation}TimedOut`;
  }
  if (!result.directProcessAbsent) {
    return `${operation}ProcessRemains`;
  }
  return `${operation}Failed`;
}

async function readInspectorResult(resultPath) {
  try {
    const metadata = await lstat(resultPath, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 2n ||
      metadata.size > 64n * 1024n
    ) {
      throw new Error('productStateVerificationFailed');
    }
    return validateInstallerProductStateResult(
      parseStrictJsonObjectBytes(await readFile(resultPath), {
        errorCode: 'productStateVerificationFailed',
      }),
    );
  } catch {
    throw new Error('productStateVerificationFailed');
  }
}

function productPresent(state) {
  return (
    state.productState >= 1 ||
    state.productName !== null ||
    state.productVersion !== null ||
    state.localPackagePresent ||
    state.ownedRegistryExists
  );
}

export function createUpgradeRollbackPostSupervisorWindowsRuntime({
  artifact,
  scenarioRoot,
}) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ENVIRONMENT_INVALID');
  }
  const powershell = resolve(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const msiexec = resolve(systemRoot, 'System32', 'msiexec.exe');

  async function inspectProduct(roleName) {
    const resultPath = resolve(
      scenarioRoot,
      `post-supervisor-${roleName}-${randomBytes(8).toString('hex')}.json`,
    );
    try {
      const processResult = await runBoundedWindowsAdapterProcess({
        command: powershell,
        arguments: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          INSPECTOR_PATH,
          '-ProductCode',
          `{${artifact.roles[roleName].productCode}}`,
          '-ResultPath',
          resultPath,
        ],
        cwd: scenarioRoot,
        timeoutMilliseconds: INSPECTOR_TIMEOUT_MILLISECONDS,
        terminationTimeoutMilliseconds:
          DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS,
      });
      if (processResult.status !== 'completed' || processResult.exitCode !== 0) {
        return Object.freeze({
          status: 'failed',
          errorCode: adapterFailureCode(
            processResult,
            'productStateVerification',
          ),
        });
      }
      return Object.freeze({
        status: 'completed',
        resultCode: productPresent(await readInspectorResult(resultPath))
          ? 'exactProductPresent'
          : 'exactProductAbsent',
      });
    } catch {
      return Object.freeze({
        status: 'failed',
        errorCode: 'productStateVerificationFailed',
      });
    } finally {
      await rm(resultPath, { force: true }).catch(() => undefined);
    }
  }

  async function verifyExactProductStates() {
    const source = await inspectProduct('source');
    const target = await inspectProduct('target');
    if (source.status === 'failed' || target.status === 'failed') {
      return Object.freeze({
        status: 'failed',
        errorCode:
          source.status === 'failed' ? source.errorCode : target.errorCode,
      });
    }
    const sourcePresent = source.resultCode === 'exactProductPresent';
    const targetPresent = target.resultCode === 'exactProductPresent';
    const resultCode = sourcePresent
      ? targetPresent
        ? 'multipleProductsPresent'
        : 'sourceProductPresent'
      : targetPresent
        ? 'targetProductPresent'
        : 'exactProductsAbsent';
    return Object.freeze({
      status: 'completed',
      resultCode,
      sourcePresent,
      targetPresent,
    });
  }

  async function uninstallRole(roleName) {
    const processResult = await runBoundedWindowsAdapterProcess({
      command: msiexec,
      arguments: [
        '/x',
        `{${artifact.roles[roleName].productCode}}`,
        '/qn',
        '/norestart',
      ],
      cwd: scenarioRoot,
      timeoutMilliseconds: SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS,
      terminationTimeoutMilliseconds:
        DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS,
    });
    if (processResult.status !== 'completed' || processResult.exitCode !== 0) {
      return Object.freeze({
        status: 'failed',
        errorCode: adapterFailureCode(processResult, 'semanticCleanup'),
      });
    }
    return Object.freeze({
      status: 'completed',
      resultCode: 'semanticCleanupCompleted',
    });
  }

  async function cleanupExactProducts() {
    const state = await verifyExactProductStates();
    if (state.status === 'failed') {
      return state;
    }
    let failure = null;
    for (const [roleName, present] of [
      ['target', state.targetPresent],
      ['source', state.sourcePresent],
    ]) {
      if (!present) {
        continue;
      }
      const result = await uninstallRole(roleName);
      if (result.status === 'failed') {
        failure ??= result;
      }
    }
    return (
      failure ??
      Object.freeze({
        status: 'completed',
        resultCode: 'semanticCleanupCompleted',
      })
    );
  }

  return Object.freeze({ cleanupExactProducts, verifyExactProductStates });
}
