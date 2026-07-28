import type { BackendOperationalEvent } from '../../../observability/operationalEvent.js';
import { validateBackendOperationalEvent } from '../../../observability/operationalEventValidator.js';
import type {
  DiagnosticEventItem,
  DiagnosticEventLevel,
  DiagnosticEventOutcome,
  DiagnosticEventSideEffectState,
} from '../domain/diagnosticEventItem.js';

interface DesktopDiagnosticSpec {
  category: string;
  level: DiagnosticEventLevel;
  outcome: DiagnosticEventOutcome;
}

const desktopDiagnosticSpecs = Object.freeze({
  'applicationWindow.loadFailed': spec(
    'applicationWindow',
    'error',
    'failure',
  ),
  'applicationWindow.navigationBlocked': spec(
    'security',
    'warn',
    'blocked',
  ),
  'applicationWindow.newWindowBlocked': spec(
    'security',
    'warn',
    'blocked',
  ),
  'applicationWindow.renderProcessGone': spec(
    'applicationWindow',
    'error',
    'failure',
  ),
  'backendProcess.healthFailed': spec(
    'backendProcess',
    'error',
    'failure',
  ),
  'backendProcess.started': spec('backendProcess', 'info', 'success'),
  'backendProcess.starting': spec('backendProcess', 'info', 'success'),
  'backendProcess.stopFailed': spec('backendProcess', 'error', 'failure'),
  'backendProcess.unexpectedExit': spec(
    'backendProcess',
    'error',
    'failure',
  ),
  'desktop.shutdownCompleted': spec('runtime', 'info', 'success'),
  'desktop.shutdownFailed': spec('runtime', 'error', 'failure'),
  'desktop.shutdownStarted': spec('runtime', 'info', 'success'),
  'desktop.started': spec('runtime', 'info', 'success'),
  'desktop.starting': spec('runtime', 'info', 'success'),
  'desktop.bootstrapFailed': spec('runtime', 'error', 'failure'),
  'electron.permissionDenied': spec('security', 'warn', 'blocked'),
  'electron.permissionRequestBlocked': spec(
    'security',
    'warn',
    'blocked',
  ),
  'operationalLog.capacityReached': spec(
    'operationalLog',
    'warn',
    'failure',
  ),
  'operationalLog.retentionCompleted': spec(
    'operationalLog',
    'info',
    'success',
  ),
  'operationalLog.writeFailed': spec(
    'operationalLog',
    'error',
    'failure',
  ),
  'operationalLogFolder.opened': spec(
    'operationalLogFolder',
    'info',
    'success',
  ),
  'operationalLogFolder.openFailed': spec(
    'operationalLogFolder',
    'error',
    'failure',
  ),
  'operationalLogFolder.requestBlocked': spec(
    'security',
    'warn',
    'blocked',
  ),
  'packagedSmoke.completed': spec('packagedSmoke', 'info', 'success'),
  'packagedSmoke.failed': spec('packagedSmoke', 'error', 'failure'),
  'packagedSmoke.started': spec('packagedSmoke', 'info', 'success'),
  'pdfPreview.openFailed': spec('pdfPreview', 'error', 'failure'),
  'secretStorage.decryptFailed': spec(
    'secretStorage',
    'error',
    'failure',
  ),
  'secretStorage.writeFailed': spec('secretStorage', 'error', 'failure'),
  'supportBundle.creationCompleted': spec(
    'supportBundle',
    'info',
    'success',
  ),
  'supportBundle.creationFailed': spec(
    'supportBundle',
    'error',
    'failure',
  ),
  'supportBundle.creationStarted': spec(
    'supportBundle',
    'info',
    'success',
  ),
} satisfies Record<string, DesktopDiagnosticSpec>);

const allowedDesktopFields = new Set([
  'appVersion',
  'buildRevision',
  'category',
  'component',
  'correlationId',
  'deletedByteCount',
  'deletedFileCount',
  'durationMs',
  'entityId',
  'entityType',
  'errorCode',
  'eventId',
  'eventName',
  'fingerprint',
  'frameClass',
  'level',
  'oldestRemainingMonth',
  'outcome',
  'originClass',
  'permissionType',
  'retryable',
  'runtimeInstanceId',
  'schemaVersion',
  'sideEffectState',
  'stage',
  'timestamp',
]);
const forbiddenKeyPattern =
  /(password|secret|token|cookie|authorization|requestbody|responsebody|mime|emailbody|iban|connectionstring|stack|message|details)/i;
const safeIdentifierPattern = /^[A-Za-z0-9._:-]+$/;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const buildRevisionPattern = /^(?:[0-9a-f]{7,40}|development)$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumEventBytes = 16 * 1024;

export function projectDiagnosticOperationalEvent(
  value: unknown,
): DiagnosticEventItem | null {
  try {
    if (!isRecord(value)) {
      return null;
    }

    if (value.component === 'backend') {
      return projectBackendEvent(validateBackendOperationalEvent(value));
    }
    if (value.component === 'desktop') {
      return projectDesktopEvent(validateDesktopEvent(value));
    }
    return null;
  } catch {
    return null;
  }
}

function projectBackendEvent(
  event: BackendOperationalEvent,
): DiagnosticEventItem {
  return {
    ...projectSafeTechnicalContext(event, event.eventName),
    category: event.category,
    component: 'backend',
    errorCode: readErrorCode(event),
    eventName: event.eventName,
    id: `backend:${event.eventId}`,
    level: event.level,
    occurredAt: event.timestamp,
    outcome: event.outcome,
  };
}

function projectDesktopEvent(
  event: Record<string, unknown>,
): DiagnosticEventItem {
  return {
    ...projectSafeTechnicalContext(event),
    category: event.category as string,
    component: 'desktop',
    errorCode: readErrorCode(event),
    eventName: event.eventName as string,
    id: `desktop:${event.eventId as string}`,
    level: event.level as DiagnosticEventLevel,
    occurredAt: event.timestamp as string,
    outcome: event.outcome as DiagnosticEventOutcome,
  };
}

function projectSafeTechnicalContext(
  event: Record<string, unknown>,
  eventName?: string,
): Partial<DiagnosticEventItem> {
  const isSmtpTransportEvent =
    eventName === 'smtp.connectionSecured' ||
    eventName === 'smtp.deliveryCompleted';

  return {
    ...(isSafeVersion(event.appVersion)
      ? { appVersion: event.appVersion }
      : {}),
    ...(typeof event.buildRevision === 'string' &&
    buildRevisionPattern.test(event.buildRevision)
      ? { buildRevision: event.buildRevision }
      : {}),
    ...(isSafeIdentifier(event.cipherName, 100)
      ? { cipherName: event.cipherName }
      : {}),
    ...(isUuid(event.correlationId)
      ? { correlationId: event.correlationId }
      : {}),
    ...(isNonNegativeInteger(event.durationMs)
      ? { durationMs: event.durationMs }
      : {}),
    ...(isSafeIdentifier(event.fingerprint, 300)
      ? { fingerprint: event.fingerprint }
      : {}),
    ...(!isSmtpTransportEvent &&
    isSafeIdentifier(event.operationId, 300)
      ? { operationId: event.operationId }
      : {}),
    ...(isCertificateFingerprint256(
      event.peerCertificateFingerprint256,
    )
      ? {
          peerCertificateFingerprint256:
            event.peerCertificateFingerprint256,
        }
      : {}),
    ...(typeof event.retryable === 'boolean'
      ? { retryable: event.retryable }
      : {}),
    ...(isUuid(event.runtimeInstanceId)
      ? { runtimeInstanceId: event.runtimeInstanceId }
      : {}),
    ...(isSideEffectState(event.sideEffectState)
      ? { sideEffectState: event.sideEffectState }
      : {}),
    ...(isSafeIdentifier(event.stage, 300) ? { stage: event.stage } : {}),
    ...(event.smtpProfile === 'dnaSmtp'
      ? { smtpProfile: event.smtpProfile }
      : {}),
    ...(event.tlsVersion === 'TLSv1.2' ||
    event.tlsVersion === 'TLSv1.3'
      ? { tlsVersion: event.tlsVersion }
      : {}),
  };
}

function isCertificateFingerprint256(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value)
  );
}

function validateDesktopEvent(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maximumEventBytes) {
    throw new Error('Diagnostic event is too large.');
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (
      forbiddenKeyPattern.test(key) ||
      !allowedDesktopFields.has(key) ||
      !isSafeDesktopField(key, fieldValue)
    ) {
      throw new Error('Diagnostic event is invalid.');
    }
  }

  if (
    typeof value.eventName !== 'string' ||
    !(value.eventName in desktopDiagnosticSpecs)
  ) {
    throw new Error('Diagnostic event name is unsupported.');
  }

  const eventSpec =
    desktopDiagnosticSpecs[
      value.eventName as keyof typeof desktopDiagnosticSpecs
    ];
  if (
    value.schemaVersion !== 1 ||
    value.component !== 'desktop' ||
    value.category !== eventSpec.category ||
    value.level !== eventSpec.level ||
    value.outcome !== eventSpec.outcome ||
    !isSafeIdentifier(value.eventId, 200) ||
    !isSafeVersion(value.appVersion) ||
    typeof value.buildRevision !== 'string' ||
    !buildRevisionPattern.test(value.buildRevision) ||
    typeof value.runtimeInstanceId !== 'string' ||
    !uuidPattern.test(value.runtimeInstanceId) ||
    !isTimestamp(value.timestamp)
  ) {
    throw new Error('Diagnostic event core is invalid.');
  }

  return value;
}

function isSafeDesktopField(key: string, value: unknown): boolean {
  if (
    key === 'durationMs' ||
    key === 'deletedByteCount' ||
    key === 'deletedFileCount'
  ) {
    return (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    );
  }
  if (key === 'retryable') {
    return typeof value === 'boolean';
  }
  if (key === 'schemaVersion') {
    return value === 1;
  }
  if (key === 'sideEffectState') {
    return (
      typeof value === 'string' &&
      ['committed', 'none', 'rolledBack', 'unknown'].includes(value)
    );
  }
  if (key === 'oldestRemainingMonth') {
    return typeof value === 'string' && monthPattern.test(value);
  }
  if (key === 'timestamp') {
    return isTimestamp(value);
  }
  if (key === 'appVersion') {
    return isSafeVersion(value);
  }
  if (key === 'buildRevision') {
    return typeof value === 'string' && buildRevisionPattern.test(value);
  }
  if (key === 'runtimeInstanceId') {
    return typeof value === 'string' && uuidPattern.test(value);
  }
  if (
    key === 'component' ||
    key === 'category' ||
    key === 'eventName' ||
    key === 'level' ||
    key === 'outcome'
  ) {
    return typeof value === 'string' && value.length <= 100;
  }
  return isSafeIdentifier(value, 300);
}

function readErrorCode(value: unknown): string | null {
  return isRecord(value) && typeof value.errorCode === 'string'
    ? value.errorCode
    : null;
}

function isSafeIdentifier(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    safeIdentifierPattern.test(value)
  );
}

function isSafeVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9.+_-]+$/.test(value)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isSideEffectState(
  value: unknown,
): value is DiagnosticEventSideEffectState {
  return (
    typeof value === 'string' &&
    ['committed', 'none', 'rolledBack', 'unknown'].includes(value)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isTimestamp(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function spec(
  category: string,
  level: DiagnosticEventLevel,
  outcome: DiagnosticEventOutcome,
): DesktopDiagnosticSpec {
  return { category, level, outcome };
}
