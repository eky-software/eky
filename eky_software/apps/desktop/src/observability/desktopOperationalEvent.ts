export type DesktopEventLevel = 'error' | 'info' | 'warn';
export type DesktopEventOutcome =
  | 'blocked'
  | 'failure'
  | 'success'
  | 'unknown';

export interface DesktopOperationalIdentity {
  appVersion: string;
  buildRevision: string;
  runtimeInstanceId: string;
}

export const desktopPermissionTypes = Object.freeze([
  'clipboard-read',
  'clipboard-sanitized-write',
  'display-capture',
  'fileSystem',
  'fullscreen',
  'geolocation',
  'idle-detection',
  'keyboardLock',
  'media',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'notifications',
  'openExternal',
  'pointerLock',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'window-management',
  'unknown',
] as const);
export type DesktopPermissionType =
  (typeof desktopPermissionTypes)[number];

export interface DesktopOperationalEventPayloadMap {
  'desktop.starting': Record<never, never>;
  'desktop.started': { durationMs?: number };
  'desktop.bootstrapFailed': FailureFields;
  'desktop.shutdownStarted': Record<never, never>;
  'desktop.shutdownCompleted': { durationMs?: number };
  'desktop.shutdownFailed': FailureFields;
  'backendProcess.starting': Record<never, never>;
  'backendProcess.started': { durationMs?: number };
  'backendProcess.healthFailed': FailureFields;
  'backendProcess.unexpectedExit': FailureFields;
  'backendProcess.stopFailed': FailureFields;
  'applicationWindow.loadFailed': FailureFields;
  'applicationWindow.renderProcessGone': FailureFields;
  'applicationWindow.navigationBlocked': { stage?: string };
  'applicationWindow.newWindowBlocked': { stage?: string };
  'electron.permissionDenied': { stage?: string };
  'electron.permissionRequestBlocked': {
    frameClass: 'mainFrame' | 'subFrame' | 'unknown';
    originClass: 'eky' | 'external' | 'unknown';
    permissionType: DesktopPermissionType;
    stage: 'request';
  };
  'pdfPreview.openFailed': { entityId?: string; entityType?: string } & FailureFields;
  'secretStorage.decryptFailed': FailureFields;
  'secretStorage.writeFailed': FailureFields;
  'packagedSmoke.started': Record<never, never>;
  'packagedSmoke.completed': { durationMs?: number };
  'packagedSmoke.failed': FailureFields;
  'operationalLog.capacityReached': { stage: string };
  'operationalLog.retentionCompleted': {
    deletedByteCount: number;
    deletedFileCount: number;
    oldestRemainingMonth?: string;
  };
  'operationalLog.writeFailed': { errorCode: string; stage?: string };
  'operationalLogFolder.opened': {
    durationMs: number;
    stage: string;
  };
  'operationalLogFolder.openFailed': FailureFields;
  'operationalLogFolder.requestBlocked': FailureFields;
  'supportBundle.creationStarted': {
    correlationId: string;
    stage?: string;
  };
  'supportBundle.creationCompleted': {
    correlationId: string;
    durationMs?: number;
    stage?: string;
  };
  'supportBundle.creationFailed': FailureFields & {
    correlationId: string;
  };
}

interface FailureFields {
  durationMs?: number;
  errorCode: string;
  fingerprint?: string;
  retryable?: boolean;
  sideEffectState?: 'committed' | 'none' | 'rolledBack' | 'unknown';
  stage?: string;
}

export type DesktopOperationalEventName =
  keyof DesktopOperationalEventPayloadMap;

export type DesktopOperationalEventInput = {
  [Name in DesktopOperationalEventName]: Readonly<
    { eventName: Name } & DesktopOperationalEventPayloadMap[Name]
  >;
}[DesktopOperationalEventName];

interface DesktopOperationalEventCore extends DesktopOperationalIdentity {
  category: string;
  component: 'desktop';
  eventId: string;
  eventName: DesktopOperationalEventName;
  level: DesktopEventLevel;
  outcome: DesktopEventOutcome;
  schemaVersion: 1;
  timestamp: string;
}

export type DesktopOperationalEventFor<
  Name extends DesktopOperationalEventName,
> = Readonly<
  Omit<DesktopOperationalEventCore, 'eventName'> &
    { eventName: Name } &
    DesktopOperationalEventPayloadMap[Name]
>;

export type DesktopOperationalEvent = {
  [Name in DesktopOperationalEventName]: DesktopOperationalEventFor<Name>;
}[DesktopOperationalEventName];

export interface DesktopOperationalEventSpec {
  category: string;
  level: DesktopEventLevel;
  outcome: DesktopEventOutcome;
  payloadFields: readonly string[];
}

const failureFields = [
  'durationMs',
  'errorCode',
  'fingerprint',
  'retryable',
  'sideEffectState',
  'stage',
] as const;

export const desktopOperationalEventSpecs = Object.freeze({
  'desktop.starting': spec('runtime', 'info', 'success'),
  'desktop.started': spec('runtime', 'info', 'success', ['durationMs']),
  'desktop.bootstrapFailed': spec(
    'runtime',
    'error',
    'failure',
    failureFields,
  ),
  'desktop.shutdownStarted': spec('runtime', 'info', 'success'),
  'desktop.shutdownCompleted': spec('runtime', 'info', 'success', ['durationMs']),
  'desktop.shutdownFailed': spec('runtime', 'error', 'failure', failureFields),
  'backendProcess.starting': spec('backendProcess', 'info', 'success'),
  'backendProcess.started': spec('backendProcess', 'info', 'success', [
    'durationMs',
  ]),
  'backendProcess.healthFailed': spec(
    'backendProcess',
    'error',
    'failure',
    failureFields,
  ),
  'backendProcess.unexpectedExit': spec(
    'backendProcess',
    'error',
    'failure',
    failureFields,
  ),
  'backendProcess.stopFailed': spec(
    'backendProcess',
    'error',
    'failure',
    failureFields,
  ),
  'applicationWindow.loadFailed': spec(
    'applicationWindow',
    'error',
    'failure',
    failureFields,
  ),
  'applicationWindow.renderProcessGone': spec(
    'applicationWindow',
    'error',
    'failure',
    failureFields,
  ),
  'applicationWindow.navigationBlocked': spec(
    'security',
    'warn',
    'blocked',
    ['stage'],
  ),
  'applicationWindow.newWindowBlocked': spec(
    'security',
    'warn',
    'blocked',
    ['stage'],
  ),
  'electron.permissionDenied': spec('security', 'warn', 'blocked', ['stage']),
  'electron.permissionRequestBlocked': spec(
    'security',
    'warn',
    'blocked',
    ['frameClass', 'originClass', 'permissionType', 'stage'],
  ),
  'pdfPreview.openFailed': spec('pdfPreview', 'error', 'failure', [
    ...failureFields,
    'entityId',
    'entityType',
  ]),
  'secretStorage.decryptFailed': spec(
    'secretStorage',
    'error',
    'failure',
    failureFields,
  ),
  'secretStorage.writeFailed': spec(
    'secretStorage',
    'error',
    'failure',
    failureFields,
  ),
  'packagedSmoke.started': spec('packagedSmoke', 'info', 'success'),
  'packagedSmoke.completed': spec('packagedSmoke', 'info', 'success', [
    'durationMs',
  ]),
  'packagedSmoke.failed': spec(
    'packagedSmoke',
    'error',
    'failure',
    failureFields,
  ),
  'operationalLog.capacityReached': spec(
    'operationalLog',
    'warn',
    'failure',
    ['stage'],
  ),
  'operationalLog.retentionCompleted': spec(
    'operationalLog',
    'info',
    'success',
    ['deletedByteCount', 'deletedFileCount', 'oldestRemainingMonth'],
  ),
  'operationalLog.writeFailed': spec(
    'operationalLog',
    'error',
    'failure',
    ['errorCode', 'stage'],
  ),
  'operationalLogFolder.opened': spec(
    'operationalLogFolder',
    'info',
    'success',
    ['durationMs', 'stage'],
  ),
  'operationalLogFolder.openFailed': spec(
    'operationalLogFolder',
    'error',
    'failure',
    failureFields,
  ),
  'operationalLogFolder.requestBlocked': spec(
    'security',
    'warn',
    'blocked',
    failureFields,
  ),
  'supportBundle.creationStarted': spec(
    'supportBundle',
    'info',
    'success',
    ['correlationId', 'stage'],
  ),
  'supportBundle.creationCompleted': spec(
    'supportBundle',
    'info',
    'success',
    ['correlationId', 'durationMs', 'stage'],
  ),
  'supportBundle.creationFailed': spec(
    'supportBundle',
    'error',
    'failure',
    ['correlationId', ...failureFields],
  ),
} satisfies Record<DesktopOperationalEventName, DesktopOperationalEventSpec>);

export const desktopRequiredPayloadFields = Object.freeze({
  'desktop.starting': [],
  'desktop.started': [],
  'desktop.bootstrapFailed': ['errorCode'],
  'desktop.shutdownStarted': [],
  'desktop.shutdownCompleted': [],
  'desktop.shutdownFailed': ['errorCode'],
  'backendProcess.starting': [],
  'backendProcess.started': [],
  'backendProcess.healthFailed': ['errorCode'],
  'backendProcess.unexpectedExit': ['errorCode'],
  'backendProcess.stopFailed': ['errorCode'],
  'applicationWindow.loadFailed': ['errorCode'],
  'applicationWindow.renderProcessGone': ['errorCode'],
  'applicationWindow.navigationBlocked': [],
  'applicationWindow.newWindowBlocked': [],
  'electron.permissionDenied': [],
  'electron.permissionRequestBlocked': [
    'frameClass',
    'originClass',
    'permissionType',
    'stage',
  ],
  'pdfPreview.openFailed': ['errorCode'],
  'secretStorage.decryptFailed': ['errorCode'],
  'secretStorage.writeFailed': ['errorCode'],
  'packagedSmoke.started': [],
  'packagedSmoke.completed': [],
  'packagedSmoke.failed': ['errorCode'],
  'operationalLog.capacityReached': ['stage'],
  'operationalLog.retentionCompleted': [
    'deletedByteCount',
    'deletedFileCount',
  ],
  'operationalLog.writeFailed': ['errorCode'],
  'operationalLogFolder.opened': ['durationMs', 'stage'],
  'operationalLogFolder.openFailed': ['errorCode', 'stage'],
  'operationalLogFolder.requestBlocked': ['errorCode', 'stage'],
  'supportBundle.creationStarted': ['correlationId'],
  'supportBundle.creationCompleted': ['correlationId'],
  'supportBundle.creationFailed': ['correlationId', 'errorCode'],
} satisfies Record<DesktopOperationalEventName, readonly string[]>);

function spec(
  category: string,
  level: DesktopEventLevel,
  outcome: DesktopEventOutcome,
  payloadFields: readonly string[] = [],
): DesktopOperationalEventSpec {
  return Object.freeze({ category, level, outcome, payloadFields });
}
