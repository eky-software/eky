import { spawnSync } from 'node:child_process';

import type { ManagedChildProcess } from './startManagedProcess.js';

export async function stopManagedProcessTree(
  child: ManagedChildProcess,
  timeoutMilliseconds = 3_000,
): Promise<void> {
  if (hasExited(child) || child.pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync(
      'taskkill',
      ['/pid', String(child.pid), '/t', '/f'],
      { stdio: 'ignore', windowsHide: true },
    );
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }

  await waitForExit(child, timeoutMilliseconds);
  if (!hasExited(child)) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
    await waitForExit(child, timeoutMilliseconds);
  }
}

function waitForExit(
  child: ManagedChildProcess,
  timeoutMilliseconds: number,
): Promise<void> {
  if (hasExited(child)) {
    return Promise.resolve();
  }

  return new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, timeoutMilliseconds);
    child.on('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

function hasExited(child: ManagedChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
