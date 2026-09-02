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

  await waitForManagedProcessExit(child, timeoutMilliseconds);
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
    await waitForManagedProcessExit(child, timeoutMilliseconds);
  }
  if (!hasExited(child)) {
    throw new Error('E2E_MANAGED_PROCESS_TREE_STOP_TIMEOUT');
  }
}

export function waitForManagedProcessExit(
  child: ManagedChildProcess,
  timeoutMilliseconds: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error('E2E_MANAGED_PROCESS_EXIT_WAIT_INPUT_INVALID');
  }
  if (hasExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    let terminal = false;
    let timer: NodeJS.Timeout | undefined;
    const complete = (exited: boolean) => {
      if (terminal) {
        return;
      }
      terminal = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      child.removeListener('exit', onExit);
      resolveExit(exited);
    };
    const onExit = () => complete(true);
    timer = setTimeout(
      () => complete(hasExited(child)),
      timeoutMilliseconds,
    );
    child.once('exit', onExit);
    if (hasExited(child)) {
      complete(true);
    }
  });
}

function hasExited(child: ManagedChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
