const operation = 'w6b2PackagedSuccessCommand';

export const W6B2_PACKAGED_SUCCESS_COMMAND_TIMEOUT_MILLISECONDS =
  25 * 60 * 1000;
export const W6B2_PACKAGED_SUCCESS_CLEANUP_RESERVE_MILLISECONDS =
  90 * 1000;

const commandDeadlineErrorCode =
  'W6B2_SUCCESS_COMMAND_DEADLINE_EXCEEDED';
const commandFailureErrorCode = 'W6B2_SUCCESS_COMMAND_FAILED';
const phaseFailureErrorCode = 'W6B2_SUCCESS_COMMAND_PHASE_FAILED';
const allowedPhases = new Set([
  'command',
  'commandDeadline',
  'installerPairBuild',
  'installerPairVerification',
  'profilePreparation',
  'run1FixtureCreate',
  'run1Scenario',
  'run1FixtureVerification',
  'run1InstallerPairVerification',
  'run1FixtureRemove',
  'run1ProcessTreeAbsent',
  'run2FixtureCreate',
  'run2Scenario',
  'run2FixtureVerification',
  'run2InstallerPairVerification',
  'run2FixtureRemove',
  'run2ProcessTreeAbsent',
  'cleanup',
]);
const allowedStatuses = new Set(['started', 'completed', 'failed']);
const safeErrorCodes = new Set([
  commandDeadlineErrorCode,
  commandFailureErrorCode,
  phaseFailureErrorCode,
]);

const defaultDependencies = Object.freeze({
  now: Date.now,
  observe: writeSafeObservation,
});

export function createW6b2PackagedSuccessCommandLifecycle(options = {}) {
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const timeoutMilliseconds = requirePositiveInteger(
    options.timeoutMilliseconds ??
      W6B2_PACKAGED_SUCCESS_COMMAND_TIMEOUT_MILLISECONDS,
  );
  const cleanupReserveMilliseconds = requirePositiveInteger(
    options.cleanupReserveMilliseconds ??
      W6B2_PACKAGED_SUCCESS_CLEANUP_RESERVE_MILLISECONDS,
  );
  if (cleanupReserveMilliseconds >= timeoutMilliseconds) {
    throw new Error('W6B2_SUCCESS_COMMAND_LIFECYCLE_INVALID');
  }

  const startedAt = dependencies.now();
  const deadlineAt = startedAt + timeoutMilliseconds;
  let deadlineReported = false;
  let terminal = false;

  const emit = (phase, status, phaseStartedAt, errorCode) => {
    safelyObserve(dependencies.observe, {
      durationMs: Math.max(0, dependencies.now() - phaseStartedAt),
      elapsedMs: Math.max(0, dependencies.now() - startedAt),
      errorCode,
      operation,
      phase,
      status,
    });
  };

  const reportDeadline = () => {
    if (deadlineReported) return;
    deadlineReported = true;
    emit(
      'commandDeadline',
      'failed',
      dependencies.now(),
      commandDeadlineErrorCode,
    );
  };

  const throwDeadline = () => {
    reportDeadline();
    throw new Error(commandDeadlineErrorCode);
  };

  const requireRemainingBudget = (reserveMilliseconds = 0) => {
    if (dependencies.now() + reserveMilliseconds >= deadlineAt) {
      throwDeadline();
    }
  };

  emit('command', 'started', startedAt);

  return Object.freeze({
    complete() {
      if (terminal) {
        throw new Error('W6B2_SUCCESS_COMMAND_LIFECYCLE_INVALID');
      }
      requireRemainingBudget();
      terminal = true;
      emit('command', 'completed', startedAt);
    },

    fail(error) {
      if (terminal) return;
      terminal = true;
      const errorCode =
        error instanceof Error &&
        error.message === commandDeadlineErrorCode
          ? commandDeadlineErrorCode
          : commandFailureErrorCode;
      if (errorCode === commandDeadlineErrorCode) reportDeadline();
      emit('command', 'failed', startedAt, errorCode);
    },

    getScenarioTimeoutMilliseconds(maximumTimeoutMilliseconds) {
      const maximum = requirePositiveInteger(maximumTimeoutMilliseconds);
      const available =
        deadlineAt - dependencies.now() - cleanupReserveMilliseconds;
      if (available < maximum) {
        throwDeadline();
      }
      return maximum;
    },

    async runCleanupPhase(phase, operation_) {
      requirePhase(phase);
      requireOperation(operation_);
      const cleanupStartedAt = dependencies.now();
      emit('cleanup', 'started', cleanupStartedAt);
      const phaseStartedAt = dependencies.now();
      emit(phase, 'started', phaseStartedAt);
      try {
        const result = await operation_();
        emit(phase, 'completed', phaseStartedAt);
        emit('cleanup', 'completed', cleanupStartedAt);
        return result;
      } catch (error) {
        emit(phase, 'failed', phaseStartedAt, phaseFailureErrorCode);
        emit('cleanup', 'failed', cleanupStartedAt, phaseFailureErrorCode);
        throw error;
      }
    },

    async runPhase(phase, operation_, options_ = {}) {
      requirePhase(phase);
      requireOperation(operation_);
      const reserveMilliseconds =
        options_.reserveMilliseconds === undefined
          ? 0
          : requireNonNegativeInteger(options_.reserveMilliseconds);
      requireRemainingBudget(reserveMilliseconds);
      const phaseStartedAt = dependencies.now();
      emit(phase, 'started', phaseStartedAt);
      try {
        const result = await operation_();
        requireRemainingBudget(reserveMilliseconds);
        emit(phase, 'completed', phaseStartedAt);
        return result;
      } catch (error) {
        const errorCode =
          error instanceof Error &&
          error.message === commandDeadlineErrorCode
            ? commandDeadlineErrorCode
            : phaseFailureErrorCode;
        emit(phase, 'failed', phaseStartedAt, errorCode);
        throw error;
      }
    },

    observeProcessTreeAbsent(runNumber) {
      const phase = requireRunPhase(runNumber, 'ProcessTreeAbsent');
      emit(phase, 'completed', dependencies.now());
    },

    requireScenarioStartBudget(maximumTimeoutMilliseconds) {
      const maximum = requirePositiveInteger(maximumTimeoutMilliseconds);
      requireRemainingBudget(cleanupReserveMilliseconds + maximum);
    },
  });
}

export function createW6b2PackagedSuccessRunPhase(runNumber, suffix) {
  return requireRunPhase(runNumber, suffix);
}

function requireRunPhase(runNumber, suffix) {
  if (
    (runNumber !== 1 && runNumber !== 2) ||
    typeof suffix !== 'string'
  ) {
    throw new Error('W6B2_SUCCESS_COMMAND_PHASE_INVALID');
  }
  const phase = `run${String(runNumber)}${suffix}`;
  requirePhase(phase);
  return phase;
}

function requirePhase(phase) {
  if (!allowedPhases.has(phase)) {
    throw new Error('W6B2_SUCCESS_COMMAND_PHASE_INVALID');
  }
}

function requireOperation(value) {
  if (typeof value !== 'function') {
    throw new Error('W6B2_SUCCESS_COMMAND_LIFECYCLE_INVALID');
  }
}

function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('W6B2_SUCCESS_COMMAND_LIFECYCLE_INVALID');
  }
  return value;
}

function requireNonNegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('W6B2_SUCCESS_COMMAND_LIFECYCLE_INVALID');
  }
  return value;
}

function safelyObserve(observer, event) {
  if (
    event.operation !== operation ||
    !allowedPhases.has(event.phase) ||
    !allowedStatuses.has(event.status) ||
    !Number.isSafeInteger(event.durationMs) ||
    event.durationMs < 0 ||
    !Number.isSafeInteger(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    (event.errorCode !== undefined && !safeErrorCodes.has(event.errorCode))
  ) {
    return;
  }
  const safeEvent = {
    operation: event.operation,
    phase: event.phase,
    status: event.status,
    durationMs: event.durationMs,
    elapsedMs: event.elapsedMs,
    ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
  };
  try {
    observer(Object.freeze(safeEvent));
  } catch {
    // Test observability cannot change the command result.
  }
}

function writeSafeObservation(event) {
  console.log(JSON.stringify(event));
}
