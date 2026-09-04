const FAILURE_CODES = new Set([
  'cleanInstallFailed',
  'cleanInstalledStateInvalid',
  'cleanLifecyclePreconditionFailed',
  'cleanUninstallFailed',
  'cleanUninstalledStateInvalid',
  'fixtureVerificationFailed',
  'installerStateInspectionFailed',
  'unexpectedFailure',
]);
const PROGRESS_OPERATION = 'cleanInstallUninstallLifecycle';

class CleanLifecycleFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new CleanLifecycleFailure(code);
}

function isAbsentState(state) {
  return (
    state.productState >= 1 ||
    state.productName !== null ||
    state.productVersion !== null ||
    state.localPackagePresent ||
    state.ownedRegistryExists ||
    state.installRootExists ||
    state.executableExists ||
    state.shortcutExists ||
    state.ekyProcessCount !== 0
  ) === false;
}

function requireAbsentState(state, errorCode) {
  if (!isAbsentState(state)) {
    fail(errorCode);
  }
}

function requireInstalledState(state, expectedVersion) {
  if (
    state.productState < 1 ||
    state.productName !== 'Eky' ||
    state.productVersion !== expectedVersion ||
    !state.localPackagePresent ||
    !state.ownedRegistryExists ||
    !state.installRootExists ||
    !state.executableExists ||
    !state.shortcutExists ||
    state.ekyProcessCount !== 0
  ) {
    fail('cleanInstalledStateInvalid');
  }
}

function errorCodeOf(error) {
  return error instanceof CleanLifecycleFailure && FAILURE_CODES.has(error.code)
    ? error.code
    : 'unexpectedFailure';
}

function createProgressObserver(reportProgress) {
  const lifecycleStartedAt = performance.now();

  function emit(phase, status, phaseStartedAt, details) {
    if (typeof reportProgress !== 'function') {
      return;
    }
    const now = performance.now();
    try {
      reportProgress(
        Object.freeze({
          schemaVersion: 1,
          operation: PROGRESS_OPERATION,
          scenario: 'cleanInstallUninstall',
          phase,
          status,
          durationMs:
            status === 'started' ? 0 : Math.max(0, Math.round(now - phaseStartedAt)),
          elapsedMs: Math.max(0, Math.round(now - lifecycleStartedAt)),
          ...details,
        }),
      );
    } catch {
      // Progress is best-effort evidence and never controls the lifecycle.
    }
  }

  async function step(phase, completedResultCode, dependencyFailureCode, task) {
    const phaseStartedAt = performance.now();
    emit(phase, 'started', phaseStartedAt, { resultCode: 'started' });
    try {
      const value = await task();
      emit(phase, 'completed', phaseStartedAt, {
        resultCode: completedResultCode,
      });
      return value;
    } catch (error) {
      const knownCode = errorCodeOf(error);
      const errorCode =
        knownCode === 'unexpectedFailure' ? dependencyFailureCode : knownCode;
      emit(phase, 'failed', phaseStartedAt, { errorCode });
      if (knownCode === 'unexpectedFailure') {
        fail(dependencyFailureCode);
      }
      throw error;
    }
  }

  return Object.freeze({
    completed() {
      emit('lifecycle', 'completed', lifecycleStartedAt, {
        resultCode: 'cleanInstallUninstallCompleted',
      });
    },
    failed(errorCode) {
      emit('lifecycle', 'failed', lifecycleStartedAt, { errorCode });
    },
    started() {
      emit('lifecycle', 'started', lifecycleStartedAt, {
        resultCode: 'started',
      });
    },
    step,
  });
}

export async function executeCleanInstallUninstallLifecycle({
  expectedVersion,
  inspectState,
  reportProgress,
  runMsiOperation,
  verifyFixture,
}) {
  let installAttempted = false;
  let installExitCode = null;
  let installedStateValidated = false;
  let uninstallExitCode = null;
  let uninstalledStateValidated = false;
  const progress = createProgressObserver(reportProgress);
  progress.started();

  try {
    await progress.step(
      'preflight',
      'preflightValidated',
      'installerStateInspectionFailed',
      async () =>
        requireAbsentState(
          await inspectState('preflight'),
          'cleanLifecyclePreconditionFailed',
        ),
    );
    await progress.step(
      'fixtureBeforeInstall',
      'fixtureValidated',
      'fixtureVerificationFailed',
      verifyFixture,
    );

    installAttempted = true;
    installExitCode = await progress.step(
      'install',
      'installCompleted',
      'cleanInstallFailed',
      async () => {
        const exitCode = await runMsiOperation('install');
        if (exitCode !== 0) {
          fail('cleanInstallFailed');
        }
        return exitCode;
      },
    );
    await progress.step(
      'installedPostcondition',
      'installedStateValidated',
      'installerStateInspectionFailed',
      async () =>
        requireInstalledState(
          await inspectState('installed'),
          expectedVersion,
        ),
    );
    installedStateValidated = true;
    await progress.step(
      'fixtureAfterInstall',
      'fixtureValidated',
      'fixtureVerificationFailed',
      verifyFixture,
    );

    uninstallExitCode = await progress.step(
      'uninstall',
      'uninstallCompleted',
      'cleanUninstallFailed',
      async () => {
        const exitCode = await runMsiOperation('uninstall');
        if (exitCode !== 0) {
          fail('cleanUninstallFailed');
        }
        return exitCode;
      },
    );
    await progress.step(
      'uninstalledPostcondition',
      'uninstalledStateValidated',
      'installerStateInspectionFailed',
      async () =>
        requireAbsentState(
          await inspectState('uninstalled'),
          'cleanUninstalledStateInvalid',
        ),
    );
    uninstalledStateValidated = true;
    await progress.step(
      'fixtureAfterUninstall',
      'fixtureValidated',
      'fixtureVerificationFailed',
      verifyFixture,
    );
    progress.completed();

    return Object.freeze({
      schemaVersion: 1,
      status: 'completed',
      resultCode: 'cleanInstallUninstallCompleted',
      errorCode: null,
      cleanupResultCode: 'notRequired',
      installExitCode,
      uninstallExitCode,
      installedStateValidated,
      uninstalledStateValidated,
    });
  } catch (error) {
    const errorCode = errorCodeOf(error);
    let cleanupResultCode = 'notRequired';

    if (installAttempted) {
      try {
        const state = await progress.step(
          'cleanupInspection',
          'cleanupStateInspected',
          'installerStateInspectionFailed',
          () => inspectState('failure'),
        );
        if (!isAbsentState(state)) {
          cleanupResultCode = 'cleanupFailed';
          await progress.step(
            'cleanupUninstall',
            'cleanupUninstallCompleted',
            'cleanUninstallFailed',
            async () => {
              const cleanupExitCode = await runMsiOperation('cleanup');
              if (cleanupExitCode !== 0) {
                fail('cleanUninstallFailed');
              }
            },
          );
          await progress.step(
            'cleanupPostcondition',
            'cleanupStateValidated',
            'installerStateInspectionFailed',
            async () =>
              requireAbsentState(
                await inspectState('cleanup'),
                'cleanUninstalledStateInvalid',
              ),
          );
          cleanupResultCode = 'cleanupCompleted';
          uninstalledStateValidated = true;
        } else {
          uninstalledStateValidated = true;
        }
      } catch {
        cleanupResultCode = 'cleanupFailed';
      }
    }
    progress.failed(errorCode);

    return Object.freeze({
      schemaVersion: 1,
      status: 'failed',
      resultCode: 'cleanInstallUninstallFailed',
      errorCode,
      cleanupResultCode,
      installExitCode,
      uninstallExitCode,
      installedStateValidated,
      uninstalledStateValidated,
    });
  }
}
