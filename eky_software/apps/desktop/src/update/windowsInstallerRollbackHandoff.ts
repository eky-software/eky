import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

import { resolveWindowsPowerShellPath } from './windowsInstallerIdentity.js';
import { resolveWindowsInstallerExecutable } from './windowsInstallerHandoff.js';
import { requireCanonicalWindowsSystemRoot } from './windowsSystemRoot.js';

type SpawnProcess = typeof spawn;

const productCodePattern =
  /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/u;

export interface WindowsInstallerRollbackHandoffInput {
  failedPackagePath: string;
  failedProductCode: string;
  launcherProcessId: number;
  progressPath?: string;
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
    const workingDirectory = requireCanonicalWindowsSystemRoot(
      input.systemRoot,
    );
    assertCanonicalFilePath(input.failedPackagePath, '.msi');
    assertCanonicalFilePath(input.rollbackPackagePath, '.msi');
    assertCanonicalFilePath(input.rollbackScriptPath, '.ps1');
    if (input.progressPath !== undefined) {
      assertCanonicalFilePath(input.progressPath, '.jsonl');
    }
    assertProcessId(input.launcherProcessId);
    if (!productCodePattern.test(input.failedProductCode)) {
      throw new WindowsInstallerRollbackHandoffError();
    }
    const powershellPath = resolveWindowsPowerShellPath(input.systemRoot);
    const msiExecPath = resolveWindowsInstallerExecutable(input.systemRoot);
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
        input.rollbackScriptPath,
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
        ...(input.progressPath === undefined
          ? []
          : ['-ProgressPath', input.progressPath]),
      ],
      {
        cwd: workingDirectory,
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    return waitUntilSpawned(processHandle);
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

function waitUntilSpawned(processHandle: ChildProcess): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    processHandle.once('error', () => {
      rejectSpawn(new WindowsInstallerRollbackHandoffError());
    });
    processHandle.once('spawn', () => {
      processHandle.unref();
      resolveSpawn();
    });
  });
}
