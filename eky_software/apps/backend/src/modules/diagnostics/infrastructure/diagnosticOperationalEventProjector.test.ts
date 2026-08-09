import { describe, expect, it } from 'vitest';

import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';
import type { BackendOperationalEventName } from '../../../observability/operationalEvent.js';
import { projectDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';

const smtpEventNames = [
  'smtp.authenticationFailed',
  'smtp.connectionFailed',
  'smtp.connectionSecured',
  'smtp.deliveryCompleted',
  'smtp.deliveryFailed',
  'smtp.deliveryOutcomeUnknown',
  'smtp.tlsFailed',
] as const satisfies readonly BackendOperationalEventName[];

describe('projectDiagnosticOperationalEvent', () => {
  it.each(smtpEventNames)(
    'projects safe SMTP metadata without transport routing fields for %s',
    (eventName) => {
      const projection = projectDiagnosticOperationalEvent(
        createSmtpEvent(eventName),
      );

      expect(projection).toEqual(
        expect.objectContaining({
          cipherName: 'TLS_AES_256_GCM_SHA384',
          durationMs: 25,
          eventName,
          peerCertificateFingerprint256: expect.stringMatching(
            /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
          ),
          smtpProfile: 'dnaSmtp',
          stage: expect.any(String),
          tlsVersion: 'TLSv1.3',
        }),
      );
      expect(projection).not.toHaveProperty('operationId');
      expect(JSON.stringify(projection)).not.toContain('192.0.2.10');
      expect(projection).not.toHaveProperty('targetPort');
    },
  );

  it('keeps a non-SMTP operation id in the diagnostics read model', () => {
    const projection = projectDiagnosticOperationalEvent(
      createBackendOperationalEvent(
        {
          errorCode: 'PDF_FAILED',
          eventName: 'invoicePdf.generationFailed',
          operationId: 'invoice-pdf-operation',
        },
        eventOptions('non-smtp'),
      ),
    );

    expect(projection).toEqual(
      expect.objectContaining({
        operationId: 'invoice-pdf-operation',
      }),
    );
  });

  it('projects only allowlisted recovery metadata', () => {
    const event = createDesktopRecoveryEvent();

    expect(projectDiagnosticOperationalEvent(event)).toEqual(
      expect.objectContaining({
        correlationId: '22222222-2222-4222-8222-222222222222',
        eventName: 'recoveryPoint.completed',
        recoveryPointKind: 'preRestore',
        stage: 'creation',
      }),
    );
    expect(
      projectDiagnosticOperationalEvent({
        ...event,
        manifest: { entries: ['private'] },
      }),
    ).toBeNull();
    expect(
      projectDiagnosticOperationalEvent({
        ...event,
        stage: 'C:\\Users\\Example\\backup',
      }),
    ).toBeNull();
    expect(
      projectDiagnosticOperationalEvent({
        ...event,
        category: 'restore',
        eventName: 'restore.stagingCompleted',
        stage: 'staging',
      }),
    ).toBeNull();
  });

  it.each([
    {
      errorCode: undefined,
      eventName: 'backup.completed',
      level: 'info',
      outcome: 'success',
      retryable: undefined,
      sideEffectState: undefined,
    },
    {
      errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
      eventName: 'backup.failed',
      level: 'error',
      outcome: 'failure',
      retryable: true,
      sideEffectState: 'unknown',
    },
  ] as const)('projects safe portable backup metadata for $eventName', (fields) => {
    const event = createDesktopBackupEvent(fields);

    expect(projectDiagnosticOperationalEvent(event)).toEqual(
      expect.objectContaining({
        category: 'backup',
        correlationId: '33333333-3333-4333-8333-333333333333',
        durationMs: 42,
        eventName: fields.eventName,
        stage: 'portable',
      }),
    );
  });

  it.each([
    ['path', 'C:\\Users\\Example\\backup.ekybackup'],
    ['fileName', 'private-backup.ekybackup'],
    ['manifest', { entries: ['private'] }],
    ['password', 'not-a-real-secret'],
    ['key', 'not-a-real-key'],
    ['salt', 'not-a-real-salt'],
    ['nonce', 'not-a-real-nonce'],
    ['tag', 'not-a-real-tag'],
    ['profileId', 'profile-private'],
    ['companyId', 'company-private'],
    ['invoiceId', 'invoice-private'],
    ['documentId', 'document-private'],
    ['artifactId', 'artifact-private'],
    ['checksum', 'checksum-private'],
    ['metadata', { arbitrary: true }],
    ['customerName', 'Test Customer'],
    ['stack', 'synthetic stack'],
  ])('rejects backup field %s outside the closed projection', (field, value) => {
    expect(
      projectDiagnosticOperationalEvent({
        ...createDesktopBackupEvent({
          errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
          eventName: 'backup.failed',
          level: 'error',
          outcome: 'failure',
          retryable: true,
          sideEffectState: 'unknown',
        }),
        [field]: value,
      }),
    ).toBeNull();
  });

  it.each([
    {
      durationMs: 42,
      errorCode: 'PROFILE_RESTORE_ACTIVATION_FAILED',
      eventName: 'restore.activationFailed',
      stage: 'activation',
    },
    {
      durationMs: undefined,
      errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      eventName: 'restore.recoveryRequired',
      stage: 'failedSafeJournal',
    },
  ] as const)('projects closed restore metadata for $eventName', (fields) => {
    expect(
      projectDiagnosticOperationalEvent(
        createDesktopRestoreFailureEvent(fields),
      ),
    ).toEqual(
      expect.objectContaining({
        category: 'restore',
        correlationId: '44444444-4444-4444-8444-444444444444',
        errorCode: fields.errorCode,
        eventName: fields.eventName,
        retryable: false,
        sideEffectState: 'unknown',
        stage: fields.stage,
      }),
    );
  });

  it.each([
    ['journalPhase', 'failedSafe'],
    ['path', 'C:\\Users\\Example\\profile'],
    ['profileId', 'profile-private'],
    ['companyId', 'company-private'],
    ['manifest', { entries: ['private'] }],
    ['password', 'not-a-real-secret'],
  ])('rejects restore field %s outside the closed projection', (field, value) => {
    expect(
      projectDiagnosticOperationalEvent({
        ...createDesktopRestoreFailureEvent({
          durationMs: undefined,
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.recoveryRequired',
          stage: 'failedSafeJournal',
        }),
        [field]: value,
      }),
    ).toBeNull();
  });
});

function createDesktopRestoreFailureEvent(fields: {
  durationMs: number | undefined;
  errorCode:
    | 'PROFILE_RESTORE_ACTIVATION_FAILED'
    | 'PROFILE_RESTORE_RECOVERY_REQUIRED';
  eventName: 'restore.activationFailed' | 'restore.recoveryRequired';
  stage: 'activation' | 'failedSafeJournal';
}) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'restore',
    component: 'desktop',
    correlationId: '44444444-4444-4444-8444-444444444444',
    ...(fields.durationMs === undefined
      ? {}
      : { durationMs: fields.durationMs }),
    errorCode: fields.errorCode,
    eventId: `desktop-${fields.eventName}`,
    eventName: fields.eventName,
    level: 'error',
    outcome: 'failure',
    retryable: false,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    sideEffectState: 'unknown',
    stage: fields.stage,
    timestamp: '2026-08-09T20:00:00.000Z',
  };
}

function createDesktopBackupEvent(fields: {
  errorCode: string | undefined;
  eventName: 'backup.completed' | 'backup.failed';
  level: 'error' | 'info';
  outcome: 'failure' | 'success';
  retryable: boolean | undefined;
  sideEffectState: 'unknown' | undefined;
}) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'backup',
    component: 'desktop',
    correlationId: '33333333-3333-4333-8333-333333333333',
    durationMs: 42,
    ...(fields.errorCode === undefined
      ? {}
      : { errorCode: fields.errorCode }),
    eventId: `desktop-${fields.eventName}`,
    eventName: fields.eventName,
    level: fields.level,
    outcome: fields.outcome,
    ...(fields.retryable === undefined
      ? {}
      : { retryable: fields.retryable }),
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    ...(fields.sideEffectState === undefined
      ? {}
      : { sideEffectState: fields.sideEffectState }),
    stage: 'portable',
    timestamp: '2026-08-09T12:00:00.000Z',
  };
}

function createDesktopRecoveryEvent() {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'recoveryPoint',
    component: 'desktop',
    correlationId: '22222222-2222-4222-8222-222222222222',
    durationMs: 25,
    eventId: 'desktop-recovery-event',
    eventName: 'recoveryPoint.completed',
    level: 'info',
    outcome: 'success',
    recoveryPointKind: 'preRestore',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    stage: 'creation',
    timestamp: '2026-07-28T12:00:00.000Z',
  };
}

function createSmtpEvent(eventName: (typeof smtpEventNames)[number]) {
  const transportMetadata = {
    cipherName: 'TLS_AES_256_GCM_SHA384',
    durationMs: 25,
    operationId: 'smtp-attempt-must-not-be-returned',
    peerCertificateFingerprint256: Array.from(
      { length: 32 },
      (_, index) => index.toString(16).padStart(2, '0').toUpperCase(),
    ).join(':'),
    remoteAddress: '192.0.2.10',
    remoteFamily: 'IPv4' as const,
    smtpProfile: 'dnaSmtp' as const,
    targetPort: 465 as const,
    tlsVersion: 'TLSv1.3' as const,
  };

  switch (eventName) {
    case 'smtp.connectionSecured':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          eventName,
          stage: 'connect',
        },
        eventOptions(eventName),
      );
    case 'smtp.deliveryCompleted':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          eventName,
          stage: 'finalAcceptance',
        },
        eventOptions(eventName),
      );
    case 'smtp.deliveryOutcomeUnknown':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          errorCode: 'SMTP_DELIVERY_OUTCOME_UNKNOWN',
          eventName,
          retryable: false,
          sideEffectState: 'unknown',
          stage: 'finalAcceptance',
        },
        eventOptions(eventName),
      );
    case 'smtp.authenticationFailed':
    case 'smtp.connectionFailed':
    case 'smtp.deliveryFailed':
    case 'smtp.tlsFailed':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          errorCode: failureCode(eventName),
          eventName,
          retryable: eventName === 'smtp.connectionFailed',
          sideEffectState: 'none',
          stage:
            eventName === 'smtp.authenticationFailed'
              ? 'authenticate'
              : 'connect',
        },
        eventOptions(eventName),
      );
  }
}

function failureCode(
  eventName:
    | 'smtp.authenticationFailed'
    | 'smtp.connectionFailed'
    | 'smtp.deliveryFailed'
    | 'smtp.tlsFailed',
): string {
  switch (eventName) {
    case 'smtp.authenticationFailed':
      return 'SMTP_AUTHENTICATION_FAILED';
    case 'smtp.connectionFailed':
      return 'SMTP_CONNECTION_FAILED';
    case 'smtp.deliveryFailed':
      return 'SMTP_DATA_REJECTED';
    case 'smtp.tlsFailed':
      return 'SMTP_TLS_FAILED';
  }
}

function eventOptions(eventId: string) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    eventId,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    timestamp: '2026-07-28T12:00:00.000Z',
  };
}
