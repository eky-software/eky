import {
  desktopOperationalEventSpecs, desktopRequiredPayloadFields, updateOperationalStages,
} from '../observability/desktopOperationalEvent.js';

const coreFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'errorCode',
  'eventName', 'id', 'level', 'occurredAt', 'outcome', 'runtimeInstanceId',
];
const legacyStages = ['preUpdateRecovery', 'runtimeShutdown', 'installerHandoff', 'firstStartValidation'];
const genericNames = new Set(['update.operationStarted', 'update.operationCompleted', 'update.operationFailed']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSupportBundleUpdateProjection(value: Record<string, unknown>): boolean {
  if (typeof value.eventName !== 'string' || !value.eventName.startsWith('update.')) return true;
  if (!Object.hasOwn(desktopOperationalEventSpecs, value.eventName)) return false;
  const eventName = value.eventName as keyof typeof desktopOperationalEventSpecs;
  const definition = desktopOperationalEventSpecs[eventName];
  const fields = new Set([...coreFields, ...definition.payloadFields.filter(field => field !== 'fingerprint')]);
  if (definition.level === 'info' || value.category !== definition.category || value.component !== 'desktop' ||
    value.level !== definition.level || value.outcome !== definition.outcome ||
    Object.keys(value).some(key => !fields.has(key)) ||
    desktopRequiredPayloadFields[eventName].some(key => value[key] === undefined) ||
    typeof value.correlationId !== 'string' || !uuidPattern.test(value.correlationId) ||
    typeof value.stage !== 'string' ||
    (definition.outcome === 'failure' ? typeof value.errorCode !== 'string' : value.errorCode !== null)) return false;

  const allowedStages: readonly string[] = genericNames.has(eventName) ? legacyStages :
    eventName === 'update.accepted' || eventName === 'update.installerNotApplied' ? ['firstStartValidation'] :
    eventName === 'update.recoveryRequired' ? updateOperationalStages :
    updateOperationalStages.filter(stage =>
      eventName === `update.${stage}Started` || eventName === `update.${stage}Succeeded` || eventName === `update.${stage}Failed`);
  if (!allowedStages.includes(value.stage)) return false;
  return eventName !== 'update.recoveryRequired' || (
    value.errorCode === 'UPDATE_RECOVERY_REQUIRED' && value.retryable === false && value.sideEffectState === 'unknown'
  );
}
