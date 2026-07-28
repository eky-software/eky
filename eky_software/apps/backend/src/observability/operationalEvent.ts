export type OperationalEventLevel = 'error' | 'info' | 'warn';
export type OperationalEventOutcome =
  | 'blocked'
  | 'failure'
  | 'success'
  | 'unknown';
export type OperationalSideEffectState =
  | 'committed'
  | 'none'
  | 'rolledBack'
  | 'unknown';

export interface OperationalRuntimeIdentity {
  appVersion: string;
  buildRevision: string;
  runtimeInstanceId: string;
}

export interface BackendOperationalEventPayloadMap {
  'backend.starting': Record<never, never>;
  'backend.started': { durationMs?: number };
  'backend.shutdownStarted': Record<never, never>;
  'backend.shutdownCompleted': { durationMs?: number };
  'database.opening': Record<never, never>;
  'database.opened': { durationMs?: number };
  'database.openFailed': FailureFields;
  'database.integrityCheckFailed': FailureFields;
  'migration.started': { stage?: string };
  'migration.completed': { durationMs?: number; stage?: string };
  'migration.failed': FailureFields;
  'http.requestFailed': FailureFields;
  'http.unknownRoute': { correlationId: string; stage?: string };
  'http.invalidBody': { correlationId: string; stage?: string };
  'permission.denied': {
    actorUserId?: string;
    companyId?: string;
    correlationId: string;
    stage?: string;
  };
  'tenant.boundaryBlocked': {
    actorUserId?: string;
    companyId?: string;
    correlationId: string;
    entityType?: string;
    stage?: string;
  };
  'runtimeSession.missing': { correlationId: string };
  'runtimeSession.invalid': { correlationId: string };
  'invoicePdf.generationFailed': EntityFailureFields;
  'invoicePdf.storageFailed': EntityFailureFields;
  'invoicePdf.missingFile': EntityFailureFields;
  'invoiceDelivery.prepareBlocked': EntityFailureFields;
  'invoiceDelivery.providerFailed': EntityFailureFields;
  'invoiceDelivery.outcomeUnknown': EntityFailureFields;
  'invoiceDelivery.finalizationFailed': EntityFailureFields;
  'smtp.connectionFailed': FailureFields;
  'smtp.connectionSecured': SmtpTransportDiagnosticFields;
  'smtp.tlsFailed': FailureFields;
  'smtp.authenticationFailed': FailureFields;
  'smtp.deliveryCompleted': SmtpTransportDiagnosticFields;
  'smtp.deliveryFailed': EntityFailureFields;
  'smtp.deliveryOutcomeUnknown': EntityFailureFields;
  'businessAudit.writeFailed': EntityFailureFields;
  'businessAudit.retentionCompleted': {
    deletedEventCount: number;
  };
  'businessAudit.retentionFailed': FailureFields;
  'supportBundle.creationStarted': { correlationId: string };
  'supportBundle.creationCompleted': {
    correlationId: string;
    durationMs?: number;
  };
  'supportBundle.creationFailed': FailureFields;
  'operationalLog.capacityReached': {
    stage: string;
  };
  'operationalLog.retentionCompleted': {
    deletedByteCount: number;
    deletedFileCount: number;
    oldestRemainingMonth?: string;
  };
}

interface FailureFields {
  correlationId?: string;
  durationMs?: number;
  errorCode: string;
  fingerprint?: string;
  retryable?: boolean;
  sideEffectState?: OperationalSideEffectState;
  stage?: string;
}

interface EntityFailureFields extends FailureFields {
  companyId?: string;
  entityId?: string;
  entityType?: string;
  operationId?: string;
}

interface SmtpTransportDiagnosticFields {
  cipherName: string;
  correlationId?: string;
  durationMs: number;
  operationId: string;
  peerCertificateFingerprint256: string;
  remoteAddress: string;
  remoteFamily: 'IPv4' | 'IPv6';
  smtpProfile: 'dnaSmtp';
  stage: string;
  targetPort: 465;
  tlsVersion: 'TLSv1.2' | 'TLSv1.3';
}

export type BackendOperationalEventName =
  keyof BackendOperationalEventPayloadMap;

export type BackendOperationalEventInput = {
  [Name in BackendOperationalEventName]: Readonly<
    { eventName: Name } & BackendOperationalEventPayloadMap[Name]
  >;
}[BackendOperationalEventName];

export interface BackendOperationalEventCore extends OperationalRuntimeIdentity {
  category: string;
  component: 'backend';
  eventId: string;
  eventName: BackendOperationalEventName;
  level: OperationalEventLevel;
  outcome: OperationalEventOutcome;
  schemaVersion: 1;
  timestamp: string;
}

export type BackendOperationalEventFor<
  Name extends BackendOperationalEventName,
> = Readonly<
  Omit<BackendOperationalEventCore, 'eventName'> &
    { eventName: Name } &
    BackendOperationalEventPayloadMap[Name]
>;

export type BackendOperationalEvent = {
  [Name in BackendOperationalEventName]: BackendOperationalEventFor<Name>;
}[BackendOperationalEventName];

export interface BackendOperationalEventSpec {
  category: string;
  level: OperationalEventLevel;
  outcome: OperationalEventOutcome;
  payloadFields: readonly string[];
}

const failureFields = [
  'correlationId',
  'durationMs',
  'errorCode',
  'fingerprint',
  'retryable',
  'sideEffectState',
  'stage',
] as const;
const entityFailureFields = [
  ...failureFields,
  'companyId',
  'entityId',
  'entityType',
  'operationId',
] as const;
const smtpTransportDiagnosticFields = [
  'cipherName',
  'correlationId',
  'durationMs',
  'operationId',
  'peerCertificateFingerprint256',
  'remoteAddress',
  'remoteFamily',
  'smtpProfile',
  'stage',
  'targetPort',
  'tlsVersion',
] as const;

export const backendOperationalEventSpecs = Object.freeze({
  'backend.starting': spec('runtime', 'info', 'success'),
  'backend.started': spec('runtime', 'info', 'success', ['durationMs']),
  'backend.shutdownStarted': spec('runtime', 'info', 'success'),
  'backend.shutdownCompleted': spec('runtime', 'info', 'success', ['durationMs']),
  'database.opening': spec('database', 'info', 'success'),
  'database.opened': spec('database', 'info', 'success', ['durationMs']),
  'database.openFailed': spec('database', 'error', 'failure', failureFields),
  'database.integrityCheckFailed': spec(
    'database',
    'error',
    'failure',
    failureFields,
  ),
  'migration.started': spec('migration', 'info', 'success', ['stage']),
  'migration.completed': spec('migration', 'info', 'success', [
    'durationMs',
    'stage',
  ]),
  'migration.failed': spec('migration', 'error', 'failure', failureFields),
  'http.requestFailed': spec('http', 'error', 'failure', failureFields),
  'http.unknownRoute': spec('http', 'warn', 'blocked', [
    'correlationId',
    'stage',
  ]),
  'http.invalidBody': spec('http', 'warn', 'blocked', [
    'correlationId',
    'stage',
  ]),
  'permission.denied': spec('authorization', 'warn', 'blocked', [
    'actorUserId',
    'companyId',
    'correlationId',
    'stage',
  ]),
  'tenant.boundaryBlocked': spec('authorization', 'warn', 'blocked', [
    'actorUserId',
    'companyId',
    'correlationId',
    'entityType',
    'stage',
  ]),
  'runtimeSession.missing': spec('security', 'warn', 'blocked', [
    'correlationId',
  ]),
  'runtimeSession.invalid': spec('security', 'warn', 'blocked', [
    'correlationId',
  ]),
  'invoicePdf.generationFailed': spec(
    'invoicePdf',
    'error',
    'failure',
    entityFailureFields,
  ),
  'invoicePdf.storageFailed': spec(
    'invoicePdf',
    'error',
    'failure',
    entityFailureFields,
  ),
  'invoicePdf.missingFile': spec(
    'invoicePdf',
    'warn',
    'failure',
    entityFailureFields,
  ),
  'invoiceDelivery.prepareBlocked': spec(
    'invoiceDelivery',
    'warn',
    'blocked',
    entityFailureFields,
  ),
  'invoiceDelivery.providerFailed': spec(
    'invoiceDelivery',
    'error',
    'failure',
    entityFailureFields,
  ),
  'invoiceDelivery.outcomeUnknown': spec(
    'invoiceDelivery',
    'error',
    'unknown',
    entityFailureFields,
  ),
  'invoiceDelivery.finalizationFailed': spec(
    'invoiceDelivery',
    'error',
    'failure',
    entityFailureFields,
  ),
  'smtp.connectionFailed': spec('smtp', 'error', 'failure', failureFields),
  'smtp.connectionSecured': spec(
    'smtp',
    'info',
    'success',
    smtpTransportDiagnosticFields,
  ),
  'smtp.tlsFailed': spec('smtp', 'error', 'failure', failureFields),
  'smtp.authenticationFailed': spec('smtp', 'error', 'failure', failureFields),
  'smtp.deliveryCompleted': spec(
    'smtp',
    'info',
    'success',
    smtpTransportDiagnosticFields,
  ),
  'smtp.deliveryFailed': spec(
    'smtp',
    'error',
    'failure',
    entityFailureFields,
  ),
  'smtp.deliveryOutcomeUnknown': spec(
    'smtp',
    'error',
    'unknown',
    entityFailureFields,
  ),
  'businessAudit.writeFailed': spec(
    'businessAudit',
    'error',
    'failure',
    entityFailureFields,
  ),
  'businessAudit.retentionCompleted': spec(
    'businessAudit',
    'info',
    'success',
    ['deletedEventCount'],
  ),
  'businessAudit.retentionFailed': spec(
    'businessAudit',
    'warn',
    'failure',
    failureFields,
  ),
  'supportBundle.creationStarted': spec('supportBundle', 'info', 'success', [
    'correlationId',
  ]),
  'supportBundle.creationCompleted': spec(
    'supportBundle',
    'info',
    'success',
    ['correlationId', 'durationMs'],
  ),
  'supportBundle.creationFailed': spec(
    'supportBundle',
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
    [
      'deletedByteCount',
      'deletedFileCount',
      'oldestRemainingMonth',
    ],
  ),
} satisfies Record<BackendOperationalEventName, BackendOperationalEventSpec>);

export const backendRequiredPayloadFields = Object.freeze({
  'backend.starting': [],
  'backend.started': [],
  'backend.shutdownStarted': [],
  'backend.shutdownCompleted': [],
  'database.opening': [],
  'database.opened': [],
  'database.openFailed': ['errorCode'],
  'database.integrityCheckFailed': ['errorCode'],
  'migration.started': [],
  'migration.completed': [],
  'migration.failed': ['errorCode'],
  'http.requestFailed': ['errorCode'],
  'http.unknownRoute': ['correlationId'],
  'http.invalidBody': ['correlationId'],
  'permission.denied': ['correlationId'],
  'tenant.boundaryBlocked': ['correlationId'],
  'runtimeSession.missing': ['correlationId'],
  'runtimeSession.invalid': ['correlationId'],
  'invoicePdf.generationFailed': ['errorCode'],
  'invoicePdf.storageFailed': ['errorCode'],
  'invoicePdf.missingFile': ['errorCode'],
  'invoiceDelivery.prepareBlocked': ['errorCode'],
  'invoiceDelivery.providerFailed': ['errorCode'],
  'invoiceDelivery.outcomeUnknown': ['errorCode'],
  'invoiceDelivery.finalizationFailed': ['errorCode'],
  'smtp.connectionFailed': ['errorCode'],
  'smtp.connectionSecured': [
    'cipherName',
    'durationMs',
    'operationId',
    'peerCertificateFingerprint256',
    'remoteAddress',
    'remoteFamily',
    'smtpProfile',
    'stage',
    'targetPort',
    'tlsVersion',
  ],
  'smtp.tlsFailed': ['errorCode'],
  'smtp.authenticationFailed': ['errorCode'],
  'smtp.deliveryCompleted': [
    'cipherName',
    'durationMs',
    'operationId',
    'peerCertificateFingerprint256',
    'remoteAddress',
    'remoteFamily',
    'smtpProfile',
    'stage',
    'targetPort',
    'tlsVersion',
  ],
  'smtp.deliveryFailed': ['errorCode'],
  'smtp.deliveryOutcomeUnknown': ['errorCode'],
  'businessAudit.writeFailed': ['errorCode'],
  'businessAudit.retentionCompleted': ['deletedEventCount'],
  'businessAudit.retentionFailed': ['errorCode'],
  'supportBundle.creationStarted': ['correlationId'],
  'supportBundle.creationCompleted': ['correlationId'],
  'supportBundle.creationFailed': ['errorCode'],
  'operationalLog.capacityReached': ['stage'],
  'operationalLog.retentionCompleted': [
    'deletedByteCount',
    'deletedFileCount',
  ],
} satisfies Record<BackendOperationalEventName, readonly string[]>);

function spec(
  category: string,
  level: OperationalEventLevel,
  outcome: OperationalEventOutcome,
  payloadFields: readonly string[] = [],
): BackendOperationalEventSpec {
  return Object.freeze({ category, level, outcome, payloadFields });
}
