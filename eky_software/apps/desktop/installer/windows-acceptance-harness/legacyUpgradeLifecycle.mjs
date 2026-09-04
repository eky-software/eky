const FAILURE_CODES = new Set([
  'artifactVerificationFailed',
  'installerFootprintInspectionFailed',
  'installerSourceProductInspectionFailed',
  'installerStateInspectionFailed',
  'installerStateSnapshotChanged',
  'installerTargetProductInspectionFailed',
  'legacyBusinessFixtureInvalid',
  'majorUpgradeFailed',
  'majorUpgradeStateInvalid',
  'sourceInstallFailed',
  'sourceNormalStartupFailed',
  'sourcePackagedSmokeFailed',
  'sourceStateInvalid',
  'targetFirstStartupFailed',
  'targetSecondStartupFailed',
  'unexpectedFailure',
  'upgradeLifecyclePreconditionFailed',
]);

class LegacyUpgradeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new LegacyUpgradeFailure(code);
}

function exactProductPresent(product) {
  return (
    product.productState >= 1 ||
    product.productName !== null ||
    product.productVersion !== null ||
    product.localPackagePresent
  );
}

function requireAbsent(state, code) {
  if (
    exactProductPresent(state.source) ||
    exactProductPresent(state.target) ||
    state.installRootExists ||
    state.executableExists ||
    state.shortcutExists ||
    state.installerRegistryExists ||
    state.ekyProcessCount !== 0
  ) {
    fail(code);
  }
}

function requireInstalledProduct(product, version, code) {
  if (
    product.productState < 1 ||
    product.productName !== 'Eky' ||
    product.productVersion !== version ||
    !product.localPackagePresent ||
    !product.ownedRegistryExists
  ) {
    fail(code);
  }
}

function requireSourceInstalled(state, versions) {
  requireInstalledProduct(state.source, versions.source, 'sourceStateInvalid');
  if (
    exactProductPresent(state.target) ||
    !state.installRootExists ||
    !state.executableExists ||
    !state.shortcutExists ||
    !state.installerRegistryExists ||
    state.ekyProcessCount !== 0
  ) {
    fail('sourceStateInvalid');
  }
}

function requireTargetInstalled(state, versions) {
  requireInstalledProduct(state.target, versions.target, 'majorUpgradeStateInvalid');
  if (
    exactProductPresent(state.source) ||
    !state.installRootExists ||
    !state.executableExists ||
    !state.shortcutExists ||
    !state.installerRegistryExists ||
    state.ekyProcessCount !== 0
  ) {
    fail('majorUpgradeStateInvalid');
  }
}

function errorCodeOf(error) {
  const code = error instanceof LegacyUpgradeFailure ? error.code : error?.message;
  return typeof code === 'string' && FAILURE_CODES.has(code)
    ? code
    : 'unexpectedFailure';
}

function initialResult() {
  return {
    schemaVersion: 1,
    status: 'failed',
    resultCode: 'historicalLegacyUpgradeFailed',
    errorCode: 'unexpectedFailure',
    sourceInstallExitCode: null,
    upgradeExitCode: null,
    sourceStateValidated: false,
    sourceNormalStartupValidated: false,
    sourcePackagedSmokeValidated: false,
    legacyBusinessFixtureValidated: false,
    majorUpgradeValidated: false,
    targetFirstStartupValidated: false,
    targetSecondStartupValidated: false,
    artifactBytesValidated: false,
  };
}

function createProgress(reportProgress) {
  const startedAt = performance.now();
  function emit(phase, status, phaseStartedAt, details = {}) {
    try {
      reportProgress?.(
        Object.freeze({
          schemaVersion: 1,
          operation: 'historicalLegacyUpgradeLifecycle',
          scenario: 'historicalLegacyUpgrade',
          phase,
          status,
          durationMs:
            status === 'started'
              ? 0
              : Math.max(0, Math.round(performance.now() - phaseStartedAt)),
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...details,
        }),
      );
    } catch {
      // Safe progress is evidence only and cannot change terminal semantics.
    }
  }
  async function step(phase, completedCode, failureCode, task) {
    const phaseStartedAt = performance.now();
    emit(phase, 'started', phaseStartedAt, { resultCode: 'started' });
    try {
      const value = await task();
      emit(phase, 'completed', phaseStartedAt, { resultCode: completedCode });
      return value;
    } catch (error) {
      const known = errorCodeOf(error);
      const errorCode = known === 'unexpectedFailure' ? failureCode : known;
      emit(phase, 'failed', phaseStartedAt, { errorCode });
      fail(errorCode);
    }
  }
  return Object.freeze({ emit, startedAt, step });
}

export async function executeLegacyUpgradeLifecycle({
  captureSourceEvidence,
  inspectState,
  reportProgress,
  runMsiOperation,
  runSourceStartup,
  runSourcePackagedSmoke,
  runTargetStartup,
  validateTargetPayload,
  verifyArtifact,
  versions,
}) {
  const result = initialResult();
  const progress = createProgress(reportProgress);
  progress.emit('lifecycle', 'started', progress.startedAt, {
    resultCode: 'started',
  });
  try {
    requireAbsent(
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
    result.sourceInstallExitCode = await progress.step(
      'sourceInstall',
      'sourceInstalled',
      'sourceInstallFailed',
      async () => {
        const exitCode = await runMsiOperation('sourceInstall');
        if (exitCode !== 0) fail('sourceInstallFailed');
        return exitCode;
      },
    );
    requireSourceInstalled(
      await progress.step(
        'sourcePostcondition',
        'sourceStateValidated',
        'installerStateInspectionFailed',
        () => inspectState('source'),
      ),
      versions,
    );
    result.sourceStateValidated = true;
    await progress.step(
      'sourcePackagedSmoke',
      'sourcePackagedSmokeValidated',
      'sourcePackagedSmokeFailed',
      runSourcePackagedSmoke,
    );
    result.sourcePackagedSmokeValidated = true;
    await progress.step(
      'sourceNormalStartup',
      'sourceNormalStartupValidated',
      'sourceNormalStartupFailed',
      runSourceStartup,
    );
    result.sourceNormalStartupValidated = true;
    await progress.step(
      'legacyBusinessEvidence',
      'legacyBusinessFixtureValidated',
      'legacyBusinessFixtureInvalid',
      captureSourceEvidence,
    );
    result.legacyBusinessFixtureValidated = true;
    result.upgradeExitCode = await progress.step(
      'majorUpgrade',
      'targetInstalled',
      'majorUpgradeFailed',
      async () => {
        const exitCode = await runMsiOperation('majorUpgrade');
        if (exitCode !== 0) fail('majorUpgradeFailed');
        return exitCode;
      },
    );
    requireTargetInstalled(
      await progress.step(
        'targetPostcondition',
        'targetStateValidated',
        'installerStateInspectionFailed',
        () => inspectState('target'),
      ),
      versions,
    );
    await progress.step(
      'targetPayload',
      'targetPayloadValidated',
      'majorUpgradeStateInvalid',
      validateTargetPayload,
    );
    result.majorUpgradeValidated = true;
    await progress.step(
      'targetFirstStartup',
      'targetFirstStartupValidated',
      'targetFirstStartupFailed',
      () => runTargetStartup('first'),
    );
    result.targetFirstStartupValidated = true;
    await progress.step(
      'targetSecondStartup',
      'targetSecondStartupValidated',
      'targetSecondStartupFailed',
      () => runTargetStartup('second'),
    );
    result.targetSecondStartupValidated = true;
    await progress.step(
      'artifactAfterStartup',
      'artifactValidated',
      'artifactVerificationFailed',
      verifyArtifact,
    );
    result.artifactBytesValidated = true;
    Object.assign(result, {
      status: 'completed',
      resultCode: 'historicalLegacyUpgradeCompleted',
      errorCode: null,
    });
  } catch (error) {
    result.errorCode = errorCodeOf(error);
  }
  progress.emit('lifecycle', result.status, progress.startedAt, {
    ...(result.status === 'completed'
      ? { resultCode: result.resultCode }
      : { errorCode: result.errorCode }),
  });
  return Object.freeze(result);
}
