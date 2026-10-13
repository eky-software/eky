import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

import { requireCanonicalWindowsSystemRoot } from './windowsSystemRoot.js';

type SpawnProcess = typeof spawn;

export interface WindowsInstallerHandoffInput {
  packagePath: string;
  systemRoot: string | undefined;
  /** Only the private, marker-validated packaged test supplies this path. */
  testLogPath?: string;
}

export class WindowsInstallerHandoffError extends Error {
  constructor() {
    super('The Windows installer could not be started safely.');
    this.name = 'WindowsInstallerHandoffError';
  }
}

export function launchWindowsInstallerForUpdate(
  input: WindowsInstallerHandoffInput,
  spawnProcess: SpawnProcess = spawn,
): Promise<void> {
  try {
    const executablePath = resolveWindowsInstallerExecutable(
      input.systemRoot,
    );
    assertSafePackagePath(input.packagePath);
    if (input.testLogPath !== undefined && (
      input.testLogPath.includes('\0') || !win32.isAbsolute(input.testLogPath) ||
      win32.resolve(input.testLogPath) !== input.testLogPath ||
      !input.testLogPath.endsWith('.private.log')
    )) throw new WindowsInstallerHandoffError();
    const processHandle = spawnProcess(
      executablePath,
      ['/i', input.packagePath, '/norestart',
        ...(input.testLogPath === undefined ? [] : ['/L*v', input.testLogPath])],
      {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    return waitUntilSpawned(processHandle);
  } catch {
    return Promise.reject(new WindowsInstallerHandoffError());
  }
}

export function resolveWindowsInstallerExecutable(
  systemRoot: string | undefined,
): string {
  try {
    return win32.join(
      requireCanonicalWindowsSystemRoot(systemRoot),
      'System32',
      'msiexec.exe',
    );
  } catch {
    throw new WindowsInstallerHandoffError();
  }
}

function assertSafePackagePath(packagePath: string): void {
  if (
    packagePath.includes('\0') ||
    !win32.isAbsolute(packagePath) ||
    win32.resolve(packagePath) !== packagePath ||
    !packagePath.toLowerCase().endsWith('.msi')
  ) {
    throw new WindowsInstallerHandoffError();
  }
}

function waitUntilSpawned(processHandle: ChildProcess): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    processHandle.once('error', () => {
      rejectSpawn(new WindowsInstallerHandoffError());
    });
    processHandle.once('spawn', () => {
      processHandle.unref();
      resolveSpawn();
    });
  });
}
