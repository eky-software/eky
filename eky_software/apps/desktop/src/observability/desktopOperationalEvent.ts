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

export const recoveryPointKinds = Object.freeze([
  'daily',
  'manual',
  'monthly',
  'preRestore',
  'preUpdate',
  'weekly',
] as const);
export type RecoveryPointOperationalKind =
  (typeof recoveryPointKinds)[number];

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
  'invoicePdfArchive.taskQueued': Record<never, never>;
  'invoicePdfArchive.copySucceeded': {
    attemptCount: number;
    durationMs: number;
  };
  'invoicePdfArchive.copyFailed': FailureFields & {
    attemptCount: number;
  };
  'invoicePdfArchive.configurationChanged': {
    stage: 'disabled' | 'enabled';
  };
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
  'backup.started': {
    correlationId: string;
    stage: 'portable';
  };
  'backup.completed': {
    correlationId: string;
    durationMs?: number;
    stage: 'portable';
  };
  'backup.failed': FailureFields & {
    correlationId: string;
    stage: 'portable';
  };
  'backup.inspectionCompleted': {
    correlationId: string;
    durationMs?: number;
    stage: 'portable';
  };
  'backup.inspectionFailed': FailureFields & {
    correlationId: string;
    stage: 'portable';
  };
  'recoveryPoint.started': {
    correlationId: string;
    recoveryPointKind: RecoveryPointOperationalKind;
    stage: 'creation';
  };
  'recoveryPoint.completed': {
    correlationId: string;
    durationMs?: number;
    recoveryPointKind: RecoveryPointOperationalKind;
    stage: 'creation';
  };
  'recoveryPoint.failed': FailureFields & {
    correlationId: string;
    recoveryPointKind?: RecoveryPointOperationalKind;
    stage: 'automaticCheck' | 'creation';
  };
  'restore.inspectionCompleted': {
    correlationId: string;
    durationMs?: number;
    stage: 'inspection';
  };
  'restore.inspectionFailed': FailureFields & {
    correlationId: string;
    stage: 'inspection';
  };
  'restore.stagingCompleted': {
    correlationId: string;
    durationMs?: number;
    stage: 'staging';
  };
  'restore.stagingFailed': FailureFields & {
    correlationId: string;
    stage: 'staging';
  };
  'restore.activationStarted': {
    correlationId: string;
    stage: 'activation';
  };
  'restore.activationFailed': FailureFields & {
    correlationId: string;
    stage: 'activation';
  };
  'restore.validationCompleted': {
    correlationId: string;
    durationMs?: number;
    stage: 'restoredProfile' | 'rolledBackProfile';
  };
  'restore.validationFailed': FailureFields & {
    correlationId: string;
    stage: 'restoredProfile' | 'rolledBackProfile';
  };
  'restore.rollbackStarted': {
    correlationId: string;
    stage: 'activationRollback' | 'startupRollback';
  };
  'restore.rollbackCompleted': {
    correlationId: string;
    durationMs?: number;
    stage: 'activationRollback' | 'startupRollback';
  };
  'restore.rollbackFailed': FailureFields & {
    correlationId: string;
    stage: 'activationRollback' | 'startupRollback';
  };
  'restore.recoveryRequired': FailureFields & {
    correlationId: string;
    stage:
      | 'activationRollback'
      | 'failedSafeJournal'
      | 'rolledBackProfile'
      | 'startupRollback';
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
  'invoicePdfArchive.taskQueued': spec(
    'invoicePdfArchive',
    'info',
    'success',
  ),
  'invoicePdfArchive.copySucceeded': spec(
    'invoicePdfArchive',
    'info',
    'success',
    ['attemptCount', 'durationMs'],
  ),
  'invoicePdfArchive.copyFailed': spec(
    'invoicePdfArchive',
    'warn',
    'failure',
    ['attemptCount', ...failureFields],
  ),
  'invoicePdfArchive.configurationChanged': spec(
    'invoicePdfArchive',
    'info',
    'success',
    ['stage'],
  ),
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
  'backup.started': spec('backup', 'info', 'success', [
    'correlationId',
    'stage',
  ]),
  'backup.completed': spec('backup', 'info', 'success', [
    'correlationId',
    'durationMs',
    'stage',
  ]),
  'backup.failed': spec('backup', 'error', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'backup.inspectionCompleted': spec('backup', 'info', 'success', [
    'correlationId',
    'durationMs',
    'stage',
  ]),
  'backup.inspectionFailed': spec('backup', 'warn', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'recoveryPoint.started': spec('recoveryPoint', 'info', 'success', [
    'correlationId',
    'recoveryPointKind',
    'stage',
  ]),
  'recoveryPoint.completed': spec('recoveryPoint', 'info', 'success', [
    'correlationId',
    'durationMs',
    'recoveryPointKind',
    'stage',
  ]),
  'recoveryPoint.failed': spec('recoveryPoint', 'warn', 'failure', [
    'correlationId',
    'recoveryPointKind',
    ...failureFields,
  ]),
  'restore.inspectionCompleted': spec('restore', 'info', 'success', [
    'correlationId',
    'durationMs',
    'stage',
  ]),
  'restore.inspectionFailed': spec('restore', 'warn', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'restore.stagingCompleted': spec('restore', 'info', 'success', [
    'correlationId',
    'durationMs',
    'stage',
  ]),
  'restore.stagingFailed': spec('restore', 'error', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'restore.activationStarted': spec('restore', 'info', 'success', [
    'correlationId',
    'stage',
  ]),
  'restore.activationFailed': spec('restore', 'error', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'restore.validationCompleted': spec('restore', 'info', 'success', [
    'correlationId',
    'durationMs',
    'stage',
  ]),
  'restore.validationFailed': spec('restore', 'error', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'restore.rollbackStarted': spec('restore', 'warn', 'success', [
    'correlationId',
    'stage',
  ]),
  'restore.rollbackCompleted': spec('restore', 'warn', 'success', [
    'correlationId',
    'durationMs',
    'stage',
  ]),
  'restore.rollbackFailed': spec('restore', 'error', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
  'restore.recoveryRequired': spec('restore', 'error', 'failure', [
    'correlationId',
    ...failureFields,
  ]),
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
  'invoicePdfArchive.taskQueued': [],
  'invoicePdfArchive.copySucceeded': ['attemptCount', 'durationMs'],
  'invoicePdfArchive.copyFailed': ['attemptCount', 'errorCode'],
  'invoicePdfArchive.configurationChanged': ['stage'],
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
  'backup.started': ['correlationId', 'stage'],
  'backup.completed': ['correlationId', 'stage'],
  'backup.failed': ['correlationId', 'errorCode', 'stage'],
  'backup.inspectionCompleted': ['correlationId', 'stage'],
  'backup.inspectionFailed': ['correlationId', 'errorCode', 'stage'],
  'recoveryPoint.started': [
    'correlationId',
    'recoveryPointKind',
    'stage',
  ],
  'recoveryPoint.completed': [
    'correlationId',
    'recoveryPointKind',
    'stage',
  ],
  'recoveryPoint.failed': ['correlationId', 'errorCode', 'stage'],
  'restore.inspectionCompleted': ['correlationId', 'stage'],
  'restore.inspectionFailed': ['correlationId', 'errorCode', 'stage'],
  'restore.stagingCompleted': ['correlationId', 'stage'],
  'restore.stagingFailed': ['correlationId', 'errorCode', 'stage'],
  'restore.activationStarted': ['correlationId', 'stage'],
  'restore.activationFailed': [
    'correlationId',
    'durationMs',
    'errorCode',
    'retryable',
    'sideEffectState',
    'stage',
  ],
  'restore.validationCompleted': ['correlationId', 'stage'],
  'restore.validationFailed': ['correlationId', 'errorCode', 'stage'],
  'restore.rollbackStarted': ['correlationId', 'stage'],
  'restore.rollbackCompleted': ['correlationId', 'stage'],
  'restore.rollbackFailed': ['correlationId', 'errorCode', 'stage'],
  'restore.recoveryRequired': [
    'correlationId',
    'errorCode',
    'retryable',
    'sideEffectState',
    'stage',
  ],
} satisfies Record<DesktopOperationalEventName, readonly string[]>);

function spec(
  category: string,
  level: DesktopEventLevel,
  outcome: DesktopEventOutcome,
  payloadFields: readonly string[] = [],
): DesktopOperationalEventSpec {
  return Object.freeze({ category, level, outcome, payloadFields });
}
