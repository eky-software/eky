import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { win32 } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  launchWindowsInstallerRollback,
  WindowsInstallerRollbackHandoffError,
} from './windowsInstallerRollbackHandoff.js';

describe('Windows installer rollback handoff', () => {
  it('starts only the packaged fixed launcher with rollback data outside the command line', async () => {
    const processHandle = createProcessHandle();
    const spawnProcess = createSpawnProcessMock(processHandle);
    const result = launchWindowsInstallerRollback(
      createInput(),
      spawnProcess as never,
    );
    processHandle.emit('spawn');
    await result;

    expect(spawnProcess).toHaveBeenCalledWith(
      win32.join('C:\\Windows', 'System32', 'cmd.exe'),
      [
        '/d',
        '/q',
        '/v:off',
        '/s',
        '/c',
        'rollbackWindowsInstallerLauncher.cmd',
      ],
      {
        cwd: 'C:\\Program Files\\Eky\\resources\\update-runtime',
        detached: true,
        env: expect.objectContaining({
          EKY_ROLLBACK_FAILED_PACKAGE_PATH:
            'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\candidate\\Eky-0.2.0-x64.msi',
          EKY_ROLLBACK_FAILED_PRODUCT_CODE:
            '{22222222-2222-4222-8222-222222222222}',
          EKY_ROLLBACK_LAUNCHER_PROCESS_ID: '4321',
          EKY_ROLLBACK_MSIEXEC_PATH:
            'C:\\Windows\\System32\\msiexec.exe',
          EKY_ROLLBACK_PROGRESS_PATH: '',
          EKY_ROLLBACK_PACKAGE_PATH:
            'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\current\\Eky-0.1.0-x64.msi',
          SystemRoot: 'C:\\Windows',
          windir: 'C:\\Windows',
        }),
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const commandArguments = spawnProcess.mock.calls[0]?.[1] ?? [];
    const spawnOptions = spawnProcess.mock.calls[0]?.[2];
    expect(commandArguments).not.toContain(
      '{22222222-2222-4222-8222-222222222222}',
    );
    expect(commandArguments).not.toContain(
      'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\candidate\\Eky-0.2.0-x64.msi',
    );
    expect(commandArguments).not.toContain(
      'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\current\\Eky-0.1.0-x64.msi',
    );
    expect(Object.keys(spawnOptions?.env ?? {}).sort()).toEqual(
      [
        'EKY_ROLLBACK_FAILED_PACKAGE_PATH',
        'EKY_ROLLBACK_FAILED_PRODUCT_CODE',
        'EKY_ROLLBACK_LAUNCHER_PROCESS_ID',
        'EKY_ROLLBACK_MSIEXEC_PATH',
        'EKY_ROLLBACK_PROGRESS_PATH',
        'EKY_ROLLBACK_PACKAGE_PATH',
        'SystemRoot',
        'windir',
      ].sort(),
    );
    expect(processHandle.unref).toHaveBeenCalledOnce();
  });

  it.each([
    { failedProductCode: '22222222-2222-4222-8222-222222222222' },
    { launcherProcessId: 0 },
    { launcherProcessId: 2_147_483_648 },
    { rollbackPackagePath: 'relative\\rollback.msi' },
    { rollbackScriptPath: 'C:\\Program Files\\Eky\\rollback.cmd' },
    {
      rollbackScriptPath:
        'C:\\Program Files\\Eky\\resources\\update-runtime\\anotherRollback.ps1',
    },
    { progressPath: 'relative\\rollback-progress.jsonl' },
    { systemRoot: 'C:\\Windows\\..\\Windows' },
  ])('rejects untrusted rollback input %#', async (override) => {
    await expect(
      launchWindowsInstallerRollback(
        { ...createInput(), ...override },
        vi.fn() as never,
      ),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackHandoffError);
  });

  it('passes only a canonical optional smoke progress file through the closed environment', async () => {
    const processHandle = createProcessHandle();
    const spawnProcess = createSpawnProcessMock(processHandle);
    const result = launchWindowsInstallerRollback(
      {
        ...createInput(),
        progressPath:
          'C:\\Users\\Example\\AppData\\Local\\Temp\\rollback-progress.jsonl',
      },
      spawnProcess as never,
    );
    processHandle.emit('spawn');
    await result;

    const commandArguments = spawnProcess.mock.calls[0]?.[1] ?? [];
    const options = spawnProcess.mock.calls[0]?.[2];
    expect(commandArguments).not.toContain(
      'C:\\Users\\Example\\AppData\\Local\\Temp\\rollback-progress.jsonl',
    );
    expect(options?.env).toEqual(
      expect.objectContaining({
        EKY_ROLLBACK_PROGRESS_PATH:
          'C:\\Users\\Example\\AppData\\Local\\Temp\\rollback-progress.jsonl',
      }),
    );
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

function createSpawnProcessMock(
  processHandle: ReturnType<typeof createProcessHandle>,
) {
  return vi.fn(
    (_command: string, _args: readonly string[], _options: SpawnOptions) =>
      processHandle,
  );
}
