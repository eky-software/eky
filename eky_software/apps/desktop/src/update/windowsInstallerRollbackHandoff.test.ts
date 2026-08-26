import { EventEmitter } from 'node:events';
import { win32 } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  launchWindowsInstallerRollback,
  WindowsInstallerRollbackHandoffError,
} from './windowsInstallerRollbackHandoff.js';

describe('Windows installer rollback handoff', () => {
  it('starts only the packaged fixed rollback script with validated arguments', async () => {
    const processHandle = createProcessHandle();
    const spawnProcess = vi.fn(() => processHandle);
    const result = launchWindowsInstallerRollback(
      createInput(),
      spawnProcess as never,
    );
    processHandle.emit('spawn');
    await result;

    expect(spawnProcess).toHaveBeenCalledWith(
      win32.join(
        'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        'C:\\Program Files\\Eky\\resources\\update-runtime\\rollbackWindowsInstaller.ps1',
        '-MsiExecPath',
        'C:\\Windows\\System32\\msiexec.exe',
        '-FailedProductCode',
        '{22222222-2222-4222-8222-222222222222}',
        '-LauncherProcessId',
        '4321',
        '-FailedPackagePath',
        'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\candidate\\Eky-0.2.0-x64.msi',
        '-RollbackPackagePath',
        'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\current\\Eky-0.1.0-x64.msi',
      ],
      {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    expect(processHandle.unref).toHaveBeenCalledOnce();
  });

  it.each([
    { failedProductCode: '22222222-2222-4222-8222-222222222222' },
    { launcherProcessId: 0 },
    { launcherProcessId: 2_147_483_648 },
    { rollbackPackagePath: 'relative\\rollback.msi' },
    { rollbackScriptPath: 'C:\\Program Files\\Eky\\rollback.cmd' },
    { systemRoot: 'C:\\Windows\\..\\Windows' },
  ])('rejects untrusted rollback input %#', async (override) => {
    await expect(
      launchWindowsInstallerRollback(
        { ...createInput(), ...override },
        vi.fn() as never,
      ),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackHandoffError);
  });

  it('fails safely when the detached process cannot start', async () => {
    const processHandle = createProcessHandle();
    const result = launchWindowsInstallerRollback(
      createInput(),
      vi.fn(() => processHandle) as never,
    );
    const rejection = expect(result).rejects.toBeInstanceOf(
      WindowsInstallerRollbackHandoffError,
    );
    processHandle.emit('error', new Error('synthetic spawn failure'));
    await rejection;
  });

  it('passes the private packaged-proof progress path only when supplied', async () => {
    const processHandle = createProcessHandle();
    const spawnProcess = vi.fn(() => processHandle);
    const result = launchWindowsInstallerRollback(
      {
        ...createInput(),
        progressFilePath:
          'C:\\Users\\Example\\AppData\\Local\\Temp\\eky-w6b2\\proof\\result\\w6b2-rollback-installer-progress.jsonl',
      },
      spawnProcess as never,
    );
    processHandle.emit('spawn');
    await result;

    const call = spawnProcess.mock.calls[0] as unknown as [string, string[]];
    const arguments_ = call[1];
    expect(arguments_.slice(-2)).toEqual([
      '-ProgressPath',
      'C:\\Users\\Example\\AppData\\Local\\Temp\\eky-w6b2\\proof\\result\\w6b2-rollback-installer-progress.jsonl',
    ]);
  });

  it('rejects an untrusted progress path', async () => {
    await expect(
      launchWindowsInstallerRollback(
        { ...createInput(), progressFilePath: 'relative\\progress.jsonl' },
        vi.fn() as never,
      ),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackHandoffError);
  });
});

function createInput() {
  return {
    failedPackagePath:
      'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\candidate\\Eky-0.2.0-x64.msi',
    failedProductCode: '{22222222-2222-4222-8222-222222222222}',
    launcherProcessId: 4321,
    rollbackPackagePath:
      'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\current\\Eky-0.1.0-x64.msi',
    rollbackScriptPath:
      'C:\\Program Files\\Eky\\resources\\update-runtime\\rollbackWindowsInstaller.ps1',
    systemRoot: 'C:\\Windows',
  };
}

function createProcessHandle() {
  const processHandle = new EventEmitter() as EventEmitter & {
    unref: ReturnType<typeof vi.fn>;
  };
  processHandle.unref = vi.fn();
  return processHandle;
}
