const stages = [
  'packageInspection', 'packageStaging', 'currentPackageRegistration', 'candidateDiscard',
  'confirmation', 'recoveryPoint', 'runtimeShutdown', 'installerHandoff',
  'firstStartValidation', 'businessRollback', 'binaryRollback', 'restoreCompatibility',
] as const;
const legacyStages = ['preUpdateRecovery', 'runtimeShutdown', 'installerHandoff', 'firstStartValidation'];
const startedFields = ['correlationId', 'stage'];
const completedFields = [...startedFields, 'durationMs'];
const failedFields = [...completedFields, 'retryable', 'sideEffectState'];
const coreFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'errorCode',
  'eventName', 'id', 'level', 'occurredAt', 'outcome', 'runtimeInstanceId',
];

export const diagnosticUpdateEventNames = Object.freeze([
  'update.operationStarted', 'update.operationCompleted', 'update.operationFailed',
  ...stages.flatMap(stage => [
    `update.${stage}Started`, `update.${stage}Succeeded`, `update.${stage}Failed`,
  ] as const),
  'update.accepted', 'update.installerNotApplied', 'update.recoveryRequired',
] as const);

interface UpdateProjectionSpec {
  level: 'error' | 'info' | 'warn';
  outcome: 'blocked' | 'failure' | 'success';
  stages: readonly string[];
  fields: readonly string[];
}

const specs: Readonly<Record<string, UpdateProjectionSpec>> = {
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
};

export function isUpdateProjection(value: Record<string, unknown>): boolean {
  if (typeof value.eventName !== 'string' || !value.eventName.startsWith('update.')) return true;
  if (!Object.hasOwn(specs, value.eventName)) return false;
  const definition = specs[value.eventName]!;
  const fields = new Set([...coreFields, ...definition.fields]);
  if (value.category !== 'update' || value.component !== 'desktop' ||
    value.level !== definition.level || value.outcome !== definition.outcome ||
    Object.keys(value).some(key => !fields.has(key)) ||
    definition.fields.some(key => value[key] === undefined) ||
    typeof value.correlationId !== 'string' || !uuidPattern.test(value.correlationId) ||
    typeof value.stage !== 'string' || !definition.stages.includes(value.stage) ||
    (definition.outcome === 'failure' ? typeof value.errorCode !== 'string' : value.errorCode !== null)) return false;
  return value.eventName !== 'update.recoveryRequired' || (
    value.errorCode === 'UPDATE_RECOVERY_REQUIRED' && value.retryable === false && value.sideEffectState === 'unknown'
  );
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function spec(level: UpdateProjectionSpec['level'], outcome: UpdateProjectionSpec['outcome'],
  allowedStages: readonly string[], fields: readonly string[]): UpdateProjectionSpec {
  return { level, outcome, stages: allowedStages, fields };
}
