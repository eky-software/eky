import { runBoundedWindowsTaskkill } from './runBoundedWindowsTaskkill.js';
import type { ManagedChildProcess } from './startManagedProcess.js';

export async function stopManagedProcessTree(
  child: ManagedChildProcess,
  timeoutMilliseconds = 3_000,
): Promise<void> {
  if (hasExited(child) || child.pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    await runBoundedWindowsTaskkill(child.pid, timeoutMilliseconds);
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
  if (!hasExited(child)) {
    throw new Error('E2E_MANAGED_PROCESS_TREE_STOP_TIMEOUT');
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
    let terminal = false;
    const complete = () => {
      if (terminal) {
        return;
      }
      terminal = true;
      clearTimeout(timer);
      child.removeListener('exit', complete);
      resolveExit();
    };
    const timer = setTimeout(complete, timeoutMilliseconds);
    child.once('exit', complete);
  });
}

function hasExited(child: ManagedChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
