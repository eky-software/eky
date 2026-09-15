const ROLLBACK_EXIT_FAILURE_CODES = Object.freeze({
  20: 'binaryRollbackTargetUninstallFailed',
  21: 'binaryRollbackSourceInstallFailedTargetRestored',
  22: 'binaryRollbackSourceInstallAndTargetRepairFailed',
  23: 'binaryRollbackUnexpectedFailure',
  24: 'binaryRollbackMsiExecPathInvalid',
  25: 'binaryRollbackTargetPackagePathInvalid',
  26: 'binaryRollbackSourcePackagePathInvalid',
  27: 'binaryRollbackLauncherWaitFailed',
});

function requireProcessResult(result, errorCode) {
  if (
    result === null ||
    typeof result !== 'object' ||
    !Number.isInteger(result.exitCode) ||
    !Number.isInteger(result.processId)
  ) {
    throw new Error(errorCode);
  }
  return result;
}

function rollbackFailureCode(exitCode) {
  return (
    ROLLBACK_EXIT_FAILURE_CODES[exitCode] ?? 'binaryRollbackProcessFailed'
  );
}

export async function coordinateUpgradeRollbackBinaryHandoff({
  createProgressWaiter,
  startLauncher,
  startRollback,
}) {
  let launcher = null;
  let launcherReleased = false;
  let progressWaiter = null;
  let rollback = null;

  async function releaseLauncher() {
    if (launcher === null || launcherReleased) {
      return;
    }
    launcherReleased = true;
    await launcher.release();
  }

  try {
    launcher = await startLauncher();
    if (
      launcher === null ||
      typeof launcher !== 'object' ||
      !Number.isInteger(launcher.processId) ||
      launcher.processId < 1 ||
      typeof launcher.release !== 'function' ||
      !(launcher.completion instanceof Promise)
    ) {
      throw new Error('binaryRollbackLauncherFailed');
    }
    progressWaiter = createProgressWaiter();
    if (
      progressWaiter === null ||
      typeof progressWaiter !== 'object' ||
      typeof progressWaiter.close !== 'function' ||
      !(progressWaiter.completion instanceof Promise)
    ) {
      throw new Error('binaryRollbackProgressInvalid');
    }
    rollback = await startRollback(launcher.processId);
    if (
      rollback === null ||
      typeof rollback !== 'object' ||
      !(rollback.completion instanceof Promise)
    ) {
      throw new Error('binaryRollbackProcessFailed');
    }

    const first = await Promise.race([
      progressWaiter.completion.then(
        () => ({ kind: 'launcherExitWaitStarted' }),
        () => ({ kind: 'progressFailed' }),
      ),
      launcher.completion.then(
        (result) => ({ kind: 'launcherExited', result }),
        () => ({ kind: 'launcherFailed' }),
      ),
      rollback.completion.then(
        (result) => ({ kind: 'rollbackExited', result }),
        () => ({ kind: 'rollbackFailed' }),
      ),
    ]);

    if (first.kind === 'launcherExitWaitStarted') {
      await releaseLauncher();
      const launcherResult = requireProcessResult(
        await launcher.completion,
        'binaryRollbackLauncherFailed',
      );
      if (launcherResult.exitCode !== 0) {
        throw new Error('binaryRollbackLauncherFailed');
      }
      const rollbackResult = requireProcessResult(
        await rollback.completion,
        'binaryRollbackProcessFailed',
      );
      if (rollbackResult.exitCode !== 0) {
        throw new Error(rollbackFailureCode(rollbackResult.exitCode));
      }
      return 0;
    }

    await releaseLauncher().catch(() => undefined);
    await launcher.completion.catch(() => undefined);
    if (first.kind === 'rollbackExited') {
      const rollbackResult = requireProcessResult(
        first.result,
        'binaryRollbackProcessFailed',
      );
      if (rollbackResult.exitCode !== 0) {
        throw new Error(rollbackFailureCode(rollbackResult.exitCode));
      }
      throw new Error('binaryRollbackProgressInvalid');
    }
    if (first.kind === 'launcherExited' || first.kind === 'launcherFailed') {
      await rollback.completion.catch(() => undefined);
      throw new Error('binaryRollbackLauncherExitedEarly');
    }
    if (first.kind === 'progressFailed') {
      await rollback.completion.catch(() => undefined);
      throw new Error('binaryRollbackProgressInvalid');
    }
    await rollback.completion.catch(() => undefined);
    throw new Error('binaryRollbackProcessFailed');
  } finally {
    if (typeof progressWaiter?.close === 'function') {
      try {
        progressWaiter.close();
      } catch {
        // Closing test observability cannot replace the lifecycle result.
      }
    }
    await releaseLauncher().catch(() => undefined);
    if (launcher?.completion instanceof Promise) {
      await launcher.completion.catch(() => undefined);
    }
  }
}
