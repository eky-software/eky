import { EventEmitter } from 'node:events';
import { win32 } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  launchWindowsInstallerForUpdate,
  resolveWindowsInstallerExecutable,
  WindowsInstallerHandoffError,
} from './windowsInstallerHandoff.js';

describe('Windows installer update handoff', () => {
  it('adds only native logging for the private test without changing UI or process ownership', async () => {
    const processHandle = createProcessHandle();
    const spawnProcess = vi.fn(() => processHandle);
    const testLogPath = 'C:\\Temp\\proof\\target-installer.private.log';
    const promise = launchWindowsInstallerForUpdate({
      packagePath: 'C:\\Temp\\candidate.msi', systemRoot: 'C:\\Windows', testLogPath,
    }, spawnProcess as never);
    processHandle.emit('spawn');
    await promise;
    expect(spawnProcess).toHaveBeenCalledWith('C:\\Windows\\System32\\msiexec.exe',
      ['/i', 'C:\\Temp\\candidate.msi', '/norestart', '/L*v', testLogPath],
      { detached: true, shell: false, stdio: 'ignore', windowsHide: false });
    expect(processHandle.unref).toHaveBeenCalledOnce();
    for (const path of ['relative.private.log', 'C:\\Temp\\..\\target.private.log',
      'C:\\Temp\\target.txt', 'C:\\Temp\\target.private.log\0']) {
      spawnProcess.mockClear();
      await expect(launchWindowsInstallerForUpdate({ packagePath: 'C:\\Temp\\candidate.msi',
        systemRoot: 'C:\\Windows', testLogPath: path }, spawnProcess as never)).rejects.toThrow(WindowsInstallerHandoffError);
      expect(spawnProcess).not.toHaveBeenCalled();
    }
  });

  it('uses only the fixed Windows executable and fixed MSI arguments', async () => {
    const processHandle = createProcessHandle();
    const spawnProcess = vi.fn(() => processHandle);
    const result = launchWindowsInstallerForUpdate(
      {
        packagePath: 'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\candidate\\Eky-0.2.0-x64.msi',
        systemRoot: 'C:\\Windows',
      },
      spawnProcess as never,
    );
    processHandle.emit('spawn');
    await result;

    expect(spawnProcess).toHaveBeenCalledWith(
      win32.join('C:\\Windows', 'System32', 'msiexec.exe'),
      [
        '/i',
        'C:\\Users\\Example\\AppData\\Roaming\\Eky\\update-cache\\candidate\\Eky-0.2.0-x64.msi',
        '/norestart',
      ],
      {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    expect(processHandle.unref).toHaveBeenCalledOnce();
  });

  it('rejects missing roots, non-MSI paths and spawn failures', async () => {
    expect(() => resolveWindowsInstallerExecutable(undefined)).toThrow(
      WindowsInstallerHandoffError,
    );
    expect(() =>
      resolveWindowsInstallerExecutable('C:\\Windows\\..\\Windows'),
    ).toThrow(WindowsInstallerHandoffError);
    await expect(
      launchWindowsInstallerForUpdate(
        {
          packagePath: 'C:\\Temp\\candidate.txt',
          systemRoot: 'C:\\Windows',
        },
        vi.fn() as never,
      ),
    ).rejects.toThrow(WindowsInstallerHandoffError);

    const processHandle = createProcessHandle();
    const result = launchWindowsInstallerForUpdate(
      {
        packagePath: 'C:\\Temp\\candidate.msi',
        systemRoot: 'C:\\Windows',
      },
      vi.fn(() => processHandle) as never,
    );
    const rejection = expect(result).rejects.toThrow(
      WindowsInstallerHandoffError,
    );
    processHandle.emit('error', new Error('synthetic failure'));
    await rejection;
  });
});

function createProcessHandle() {
  const processHandle = new EventEmitter() as EventEmitter & {
    unref: ReturnType<typeof vi.fn>;
  };
  processHandle.unref = vi.fn();
  return processHandle;
}
