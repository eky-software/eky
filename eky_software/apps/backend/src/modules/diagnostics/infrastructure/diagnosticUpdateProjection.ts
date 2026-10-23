const stages = [
  'packageInspection', 'packageStaging', 'currentPackageRegistration', 'candidateDiscard',
  'confirmation', 'recoveryPoint', 'runtimeShutdown', 'installerHandoff',
  'firstStartValidation', 'businessRollback', 'binaryRollback', 'restoreCompatibility',
] as const;
const legacyStages = ['preUpdateRecovery', 'runtimeShutdown', 'installerHandoff', 'firstStartValidation'];
const startedFields = ['correlationId', 'stage'];
const completedFields = [...startedFields, 'durationMs'];
const failedFields = [...completedFields, 'errorCode', 'retryable', 'sideEffectState'];
const coreFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'eventId', 'eventName',
  'level', 'outcome', 'runtimeInstanceId', 'schemaVersion', 'timestamp',
];

interface UpdateProjectionSpec {
  category: 'update';
  level: 'error' | 'info' | 'warn';
  outcome: 'blocked' | 'failure' | 'success';
  stages: readonly string[];
  fields: readonly string[];
}

export const diagnosticUpdateSpecs: Readonly<Record<string, UpdateProjectionSpec>> = Object.freeze({
  'update.operationStarted': spec('info', 'success', legacyStages, startedFields),
  'update.operationCompleted': spec('info', 'success', legacyStages, completedFields),
  'update.operationFailed': spec('error', 'failure', legacyStages, failedFields),
  ...Object.fromEntries(stages.flatMap(stage => {
    const level = stage === 'businessRollback' || stage === 'binaryRollback' ? 'warn' : 'info';
    return [
      [`update.${stage}Started`, spec(level, 'success', [stage], startedFields)],
      [`update.${stage}Succeeded`, spec(level, 'success', [stage], completedFields)],
      [`update.${stage}Failed`, spec('error', 'failure', [stage], failedFields)],
    ];
  })),
  'update.accepted': spec('info', 'success', ['firstStartValidation'], startedFields),
  'update.installerNotApplied': spec('warn', 'blocked', ['firstStartValidation'], startedFields),
  'update.recoveryRequired': spec('error', 'failure', stages, failedFields),
});

export function isUpdateSourcePayload(value: Record<string, unknown>): boolean {
  if (typeof value.eventName !== 'string' || !Object.hasOwn(diagnosticUpdateSpecs, value.eventName)) return false;
  const definition = diagnosticUpdateSpecs[value.eventName]!;
  const fields = new Set([...coreFields, ...definition.fields]);
  if (Object.keys(value).some(key => !fields.has(key)) ||
    definition.fields.some(key => value[key] === undefined) ||
    typeof value.correlationId !== 'string' || !uuidPattern.test(value.correlationId) ||
    typeof value.stage !== 'string' || !definition.stages.includes(value.stage)) return false;
  if (definition.fields.includes('durationMs') && !isNonNegativeInteger(value.durationMs)) return false;
  if (definition.outcome === 'failure' && (
    typeof value.errorCode !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(value.errorCode) ||
    typeof value.retryable !== 'boolean' ||
    !['committed', 'none', 'rolledBack', 'unknown'].includes(value.sideEffectState as string)
  )) return false;
  return value.eventName !== 'update.recoveryRequired' || (
    value.errorCode === 'UPDATE_RECOVERY_REQUIRED' && value.retryable === false && value.sideEffectState === 'unknown'
  );
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function spec(level: UpdateProjectionSpec['level'], outcome: UpdateProjectionSpec['outcome'],
  allowedStages: readonly string[], fields: readonly string[]): UpdateProjectionSpec {
  return { category: 'update', level, outcome, stages: allowedStages, fields };
}
