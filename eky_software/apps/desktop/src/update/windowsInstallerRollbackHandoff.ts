import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

import { resolveWindowsPowerShellPath } from './windowsInstallerIdentity.js';
import { resolveWindowsInstallerExecutable } from './windowsInstallerHandoff.js';

type SpawnProcess = typeof spawn;

const productCodePattern =
  /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/u;
const rollbackBootstrapAcknowledgement = 'EKY_ROLLBACK_HELPER_STARTED\r\n';
const rollbackBootstrapMaximumOutputBytes = 64;
const rollbackBootstrapTimeoutMilliseconds = 5_000;

export interface WindowsInstallerRollbackHandoffInput {
  failedPackagePath: string;
  failedProductCode: string;
  launcherProcessId: number;
  progressFilePath?: string;
  rollbackPackagePath: string;
  rollbackScriptPath: string;
  systemRoot: string | undefined;
}

export class WindowsInstallerRollbackHandoffError extends Error {
  constructor() {
    super('The Windows installer rollback could not be started safely.');
    this.name = 'WindowsInstallerRollbackHandoffError';
  }
}

export function launchWindowsInstallerRollback(
  input: WindowsInstallerRollbackHandoffInput,
  spawnProcess: SpawnProcess = spawn,
): Promise<void> {
  try {
    assertCanonicalFilePath(input.failedPackagePath, '.msi');
    assertCanonicalFilePath(input.rollbackPackagePath, '.msi');
    assertCanonicalFilePath(input.rollbackScriptPath, '.ps1');
    assertProcessId(input.launcherProcessId);
    if (!productCodePattern.test(input.failedProductCode)) {
      throw new WindowsInstallerRollbackHandoffError();
    }
    const powershellPath = resolveWindowsPowerShellPath(input.systemRoot);
    const msiExecPath = resolveWindowsInstallerExecutable(input.systemRoot);
    const rollbackBootstrapScriptPath = win32.join(
      win32.dirname(input.rollbackScriptPath),
      'launchRollbackWindowsInstaller.ps1',
    );
    assertCanonicalFilePath(rollbackBootstrapScriptPath, '.ps1');
    const progressArguments =
      input.progressFilePath === undefined
        ? []
        : (() => {
            assertCanonicalFilePath(input.progressFilePath, '.jsonl');
            return ['-ProgressPath', input.progressFilePath];
          })();
    const processHandle = spawnProcess(
      powershellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        rollbackBootstrapScriptPath,
        '-MsiExecPath',
        msiExecPath,
        '-FailedProductCode',
        input.failedProductCode,
        '-LauncherProcessId',
        String(input.launcherProcessId),
        '-FailedPackagePath',
        input.failedPackagePath,
        '-RollbackPackagePath',
        input.rollbackPackagePath,
        '-RollbackScriptPath',
        input.rollbackScriptPath,
        ...progressArguments,
      ],
      {
        detached: false,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    return waitUntilBootstrapCompleted(processHandle);
  } catch {
    return Promise.reject(new WindowsInstallerRollbackHandoffError());
  }
}

function assertProcessId(processId: number): void {
  if (
    !Number.isSafeInteger(processId) ||
    processId < 1 ||
    processId > 2_147_483_647
  ) {
    throw new WindowsInstallerRollbackHandoffError();
  }
}

function assertCanonicalFilePath(path: string, extension: string): void {
  if (
    path.includes('\0') ||
    !win32.isAbsolute(path) ||
    win32.resolve(path) !== path ||
    win32.extname(path).toLowerCase() !== extension
  ) {
    throw new WindowsInstallerRollbackHandoffError();
  }
}

function waitUntilBootstrapCompleted(
  processHandle: ChildProcess,
): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const settle = (result: 'resolve' | 'reject'): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (result === 'resolve') {
        resolveSpawn();
      } else {
        rejectSpawn(new WindowsInstallerRollbackHandoffError());
      }
    };
    const timeout = setTimeout(() => {
      try {
        processHandle.kill();
      } catch {
        // The exact bootstrap process may already have exited.
      }
      settle('reject');
    }, rollbackBootstrapTimeoutMilliseconds);
    processHandle.stdout?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > rollbackBootstrapMaximumOutputBytes) {
        try {
          processHandle.kill();
        } catch {
          // The exact bootstrap process may already have exited.
        }
        settle('reject');
        return;
      }
      output.push(buffer);
    });
    processHandle.once('error', () => settle('reject'));
    processHandle.once('close', (code, signal) => {
      const acknowledgement = Buffer.concat(output).toString('utf8');
      settle(
        signal === null &&
          code === 0 &&
          acknowledgement === rollbackBootstrapAcknowledgement
          ? 'resolve'
          : 'reject',
      );
    });
  });
}
