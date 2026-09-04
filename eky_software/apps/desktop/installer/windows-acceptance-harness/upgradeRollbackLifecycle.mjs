const FAILURE_CODES = new Set([
  'artifactVerificationFailed',
  'binaryRollbackFailed',
  'binaryRollbackLauncherExitedEarly',
  'binaryRollbackLauncherFailed',
  'binaryRollbackLauncherWaitFailed',
  'binaryRollbackMsiExecPathInvalid',
  'binaryRollbackProcessFailed',
  'binaryRollbackProgressInvalid',
  'binaryRollbackSourceInstallAndTargetRepairFailed',
  'binaryRollbackSourceInstallFailedTargetRestored',
  'binaryRollbackSourcePackagePathInvalid',
  'binaryRollbackStateInvalid',
  'binaryRollbackTargetPackagePathInvalid',
  'binaryRollbackTargetUninstallFailed',
  'binaryRollbackUnexpectedFailure',
  'downgradeAccepted',
  'downgradeStateInvalid',
  'finalUninstallFailed',
  'finalUninstalledStateInvalid',
  'installerStateInspectionFailed',
  'majorUpgradeFailed',
  'majorUpgradeStateInvalid',
  'rollbackBlockerFailed',
  'sourceInstallFailed',
  'sourceInstalledStateInvalid',
  'unexpectedFailure',
  'upgradeLifecyclePreconditionFailed',
  'windowsInstallerRollbackFailed',
  'windowsInstallerRollbackStateInvalid',
]);
const PROGRESS_OPERATION = 'upgradeRollbackLifecycle';

class UpgradeRollbackFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new UpgradeRollbackFailure(code);
}

function exactProductPresent(product) {
  return (
    product.productState >= 1 ||
    product.productName !== null ||
    product.productVersion !== null ||
    product.localPackagePresent
  );
}

function requireProductAbsent(product, errorCode) {
  if (exactProductPresent(product)) {
    fail(errorCode);
  }
}

function requireProductInstalled(product, expectedVersion, errorCode) {
  if (
    product.productState < 1 ||
    product.productName !== 'Eky' ||
    product.productVersion !== expectedVersion ||
    !product.localPackagePresent ||
    !product.ownedRegistryExists
  ) {
    fail(errorCode);
  }
}

function requireInstalledFootprint(state, errorCode) {
  if (
    !state.installRootExists ||
    !state.executableExists ||
    !state.shortcutExists ||
    !state.installerRegistryExists ||
    state.ekyProcessCount !== 0
  ) {
    fail(errorCode);
  }
}

function requireAbsentFootprint(state, errorCode) {
  if (
    state.installRootExists ||
    state.executableExists ||
    state.shortcutExists ||
    state.installerRegistryExists ||
    state.ekyProcessCount !== 0 ||
    state.rollbackBlockerKind !== 'absent'
  ) {
    fail(errorCode);
  }
}

function requireSourceInstalled(state, versions, errorCode) {
  requireProductInstalled(state.source, versions.source, errorCode);
  requireProductAbsent(state.target, errorCode);
  requireInstalledFootprint(state, errorCode);
}

function requireTargetInstalled(state, versions, errorCode) {
  requireProductAbsent(state.source, errorCode);
  requireProductInstalled(state.target, versions.target, errorCode);
  requireInstalledFootprint(state, errorCode);
}

function requireAllAbsent(state, errorCode) {
  requireProductAbsent(state.source, errorCode);
  requireProductAbsent(state.target, errorCode);
  requireAbsentFootprint(state, errorCode);
}

function errorCodeOf(error) {
  const code =
    error instanceof UpgradeRollbackFailure ? error.code : error?.message;
  return typeof code === 'string' && FAILURE_CODES.has(code)
    ? code
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
          scenario: 'upgradeRollback',
          phase,
          status,
          durationMs:
            status === 'started' ? 0 : Math.max(0, Math.round(now - phaseStartedAt)),
          elapsedMs: Math.max(0, Math.round(now - lifecycleStartedAt)),
          ...details,
        }),
      );
    } catch {
      // Evidence is best effort and never controls the lifecycle result.
    }
  }

  async function step(phase, completedResultCode, dependencyFailureCode, task) {
    const startedAt = performance.now();
    emit(phase, 'started', startedAt, { resultCode: 'started' });
    try {
      const value = await task();
      emit(phase, 'completed', startedAt, {
        resultCode: completedResultCode,
      });
      return value;
    } catch (error) {
      const known = errorCodeOf(error);
      const errorCode = known === 'unexpectedFailure' ? dependencyFailureCode : known;
      emit(phase, 'failed', startedAt, { errorCode });
      if (known === 'unexpectedFailure') {
        fail(dependencyFailureCode);
      }
      throw error;
    }
  }

  return Object.freeze({ emit, lifecycleStartedAt, step });
}

function initialResult() {
  return {
    schemaVersion: 1,
    status: 'failed',
    resultCode: 'upgradeRollbackFailed',
    errorCode: 'unexpectedFailure',
    cleanupResultCode: 'notRequired',
    sourceInstallExitCode: null,
    upgradeExitCode: null,
    downgradeExitCode: null,
    binaryRollbackExitCode: null,
    windowsInstallerRollbackExitCode: null,
    finalUninstallExitCode: null,
    sourceInstalledStateValidated: false,
    majorUpgradeValidated: false,
    downgradeRejected: false,
    binaryRollbackRestoredSource: false,
    windowsInstallerRollbackRestoredSource: false,
    finalStateValidated: false,
    artifactBytesValidated: false,
  };
}

async function attemptFailureCleanup({ inspectState, progress, removeRollbackBlocker, runMsiOperation }) {
  let cleanupNeeded = false;
  let cleanupFailed = false;
  try {
    await progress.step(
      'cleanupRollbackBlocker',
      'rollbackBlockerRemoved',
      'rollbackBlockerFailed',
      removeRollbackBlocker,
    );
  } catch {
    cleanupFailed = true;
  }

  let state;
  try {
    state = await progress.step(
      'cleanupInspection',
      'cleanupStateInspected',
      'installerStateInspectionFailed',
      () => inspectState('failure'),
    );
    cleanupNeeded =
      exactProductPresent(state.source) || exactProductPresent(state.target);
  } catch {
    return 'cleanupFailed';
  }

  for (const [role, operation] of [
    ['target', 'cleanupTarget'],
    ['source', 'cleanupSource'],
  ]) {
    if (!exactProductPresent(state[role])) {
      continue;
    }
    try {
      await progress.step(
        operation,
        'cleanupUninstallCompleted',
        'finalUninstallFailed',
        async () => {
          const exitCode = await runMsiOperation(operation);
          if (exitCode !== 0) {
            fail('finalUninstallFailed');
          }
        },
      );
      state = await inspectState(`${operation}Postcondition`);
    } catch {
      cleanupFailed = true;
    }
  }

  try {
    requireAllAbsent(
      await progress.step(
        'cleanupPostcondition',
        'cleanupStateValidated',
        'installerStateInspectionFailed',
        () => inspectState('cleanup'),
      ),
      'finalUninstalledStateInvalid',
    );
  } catch {
    cleanupFailed = true;
  }
  return cleanupFailed
    ? 'cleanupFailed'
    : cleanupNeeded
      ? 'cleanupCompleted'
      : 'notRequired';
}

export async function executeUpgradeRollbackLifecycle({
  inspectState,
  invokeBinaryRollback,
  reportProgress,
  removeRollbackBlocker,
  runMsiOperation,
  createRollbackBlocker,
  verifyArtifact,
  versions,
}) {
  const result = initialResult();
  const progress = createProgressObserver(reportProgress);
  progress.emit('lifecycle', 'started', progress.lifecycleStartedAt, {
    resultCode: 'started',
  });
  let installationAttempted = false;

  try {
    requireAllAbsent(
      await progress.step(
        'preflight',
        'preflightValidated',
        'installerStateInspectionFailed',
        () => inspectState('preflight'),
      ),
      'upgradeLifecyclePreconditionFailed',
    );
    await progress.step(
      'artifactBeforeInstall',
      'artifactValidated',
      'artifactVerificationFailed',
      verifyArtifact,
    );

    installationAttempted = true;
    result.sourceInstallExitCode = await progress.step(
      'sourceInstall',
      'sourceInstalled',
      'sourceInstallFailed',
      async () => {
        const exitCode = await runMsiOperation('sourceInstall');
        if (exitCode !== 0) {
          fail('sourceInstallFailed');
        }
        return exitCode;
      },
    );
    requireSourceInstalled(
      await progress.step(
        'sourcePostcondition',
        'sourceStateValidated',
        'installerStateInspectionFailed',
        () => inspectState('sourceInstalled'),
      ),
      versions,
      'sourceInstalledStateInvalid',
    );
    result.sourceInstalledStateValidated = true;

    result.upgradeExitCode = await progress.step(
      'majorUpgrade',
      'majorUpgradeCompleted',
      'majorUpgradeFailed',
      async () => {
        const exitCode = await runMsiOperation('majorUpgrade');
        if (exitCode !== 0) {
          fail('majorUpgradeFailed');
        }
        return exitCode;
      },
    );
    requireTargetInstalled(
      await progress.step(
        'majorUpgradePostcondition',
        'targetStateValidated',
        'installerStateInspectionFailed',
        () => inspectState('targetInstalled'),
      ),
      versions,
      'majorUpgradeStateInvalid',
    );
    result.majorUpgradeValidated = true;
    await progress.step(
      'artifactAfterUpgrade',
      'artifactValidated',
      'artifactVerificationFailed',
      verifyArtifact,
    );

    result.downgradeExitCode = await progress.step(
      'downgradeRejection',
      'downgradeRejected',
      'downgradeAccepted',
      async () => {
        const exitCode = await runMsiOperation('downgrade');
        if (exitCode === 0 || [1641, 3010].includes(exitCode)) {
          fail('downgradeAccepted');
        }
        return exitCode;
      },
    );
    requireTargetInstalled(
      await progress.step(
        'downgradePostcondition',
        'targetStatePreserved',
        'installerStateInspectionFailed',
        () => inspectState('downgradeRejected'),
      ),
      versions,
      'downgradeStateInvalid',
    );
    result.downgradeRejected = true;

    result.binaryRollbackExitCode = await progress.step(
      'binaryRollback',
      'binaryRollbackCompleted',
      'binaryRollbackFailed',
      async () => {
        const exitCode = await invokeBinaryRollback();
        if (exitCode !== 0) {
          fail('binaryRollbackFailed');
        }
        return exitCode;
      },
    );
    requireSourceInstalled(
      await progress.step(
        'binaryRollbackPostcondition',
        'sourceStateRestored',
        'installerStateInspectionFailed',
        () => inspectState('binaryRollback'),
      ),
      versions,
      'binaryRollbackStateInvalid',
    );
    result.binaryRollbackRestoredSource = true;
    await progress.step(
      'artifactAfterBinaryRollback',
      'artifactValidated',
      'artifactVerificationFailed',
      verifyArtifact,
    );

    await progress.step(
      'rollbackBlockerCreate',
      'rollbackBlockerCreated',
      'rollbackBlockerFailed',
      createRollbackBlocker,
    );
    result.windowsInstallerRollbackExitCode = await progress.step(
      'windowsInstallerRollback',
      'windowsInstallerRollbackObserved',
      'windowsInstallerRollbackFailed',
      async () => {
        const exitCode = await runMsiOperation('windowsInstallerRollback');
        if (exitCode === 0 || [1641, 3010].includes(exitCode)) {
          fail('windowsInstallerRollbackFailed');
        }
        return exitCode;
      },
    );
    const rollbackState = await progress.step(
      'windowsInstallerRollbackPostcondition',
      'sourceStatePreserved',
      'installerStateInspectionFailed',
      () => inspectState('windowsInstallerRollback'),
    );
    requireSourceInstalled(
      rollbackState,
      versions,
      'windowsInstallerRollbackStateInvalid',
    );
    if (rollbackState.rollbackBlockerKind !== 'file') {
      fail('windowsInstallerRollbackStateInvalid');
    }
    await progress.step(
      'rollbackBlockerRemove',
      'rollbackBlockerRemoved',
      'rollbackBlockerFailed',
      removeRollbackBlocker,
    );
    const blockerRemovedState = await inspectState(
      'windowsInstallerRollbackBlockerRemoved',
    );
    requireSourceInstalled(
      blockerRemovedState,
      versions,
      'windowsInstallerRollbackStateInvalid',
    );
    if (blockerRemovedState.rollbackBlockerKind !== 'absent') {
      fail('windowsInstallerRollbackStateInvalid');
    }
    result.windowsInstallerRollbackRestoredSource = true;
    await progress.step(
      'artifactAfterWindowsRollback',
      'artifactValidated',
      'artifactVerificationFailed',
      verifyArtifact,
    );

    result.finalUninstallExitCode = await progress.step(
      'finalUninstall',
      'finalUninstallCompleted',
      'finalUninstallFailed',
      async () => {
        const exitCode = await runMsiOperation('finalUninstall');
        if (exitCode !== 0) {
          fail('finalUninstallFailed');
        }
        return exitCode;
      },
    );
    requireAllAbsent(
      await progress.step(
        'finalPostcondition',
        'finalStateValidated',
        'installerStateInspectionFailed',
        () => inspectState('final'),
      ),
      'finalUninstalledStateInvalid',
    );
    result.finalStateValidated = true;
    await progress.step(
      'artifactFinal',
      'artifactValidated',
      'artifactVerificationFailed',
      verifyArtifact,
    );
    result.artifactBytesValidated = true;
    result.status = 'completed';
    result.resultCode = 'upgradeRollbackCompleted';
    result.errorCode = null;
    progress.emit('lifecycle', 'completed', progress.lifecycleStartedAt, {
      resultCode: 'upgradeRollbackCompleted',
    });
    return Object.freeze(result);
  } catch (error) {
    result.errorCode = errorCodeOf(error);
    if (installationAttempted) {
      result.cleanupResultCode = await attemptFailureCleanup({
        inspectState,
        progress,
        removeRollbackBlocker,
        runMsiOperation,
      });
    }
    progress.emit('lifecycle', 'failed', progress.lifecycleStartedAt, {
      errorCode: result.errorCode,
    });
    return Object.freeze(result);
  }
}
