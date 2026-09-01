import { requireW6b2PackagedFaultScenario } from './w6b2PackagedFaultRunFixture.mjs';

const operation = 'w6b2PackagedFaultCommand';

export const W6B2_PACKAGED_FAULT_COMMAND_TIMEOUT_MILLISECONDS =
  25 * 60 * 1000;
export const W6B2_PACKAGED_FAULT_FULL_COMMAND_TIMEOUT_MILLISECONDS =
  135 * 60 * 1000;
export const W6B2_PACKAGED_FAULT_CLEANUP_RESERVE_MILLISECONDS =
  90 * 1000;

const commandDeadlineErrorCode = 'W6B2_FAULT_COMMAND_DEADLINE_EXCEEDED';
const commandFailureErrorCode = 'W6B2_FAULT_COMMAND_FAILED';
const phaseFailureErrorCode = 'W6B2_FAULT_COMMAND_PHASE_FAILED';
const allowedPhases = new Set([
  'command',
  'commandDeadline',
  'installerPairBuild',
  'installerPairVerification',
  'profilePreparation',
  'fixtureCreate',
  'scenario',
  'fixtureVerification',
  'installerPairPostVerification',
  'fixtureRemove',
  'processTreeAbsent',
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

export function createW6b2PackagedFaultCommandLifecycle(options = {}) {
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const timeoutMilliseconds = requirePositiveInteger(
    options.timeoutMilliseconds ??
      W6B2_PACKAGED_FAULT_COMMAND_TIMEOUT_MILLISECONDS,
  );
  const cleanupReserveMilliseconds = requirePositiveInteger(
    options.cleanupReserveMilliseconds ??
      W6B2_PACKAGED_FAULT_CLEANUP_RESERVE_MILLISECONDS,
  );
  if (cleanupReserveMilliseconds >= timeoutMilliseconds) {
    throw new Error('W6B2_FAULT_COMMAND_LIFECYCLE_INVALID');
  }

  const startedAt = dependencies.now();
  const deadlineAt = startedAt + timeoutMilliseconds;
  let deadlineReported = false;
  let terminal = false;

  const emit = (phase, status, phaseStartedAt, context, errorCode) => {
    safelyObserve(dependencies.observe, {
      durationMs: Math.max(0, dependencies.now() - phaseStartedAt),
      elapsedMs: Math.max(0, dependencies.now() - startedAt),
      errorCode,
      faultScenario: context?.faultScenario,
      operation,
      phase,
      runNumber: context?.runNumber,
      status,
    });
  };

  const reportDeadline = (context) => {
    if (deadlineReported) return;
    deadlineReported = true;
    emit(
      'commandDeadline',
      'failed',
      dependencies.now(),
      context,
      commandDeadlineErrorCode,
    );
  };

  const throwDeadline = (context) => {
    reportDeadline(context);
    throw new Error(commandDeadlineErrorCode);
  };

  const requireRemainingBudget = (reserveMilliseconds = 0, context) => {
    if (dependencies.now() + reserveMilliseconds >= deadlineAt) {
      throwDeadline(context);
    }
  };

  emit('command', 'started', startedAt);

  return Object.freeze({
    complete() {
      if (terminal) {
        throw new Error('W6B2_FAULT_COMMAND_LIFECYCLE_INVALID');
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
      emit('command', 'failed', startedAt, undefined, errorCode);
    },

    getScenarioTimeoutMilliseconds(maximumTimeoutMilliseconds, context) {
      const maximum = requirePositiveInteger(maximumTimeoutMilliseconds);
      const safeContext = requireRunContext(context);
      const available =
        deadlineAt - dependencies.now() - cleanupReserveMilliseconds;
      if (available < maximum) {
        throwDeadline(safeContext);
      }
      return maximum;
    },

    observeProcessTreeAbsent(context) {
      emit(
        'processTreeAbsent',
        'completed',
        dependencies.now(),
        requireRunContext(context),
      );
    },

    requireScenarioStartBudget(maximumTimeoutMilliseconds, context) {
      const maximum = requirePositiveInteger(maximumTimeoutMilliseconds);
      const safeContext = requireRunContext(context);
      requireRemainingBudget(
        cleanupReserveMilliseconds + maximum,
        safeContext,
      );
    },

    async runCleanupPhase(phase, operation_, context) {
      requirePhase(phase);
      requireOperation(operation_);
      const safeContext = requireRunContext(context);
      const cleanupStartedAt = dependencies.now();
      emit('cleanup', 'started', cleanupStartedAt, safeContext);
      const phaseStartedAt = dependencies.now();
      emit(phase, 'started', phaseStartedAt, safeContext);
      try {
        const result = await operation_();
        emit(phase, 'completed', phaseStartedAt, safeContext);
        emit('cleanup', 'completed', cleanupStartedAt, safeContext);
        return result;
      } catch (error) {
        emit(
          phase,
          'failed',
          phaseStartedAt,
          safeContext,
          phaseFailureErrorCode,
        );
        emit(
          'cleanup',
          'failed',
          cleanupStartedAt,
          safeContext,
          phaseFailureErrorCode,
        );
        throw error;
      }
    },

    async runPhase(phase, operation_, context) {
      requirePhase(phase);
      requireOperation(operation_);
      const safeContext =
        context === undefined ? undefined : requireRunContext(context);
      requireRemainingBudget(0, safeContext);
      const phaseStartedAt = dependencies.now();
      emit(phase, 'started', phaseStartedAt, safeContext);
      try {
        const result = await operation_();
        requireRemainingBudget(0, safeContext);
        emit(phase, 'completed', phaseStartedAt, safeContext);
        return result;
      } catch (error) {
        const errorCode =
          error instanceof Error &&
          error.message === commandDeadlineErrorCode
            ? commandDeadlineErrorCode
            : phaseFailureErrorCode;
        emit(phase, 'failed', phaseStartedAt, safeContext, errorCode);
        throw error;
      }
    },
  });
}

function requireRunContext(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value.runNumber !== 1 && value.runNumber !== 2)
  ) {
    throw new Error('W6B2_FAULT_COMMAND_CONTEXT_INVALID');
  }
  requireW6b2PackagedFaultScenario(value.faultScenario);
  return Object.freeze({
    faultScenario: value.faultScenario,
    runNumber: value.runNumber,
  });
}

function requirePhase(phase) {
  if (!allowedPhases.has(phase)) {
    throw new Error('W6B2_FAULT_COMMAND_PHASE_INVALID');
  }
}

function requireOperation(value) {
  if (typeof value !== 'function') {
    throw new Error('W6B2_FAULT_COMMAND_LIFECYCLE_INVALID');
  }
}

function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('W6B2_FAULT_COMMAND_LIFECYCLE_INVALID');
  }
  return value;
}

function safelyObserve(observer, event) {
  const hasContext =
    event.faultScenario !== undefined || event.runNumber !== undefined;
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
  if (hasContext) {
    try {
      requireRunContext({
        faultScenario: event.faultScenario,
        runNumber: event.runNumber,
      });
    } catch {
      return;
    }
  }
  const safeEvent = {
    operation: event.operation,
    phase: event.phase,
    status: event.status,
    durationMs: event.durationMs,
    elapsedMs: event.elapsedMs,
    ...(hasContext
      ? {
          faultScenario: event.faultScenario,
          runNumber: event.runNumber,
        }
      : {}),
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
