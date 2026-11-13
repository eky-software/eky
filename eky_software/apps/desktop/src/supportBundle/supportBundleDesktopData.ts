import { isPackagedBuildRevision, isSemVer } from '../release/desktopBuildInfo.js';
import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from '../observability/desktopOperationalEventValidator.js';
import { hasExactDataKeys, isPlainDataRecord } from '../workspaces/registry/workspaceRegistryValueShape.js';

export const desktopOnlySupportBundleFormatVersion = 3 as const;
export const desktopOnlySupportBundleKind = 'desktopOnly' as const;
export const desktopOnlySupportBundleSections = Object.freeze(['system', 'availability', 'observation'] as const);

export type DesktopSupportFailureEvent = Extract<DesktopOperationalEvent, {
  eventName: 'workspaceManagement.operationFailed' | 'workspaceBackup.operationFailed' | 'workspaceBackup.cleanupFailed';
}>;

export interface SupportBundleDesktopSystem {
  readonly appVersion: string;
  readonly architecture: 'x64' | 'arm64';
  readonly buildRevision: string;
  readonly electronVersion: string;
  readonly platform: 'win32' | 'linux' | 'darwin';
}

export interface SupportBundleDesktopAvailability {
  readonly backend: 'notRunning' | 'exitUnconfirmed';
  readonly database: 'notInspected';
  readonly diagnosticHistory: 'notCollected';
  readonly incidentHistory: 'notCollected';
}

export type SupportBundleDesktopObservation = Readonly<
  | { scope: 'currentOperation'; status: 'unavailable' }
  | { scope: 'currentOperation'; status: 'available';
      firstError: DesktopSupportFailureEvent | null; cleanupError: DesktopSupportFailureEvent | null }
>;

export interface SupportBundleDesktopData {
  readonly system: Readonly<SupportBundleDesktopSystem>;
  readonly availability: Readonly<SupportBundleDesktopAvailability>;
  readonly observation: SupportBundleDesktopObservation;
}

const maximumVersionLength = 100;
const technicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventFields = Object.freeze([
  'appVersion', 'buildRevision', 'category', 'component', 'correlationId',
  'durationMs', 'errorCode', 'eventId', 'eventName', 'level', 'outcome',
  'retryable', 'runtimeInstanceId', 'schemaVersion', 'sideEffectState', 'stage', 'timestamp',
]);

export function isSupportBundleTechnicalId(value: unknown): value is string {
  return typeof value === 'string' && technicalUuid.test(value);
}

// This validates a bounded projection, not build admission or process absence.
export function readSupportBundleDesktopData(value: unknown): Readonly<SupportBundleDesktopData> {
  try {
    const data = record(value, desktopOnlySupportBundleSections);
    const system = readSupportBundleDesktopSystem(data.system);
    return Object.freeze({ system, availability: readAvailability(data.availability),
      observation: readObservation(data.observation, system) });
  } catch {
    return invalid();
  }
}

export function readSupportBundleDesktopSystem(value: unknown): Readonly<SupportBundleDesktopSystem> {
  const data = record(value, ['appVersion', 'architecture', 'buildRevision', 'electronVersion', 'platform']);
  if (!version(data.appVersion) || !version(data.electronVersion) ||
      typeof data.buildRevision !== 'string' ||
      (!isPackagedBuildRevision(data.buildRevision) && data.buildRevision !== 'development') ||
      (data.architecture !== 'x64' && data.architecture !== 'arm64') ||
      (data.platform !== 'win32' && data.platform !== 'linux' && data.platform !== 'darwin')) return invalid();
  return Object.freeze({ appVersion: data.appVersion, architecture: data.architecture,
    buildRevision: data.buildRevision, electronVersion: data.electronVersion, platform: data.platform });
}

function readAvailability(value: unknown): Readonly<SupportBundleDesktopAvailability> {
  const data = record(value, ['backend', 'database', 'diagnosticHistory', 'incidentHistory']);
  if ((data.backend !== 'notRunning' && data.backend !== 'exitUnconfirmed') ||
      data.database !== 'notInspected' || data.diagnosticHistory !== 'notCollected' ||
      data.incidentHistory !== 'notCollected') return invalid();
  return Object.freeze({ backend: data.backend, database: data.database,
    diagnosticHistory: data.diagnosticHistory, incidentHistory: data.incidentHistory });
}

function readObservation(value: unknown, system: Readonly<SupportBundleDesktopSystem>): SupportBundleDesktopObservation {
  if (!isPlainDataRecord(value)) return invalid();
  if (hasExactDataKeys(value, ['scope', 'status']) && value.scope === 'currentOperation' && value.status === 'unavailable') {
    return Object.freeze({ scope: 'currentOperation', status: 'unavailable' });
  }
  const data = record(value, ['scope', 'status', 'firstError', 'cleanupError']);
  if (data.scope !== 'currentOperation' || data.status !== 'available') return invalid();
  const firstError = readFailure(data.firstError, 'firstError', system);
  const cleanupError = readFailure(data.cleanupError, 'cleanupError', system);
  if (firstError === null && cleanupError === null) return invalid();
  if (firstError !== null && cleanupError !== null && (
    firstError.correlationId !== cleanupError.correlationId || firstError.runtimeInstanceId !== cleanupError.runtimeInstanceId ||
    operationKey(firstError) !== operationKey(cleanupError) || firstError.eventId === cleanupError.eventId
  )) return invalid();
  return Object.freeze({ scope: 'currentOperation', status: 'available', firstError, cleanupError });
}

function readFailure(
  value: unknown,
  role: 'firstError' | 'cleanupError',
  system: Readonly<SupportBundleDesktopSystem>,
): DesktopSupportFailureEvent | null {
  if (value === null) return null;
  if (!isPlainDataRecord(value) ||
      (!hasExactDataKeys(value, eventFields) && !hasExactDataKeys(value, [...eventFields, 'operationId']))) return invalid();
  const event = validateDesktopOperationalEvent(value);
  if ((event.eventName !== 'workspaceManagement.operationFailed' && event.eventName !== 'workspaceBackup.operationFailed' &&
      event.eventName !== 'workspaceBackup.cleanupFailed') ||
      !isSupportBundleTechnicalId(event.eventId) || event.appVersion !== system.appVersion || event.buildRevision !== system.buildRevision ||
      Object.entries(event).some(([key, field]) => value[key] !== field) || !timestamp(event.timestamp)) return invalid();
  const cleanup = event.eventName === 'workspaceBackup.cleanupFailed' ||
    (event.eventName === 'workspaceManagement.operationFailed' && event.stage === 'deleteCleanup');
  if ((role === 'cleanupError') !== cleanup) return invalid();
  if (event.eventName === 'workspaceManagement.operationFailed' && cleanup && event.errorCode !== 'WORKSPACE_DELETE_CLEANUP_FAILED') {
    return invalid();
  }
  return event;
}

function operationKey(event: DesktopSupportFailureEvent): string {
  return event.eventName === 'workspaceManagement.operationFailed' ? event.operationId : `workspace.${event.stage}`;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainDataRecord(value) || !hasExactDataKeys(value, keys)) return invalid();
  return value;
}

function version(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maximumVersionLength && isSemVer(value);
}

function timestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function invalid(): never { throw new Error('SUPPORT_BUNDLE_DESKTOP_DATA_INVALID'); }
