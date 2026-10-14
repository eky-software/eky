import type {
  DiagnosticEventLevel,
  DiagnosticEventOutcome,
} from './diagnosticsTypes.js';

interface RecoveryProjectionSpec {
  category: string;
  level: DiagnosticEventLevel;
  outcome: DiagnosticEventOutcome;
  stages: readonly string[];
  payloadFields: readonly string[];
}

const startedFields = ['correlationId', 'stage'] as const;
const completedFields = [...startedFields, 'durationMs'] as const;
const failedFields = [
  ...completedFields, 'errorCode', 'fingerprint', 'retryable', 'sideEffectState',
] as const;
const coreFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'errorCode',
  'eventName', 'id', 'level', 'occurredAt', 'outcome', 'runtimeInstanceId',
] as const;
const restoreAcceptanceFailureCodes = new Set([
  'PROFILE_SCHEMA_UNSUPPORTED', 'PROFILE_INSPECTION_LIMIT_EXCEEDED',
  'PROFILE_INSPECTION_TIMEOUT', 'PROFILE_INSPECTION_PROTOCOL_INVALID',
  'PROFILE_INSPECTION_CLEANUP_UNVERIFIED', 'PROFILE_RESTORE_RECOVERY_REQUIRED',
]);

// HTTP projection contract, independent of the desktop's internal event types.
const recoverySpecs = Object.freeze({
  'backup.started': spec('backup', 'info', 'success', ['portable'], startedFields),
  'backup.completed': spec(
    'backup', 'info', 'success', ['portable'], completedFields,
  ),
  'backup.failed': spec('backup', 'error', 'failure', ['portable'], failedFields),
  'backup.inspectionCompleted': spec(
    'backup', 'info', 'success', ['portable'], completedFields,
  ),
  'backup.inspectionFailed': spec(
    'backup', 'warn', 'failure', ['portable'], failedFields,
  ),
  'recoveryPoint.started': spec(
    'recoveryPoint', 'info', 'success', ['creation'],
    [...startedFields, 'recoveryPointKind'],
  ),
  'recoveryPoint.completed': spec(
    'recoveryPoint', 'info', 'success', ['creation'],
    [...completedFields, 'recoveryPointKind'],
  ),
  'recoveryPoint.failed': spec(
    'recoveryPoint', 'warn', 'failure', ['automaticCheck', 'creation'],
    [...failedFields, 'recoveryPointKind'],
  ),
  'restore.inspectionCompleted': spec(
    'restore', 'info', 'success', ['inspection'], completedFields,
  ),
  'restore.inspectionFailed': spec(
    'restore', 'warn', 'failure', ['inspection'], failedFields,
  ),
  'restore.stagingCompleted': spec(
    'restore', 'info', 'success', ['staging'], completedFields,
  ),
  'restore.stagingFailed': spec(
    'restore', 'error', 'failure', ['staging'], failedFields,
  ),
  'restore.activationStarted': spec(
    'restore', 'info', 'success', ['activation'], startedFields,
  ),
  'restore.activationFailed': spec(
    'restore', 'error', 'failure', ['activation'], failedFields,
  ),
  'restore.acceptanceFailed': spec(
    'restore', 'error', 'failure', ['acceptancePreparation', 'acceptanceCommit', 'acceptedCleanup'], failedFields,
  ),
  'restore.validationCompleted': spec(
    'restore', 'info', 'success', ['restoredProfile', 'rolledBackProfile'],
    completedFields,
  ),
  'restore.validationFailed': spec(
    'restore', 'error', 'failure', ['restoredProfile', 'rolledBackProfile'],
    failedFields,
  ),
  'restore.rollbackStarted': spec(
    'restore', 'warn', 'success', ['activationRollback', 'startupRollback'],
    startedFields,
  ),
  'restore.rollbackCompleted': spec(
    'restore', 'warn', 'success', ['activationRollback', 'startupRollback'],
    completedFields,
  ),
  'restore.rollbackFailed': spec(
    'restore', 'error', 'failure', ['activationRollback', 'startupRollback'],
    failedFields,
  ),
  'restore.recoveryRequired': spec(
    'restore', 'error', 'failure',
    ['activation', 'activationRollback', 'failedSafeJournal', 'rolledBackProfile', 'startupRollback'],
    failedFields,
  ),
});

// General field types are checked by the caller; this validates event semantics.
export function isProfileRecoveryProjection(
  value: Record<string, unknown>,
): boolean {
  if (
    typeof value.eventName !== 'string' ||
    !Object.hasOwn(recoverySpecs, value.eventName)
  ) {
    return true;
  }
  const eventName = value.eventName as keyof typeof recoverySpecs;
  const eventSpec = recoverySpecs[eventName];
  const allowedFields = new Set<string>([
    ...coreFields, ...eventSpec.payloadFields,
  ]);
  if (
    Object.keys(value).some(key => !allowedFields.has(key)) ||
    value.component !== 'desktop' ||
    value.category !== eventSpec.category ||
    value.level !== eventSpec.level ||
    value.outcome !== eventSpec.outcome ||
    typeof value.correlationId !== 'string' ||
    typeof value.stage !== 'string' ||
    !eventSpec.stages.includes(value.stage) ||
    (eventSpec.outcome === 'failure'
      ? typeof value.errorCode !== 'string'
      : value.errorCode !== null)
  ) {
    return false;
  }
  if (
    (eventName === 'recoveryPoint.started' || eventName === 'recoveryPoint.completed') &&
    value.recoveryPointKind === undefined
  ) {
    return false;
  }
  if (eventName === 'restore.acceptanceFailed' && (
    value.durationMs === undefined || typeof value.errorCode !== 'string' ||
    !restoreAcceptanceFailureCodes.has(value.errorCode) ||
    value.retryable !== false || value.sideEffectState !== 'unknown'
  )) {
    return false;
  }
  if (
    eventName === 'restore.activationFailed' &&
    (value.durationMs === undefined ||
      value.retryable === undefined ||
      value.sideEffectState === undefined)
  ) {
    return false;
  }
  return eventName !== 'restore.recoveryRequired' || (
    value.errorCode === 'PROFILE_RESTORE_RECOVERY_REQUIRED' &&
    value.retryable === false &&
    value.sideEffectState === 'unknown'
  );
}

function spec(
  category: string,
  level: DiagnosticEventLevel,
  outcome: DiagnosticEventOutcome,
  stages: readonly string[],
  payloadFields: readonly string[],
): RecoveryProjectionSpec {
  return { category, level, outcome, stages, payloadFields };
}
