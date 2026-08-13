import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

import { resolveWindowsInstallerExecutable } from './windowsInstallerHandoff.js';
import { requireCanonicalWindowsSystemRoot } from './windowsSystemRoot.js';

type SpawnProcess = typeof spawn;

const productCodePattern =
  /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/u;
const rollbackLauncherFileName = 'rollbackWindowsInstallerLauncher.cmd';
const rollbackScriptFileName = 'rollbackWindowsInstaller.ps1';
const rollbackEnvironmentKeys = Object.freeze({
  failedPackagePath: 'EKY_ROLLBACK_FAILED_PACKAGE_PATH',
  failedProductCode: 'EKY_ROLLBACK_FAILED_PRODUCT_CODE',
  launcherProcessId: 'EKY_ROLLBACK_LAUNCHER_PROCESS_ID',
  msiExecPath: 'EKY_ROLLBACK_MSIEXEC_PATH',
  progressPath: 'EKY_ROLLBACK_PROGRESS_PATH',
  rollbackPackagePath: 'EKY_ROLLBACK_PACKAGE_PATH',
});

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
    if (win32.basename(input.rollbackScriptPath) !== rollbackScriptFileName) {
      throw new WindowsInstallerRollbackHandoffError();
    }
    if (input.progressPath !== undefined) {
      assertCanonicalFilePath(input.progressPath, '.jsonl');
    }
    assertProcessId(input.launcherProcessId);
    if (!productCodePattern.test(input.failedProductCode)) {
      throw new WindowsInstallerRollbackHandoffError();
    }
    const commandPath = win32.join(workingDirectory, 'System32', 'cmd.exe');
    const msiExecPath = resolveWindowsInstallerExecutable(input.systemRoot);
    const rollbackRuntimeDirectory = win32.dirname(input.rollbackScriptPath);
    const processHandle = spawnProcess(
      commandPath,
      [
        '/d',
        '/q',
        '/v:off',
        '/s',
        '/c',
        rollbackLauncherFileName,
      ],
      {
        cwd: rollbackRuntimeDirectory,
        detached: true,
        env: createRollbackEnvironment({
          failedPackagePath: input.failedPackagePath,
          failedProductCode: input.failedProductCode,
          launcherProcessId: input.launcherProcessId,
          msiExecPath,
          progressPath: input.progressPath,
          rollbackPackagePath: input.rollbackPackagePath,
          systemRoot: workingDirectory,
        }),
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

function createRollbackEnvironment(input: {
  failedPackagePath: string;
  failedProductCode: string;
  launcherProcessId: number;
  msiExecPath: string;
  progressPath: string | undefined;
  rollbackPackagePath: string;
  systemRoot: string;
}): NodeJS.ProcessEnv {
  return {
    [rollbackEnvironmentKeys.failedPackagePath]: input.failedPackagePath,
    [rollbackEnvironmentKeys.failedProductCode]: input.failedProductCode,
    [rollbackEnvironmentKeys.launcherProcessId]: String(
      input.launcherProcessId,
    ),
    [rollbackEnvironmentKeys.msiExecPath]: input.msiExecPath,
    [rollbackEnvironmentKeys.progressPath]: input.progressPath ?? '',
    [rollbackEnvironmentKeys.rollbackPackagePath]: input.rollbackPackagePath,
    SystemRoot: input.systemRoot,
    windir: input.systemRoot,
  };
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
