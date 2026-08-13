import { performance } from 'node:perf_hooks';

export const packagedUpdateE2eScenarios = Object.freeze([
  'coordinatedSuccess',
  'coordinatedCancel',
  'coordinatedRollback',
  'directSetupSuccess',
  'directSetupFailure',
  'backupForwardRestore',
]);

export const packagedUpdateE2ePhases = Object.freeze([
  'runtimePreflight',
  'fixturePreparation',
  'fixtureRead',
  'fixturePackageVerification',
  'fixtureInventory',
  'initialCleanup',
  'scenarioPreCleanup',
  'scenarioPostCleanup',
  'scenarioPackageStaging',
  'currentPackageInstall',
  'currentPackageVerification',
  'currentProfileSeed',
  'businessInventoryCapture',
  'coordinatedUpdatePrepare',
  'nextPackageInstall',
  'nextPackageVerification',
  'failurePackageInstall',
  'failurePackageVerification',
  'coordinatedFirstStartValidation',
  'coordinatedSecondStartValidation',
  'coordinatedRollbackFailureValidation',
  'coordinatedRollbackNoResultValidation',
  'coordinatedRollbackLaunchValidation',
  'coordinatedRollbackInstallerWait',
  'coordinatedRollbackFinalValidation',
  'applicationPreflight',
  'applicationLaunch',
  'applicationResultOrExitWait',
  'applicationExitWait',
  'applicationProcessCleanupWait',
  'applicationOutcomeValidation',
  'directSetupFirstStartValidation',
  'directSetupSecondStartValidation',
  'directSetupThirdStartValidation',
  'directSetupRecoveryReadyValidation',
  'currentRollbackPackageInstall',
  'currentRollbackPackageVerification',
  'directSetupRecoveryFinalValidation',
  'directRecoveryCleanupVerification',
  'updateCacheRotationVerification',
  'businessArtifactVerification',
  'businessInventoryVerification',
  'backupCreation',
  'sourceBackupVerification',
  'forwardPackageInstall',
  'forwardStartValidation',
  'backupRestorePreparation',
  'restoredProfileValidation',
  'migrationChainVerification',
  'restoredBackupVerification',
  'cleanupPreflight',
  'cleanupFailurePackage',
  'cleanupNextPackage',
  'cleanupCurrentPackage',
  'cleanupInstallRootVerification',
  'scenarioWorkspaceCleanup',
  'finalCleanup',
  'evidenceWrite',
]);

const scenarioSet = new Set(packagedUpdateE2eScenarios);
const phaseSet = new Set(packagedUpdateE2ePhases);
const safeErrorCodes = new Set([
  'PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID',
  'PACKAGED_UPDATE_E2E_APPLICATION_EXIT_TIMEOUT',
  'PACKAGED_UPDATE_E2E_APPLICATION_RESULT_MISSING',
  'PACKAGED_UPDATE_E2E_APPLICATION_SEQUENCE_INVALID',
  'PACKAGED_UPDATE_E2E_APPLICATION_START_FAILED',
  'PACKAGED_UPDATE_E2E_APPLICATION_TIMEOUT',
  'PACKAGED_UPDATE_E2E_ARTIFACT_INVALID',
  'PACKAGED_UPDATE_E2E_BACKUP_MIGRATION_CHAIN_INVALID',
  'PACKAGED_UPDATE_E2E_BUSINESS_ARTIFACT_CHANGED',
  'PACKAGED_UPDATE_E2E_BUSINESS_ARTIFACT_MISSING',
  'PACKAGED_UPDATE_E2E_CACHE_METADATA_INVALID',
  'PACKAGED_UPDATE_E2E_CACHE_ROTATION_INVALID',
  'PACKAGED_UPDATE_E2E_CANCEL_PROFILE_CHANGED',
  'PACKAGED_UPDATE_E2E_CLEANUP_FAILED',
  'PACKAGED_UPDATE_E2E_DIRECT_FAILURE_PROFILE_CHANGED',
  'PACKAGED_UPDATE_E2E_DIRECT_RECOVERY_REMAINS',
  'PACKAGED_UPDATE_E2E_EKY_PROCESS_REMAINS',
  'PACKAGED_UPDATE_E2E_EKY_PROCESS_RUNNING',
  'PACKAGED_UPDATE_E2E_FILE_INVALID',
  'PACKAGED_UPDATE_E2E_FILE_TYPE_REJECTED',
  'PACKAGED_UPDATE_E2E_FIXTURE_INVALID',
  'PACKAGED_UPDATE_E2E_INSTALLER_STABILITY_TIMEOUT',
  'PACKAGED_UPDATE_E2E_INSTALL_FAILED',
  'PACKAGED_UPDATE_E2E_INSTALL_ROOT_REMAINS',
  'PACKAGED_UPDATE_E2E_MIXED_INSTALL_ROOT',
  'PACKAGED_UPDATE_E2E_PACKAGE_IDENTITY_INVALID',
  'PACKAGED_UPDATE_E2E_PROCESS_FAILED',
  'PACKAGED_UPDATE_E2E_PROCESS_START_FAILED',
  'PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT',
  'PACKAGED_UPDATE_E2E_RESULT_ACCEPTED_VERSION_INVALID',
  'PACKAGED_UPDATE_E2E_RESULT_APP_VERSION_INVALID',
  'PACKAGED_UPDATE_E2E_RESULT_INVALID',
  'PACKAGED_UPDATE_E2E_RESULT_JOURNAL_INVALID',
  'PACKAGED_UPDATE_E2E_RESULT_PDF_INVALID',
  'PACKAGED_UPDATE_E2E_RESULT_STATUS_INVALID',
  'PACKAGED_UPDATE_E2E_ROLLBACK_PROFILE_CHANGED',
  'PACKAGED_UPDATE_E2E_STATUS_EXPECTATION_FAILED',
  'PACKAGED_UPDATE_E2E_SYMLINK_REJECTED',
  'PACKAGED_UPDATE_E2E_UNKNOWN_INSTALL_PRESENT',
]);

const fallbackErrorCode = 'PACKAGED_UPDATE_E2E_PROGRESS_FAILURE';
const heartbeatIntervalMs = 60_000;

export function createPackagedUpdateE2eProgressObserver({
  clearIntervalFn = clearInterval,
  now = () => performance.now(),
  setIntervalFn = setInterval,
  writeLine = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const harnessStartedAt = now();

  return Object.freeze({
    runCleanup,
    runPhase,
    runScenario,
  });

  async function runScenario(scenario, operation) {
    requireScenario(scenario);
    requireOperation(operation);
    const startedAt = now();
    emit('scenarioStarted', { scenario }, startedAt, startedAt);
    try {
      const result = await operation();
      emit('scenarioCompleted', { scenario }, startedAt, now());
      return result;
    } catch (error) {
      emit(
        'scenarioFailed',
        { errorCode: toSafeErrorCode(error), scenario },
        startedAt,
        now(),
      );
      throw error;
    }
  }

  async function runPhase({ phase, scenario }, operation) {
    requirePhase(phase);
    requireOptionalScenario(scenario);
    requireOperation(operation);
    const startedAt = now();
    const identity = scenario === undefined ? { phase } : { phase, scenario };
    emit('phaseStarted', identity, startedAt, startedAt);
    const heartbeat = startHeartbeat(identity, startedAt);
    try {
      const result = await operation();
      emit('phaseCompleted', identity, startedAt, now());
      return result;
    } catch (error) {
      emit(
        'phaseFailed',
        { ...identity, errorCode: toSafeErrorCode(error) },
        startedAt,
        now(),
      );
      throw error;
    } finally {
      stopHeartbeat(heartbeat);
    }
  }

  async function runCleanup({ phase, scenario }, operation) {
    requirePhase(phase);
    requireOptionalScenario(scenario);
    requireOperation(operation);
    const startedAt = now();
    const identity = scenario === undefined ? { phase } : { phase, scenario };
    emit('cleanupStarted', identity, startedAt, startedAt);
    const heartbeat = startHeartbeat(identity, startedAt);
    try {
      const result = await operation();
      emit('cleanupCompleted', identity, startedAt, now());
      return result;
    } catch (error) {
      emit(
        'cleanupFailed',
        { ...identity, errorCode: toSafeErrorCode(error) },
        startedAt,
        now(),
      );
      throw error;
    } finally {
      stopHeartbeat(heartbeat);
    }
  }

  function startHeartbeat(identity, startedAt) {
    try {
      const timer = setIntervalFn(() => {
        emit('heartbeat', identity, startedAt, now());
      }, heartbeatIntervalMs);
      timer?.unref?.();
      return timer;
    } catch {
      return undefined;
    }
  }

  function stopHeartbeat(timer) {
    if (timer === undefined) {
      return;
    }
    try {
      clearIntervalFn(timer);
    } catch {
      // Progress reporting must never change the harness result.
    }
  }

  function emit(event, fields, startedAt, completedAt) {
    const durationMs = toDuration(completedAt - startedAt);
    const elapsedMs = toDuration(completedAt - harnessStartedAt);
    try {
      writeLine(
        JSON.stringify({
          event,
          ...fields,
          durationMs,
          elapsedMs,
          source: 'packagedUpdateE2e',
        }),
      );
    } catch {
      // Progress reporting must never change the harness result.
    }
  }
}

function requireScenario(scenario) {
  if (!scenarioSet.has(scenario)) {
    throw new Error('PACKAGED_UPDATE_E2E_PROGRESS_SCENARIO_INVALID');
  }
}

function requireOptionalScenario(scenario) {
  if (scenario !== undefined) {
    requireScenario(scenario);
  }
}

function requirePhase(phase) {
  if (!phaseSet.has(phase)) {
    throw new Error('PACKAGED_UPDATE_E2E_PROGRESS_PHASE_INVALID');
  }
}

function requireOperation(operation) {
  if (typeof operation !== 'function') {
    throw new Error('PACKAGED_UPDATE_E2E_PROGRESS_OPERATION_INVALID');
  }
}

function toSafeErrorCode(error) {
  return error instanceof Error && safeErrorCodes.has(error.message)
    ? error.message
    : fallbackErrorCode;
}

function toDuration(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
