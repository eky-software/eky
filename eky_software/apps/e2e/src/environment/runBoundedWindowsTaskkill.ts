import { spawn, type ChildProcess } from 'node:child_process';

type TaskkillLauncher = (processId: number) => ChildProcess;

export async function runBoundedWindowsTaskkill(
  processId: number,
  timeoutMilliseconds: number,
  launch: TaskkillLauncher = launchTaskkill,
): Promise<void> {
  if (
    !Number.isSafeInteger(processId) ||
    processId < 1 ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1
  ) {
    throw new Error('E2E_MANAGED_PROCESS_TREE_STOP_INPUT_INVALID');
  }
  let taskkill: ChildProcess;
  try {
    taskkill = launch(processId);
  } catch {
    throw new Error('E2E_MANAGED_PROCESS_TREE_TASKKILL_FAILED');
  }

  await new Promise<void>((resolveExit, rejectExit) => {
    let terminal = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (action: () => void) => {
      if (terminal) {
        return;
      }
      terminal = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      taskkill.removeListener('error', onError);
      taskkill.removeListener('exit', onExit);
      action();
    };
    const onError = () => {
      settle(() =>
        rejectExit(new Error('E2E_MANAGED_PROCESS_TREE_TASKKILL_FAILED')),
      );
    };
    const onExit = () => settle(resolveExit);
    timer = setTimeout(() => {
      try {
        taskkill.kill('SIGKILL');
      } catch {
        // The bounded failure below remains authoritative.
      }
      settle(() =>
        rejectExit(new Error('E2E_MANAGED_PROCESS_TREE_TASKKILL_TIMEOUT')),
      );
    }, timeoutMilliseconds);
    taskkill.once('error', onError);
    taskkill.once('exit', onExit);
  });
}

function launchTaskkill(processId: number): ChildProcess {
  return spawn('taskkill', ['/pid', String(processId), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}
