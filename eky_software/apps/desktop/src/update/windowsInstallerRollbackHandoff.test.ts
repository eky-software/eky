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
    completeBootstrap(processHandle);
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
        'C:\\Program Files\\Eky\\resources\\update-runtime\\launchRollbackWindowsInstaller.ps1',
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
        '-RollbackScriptPath',
        'C:\\Program Files\\Eky\\resources\\update-runtime\\rollbackWindowsInstaller.ps1',
      ],
      {
        detached: false,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
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

  it.each([
    {
      acknowledgement: 'EKY_ROLLBACK_HELPER_STARTED\r\n',
      code: 1,
      signal: null,
    },
    {
      acknowledgement: 'EKY_ROLLBACK_HELPER_STARTED\r\n',
      code: 0,
      signal: 'SIGTERM',
    },
    { acknowledgement: 'unexpected\r\n', code: 0, signal: null },
    { acknowledgement: '', code: 0, signal: null },
  ])('fails safely for an invalid bootstrap terminal outcome %#', async ({
    acknowledgement,
    code,
    signal,
  }) => {
    const processHandle = createProcessHandle();
    const result = launchWindowsInstallerRollback(
      createInput(),
      vi.fn(() => processHandle) as never,
    );
    const rejection = expect(result).rejects.toBeInstanceOf(
      WindowsInstallerRollbackHandoffError,
    );
    if (acknowledgement !== '') {
      processHandle.stdout.emit('data', Buffer.from(acknowledgement));
    }
    processHandle.emit('close', code, signal);
    await rejection;
  });

  it('bounds bootstrap acknowledgement output', async () => {
    const processHandle = createProcessHandle();
    const result = launchWindowsInstallerRollback(
      createInput(),
      vi.fn(() => processHandle) as never,
    );
    const rejection = expect(result).rejects.toBeInstanceOf(
      WindowsInstallerRollbackHandoffError,
    );
    processHandle.stdout.emit('data', Buffer.alloc(65));
    await rejection;
    expect(processHandle.kill).toHaveBeenCalledOnce();
  });

  it('bounds bootstrap completion time and stops only that bootstrap', async () => {
    vi.useFakeTimers();
    try {
      const processHandle = createProcessHandle();
      const result = launchWindowsInstallerRollback(
        createInput(),
        vi.fn(() => processHandle) as never,
      );
      const rejection = expect(result).rejects.toBeInstanceOf(
        WindowsInstallerRollbackHandoffError,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
      expect(processHandle.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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
    completeBootstrap(processHandle);
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
    kill: ReturnType<typeof vi.fn>;
    stdout: EventEmitter;
  };
  processHandle.kill = vi.fn();
  processHandle.stdout = new EventEmitter();
  return processHandle;
}

function completeBootstrap(
  processHandle: ReturnType<typeof createProcessHandle>,
) {
  processHandle.stdout.emit(
    'data',
    Buffer.from('EKY_ROLLBACK_HELPER_STARTED\r\n'),
  );
  processHandle.emit('close', 0, null);
}
