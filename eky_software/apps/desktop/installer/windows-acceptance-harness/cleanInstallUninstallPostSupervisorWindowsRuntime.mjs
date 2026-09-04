import { randomBytes } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstallerProductCode } from '../installerIdentity.mjs';
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

export function createCleanInstallUninstallPostSupervisorWindowsRuntime({
  manifest,
  scenarioRoot,
}) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_ENVIRONMENT_INVALID');
  }
  const productCode = `{${createInstallerProductCode(manifest.msiProductVersion)}}`;
  const powershell = resolve(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const msiexec = resolve(systemRoot, 'System32', 'msiexec.exe');

  async function verifyExactProductState() {
    const resultPath = resolve(
      scenarioRoot,
      `post-supervisor-product-state-${randomBytes(8).toString('hex')}.json`,
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
          productCode,
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
      const state = await readInspectorResult(resultPath);
      return Object.freeze({
        status: 'completed',
        resultCode:
          state.productState >= 1 ? 'exactProductPresent' : 'exactProductAbsent',
        exactProductPresent: state.productState >= 1,
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

  async function cleanupExactProduct() {
    const processResult = await runBoundedWindowsAdapterProcess({
      command: msiexec,
      arguments: ['/x', productCode, '/qn', '/norestart'],
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

  return Object.freeze({ cleanupExactProduct, verifyExactProductState });
}
