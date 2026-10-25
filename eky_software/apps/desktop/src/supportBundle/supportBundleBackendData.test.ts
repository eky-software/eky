import { describe, expect, it } from 'vitest';

import { workspaceCandidateFailureCauses } from '../runtime/workspaceCandidateMessages.js';
import { desktopOperationalEventSpecs } from '../observability/desktopOperationalEvent.js';
import { updateOperationalStages, type DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { createUpdateOperationalObserver } from '../update/updateOperationalObserver.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import { workspaceManagementOperationIds } from '../observability/workspaceManagementFailureContext.js';
import { desktopRecoveryEventStages } from '../observability/desktopOperationalEventValidator.js';
import { readSupportBundleBackendData } from './supportBundleBackendData.js';

describe('readSupportBundleBackendData', () => {
  it('revalidates every management failure combination using the real source validator', () => {
    const cases = Object.values(workspaceManagementOperationIds).flatMap(operationId => [
      { operationId, errorCode: `WORKSPACE_MANAGEMENT_${operationId.slice('workspace.'.length).toUpperCase()}_FAILED`, stage: 'operation' as const, retryable: false },
      { operationId, errorCode: 'WORKSPACE_MANAGEMENT_INVALID', stage: 'operation' as const, retryable: false },
      { operationId, errorCode: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', stage: 'operation' as const, retryable: false },
      { operationId, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'operation' as const, retryable: true },
      { operationId, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'admission' as const, retryable: true },
    ]);
    const lineage = { operationId: 'workspace.replace' as const, errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', stage: 'lineageCheck' as const, retryable: false };
    const read = (value: unknown) => readSupportBundleBackendData({ ...createValidData(), diagnosticEvents: [value] }).diagnosticEvents;
    const labelConflicts = [
      { operationId: 'workspace.create' as const, errorCode: 'WORKSPACE_CREATION_LABEL_EXISTS' },
      { operationId: 'workspace.import' as const, errorCode: 'WORKSPACE_IMPORT_LABEL_EXISTS' },
      ...(['workspace.create', 'workspace.import', 'workspace.rename'] as const).map(operationId => ({
        operationId, errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS',
      })),
    ].map(entry => ({ ...entry, stage: 'operation' as const, retryable: false }));
    for (const entry of [...cases, lineage, ...labelConflicts]) {
      const source = createDesktopOperationalEvent({
        ...entry, eventName: 'workspaceManagement.operationFailed',
        correlationId: '22222222-2222-4222-8222-222222222222', durationMs: 2, sideEffectState: 'unknown',
      }, { appVersion: '0.2.81', buildRevision: 'development', runtimeInstanceId: '11111111-1111-4111-8111-111111111111' });
      const { eventId, timestamp, schemaVersion: _schemaVersion, ...fields } = source;
      const event = { ...fields, id: `desktop:${eventId}`, occurredAt: timestamp };
      expect(read(event)).toEqual([event]);
      expect(read({ ...event, sideEffectState: 'none' })).toEqual([{ ...event, sideEffectState: 'none' }]);
      for (const change of [
        { component: 'backend' }, { category: 'backup' }, { level: 'warn' }, { outcome: 'success' },
        { correlationId: undefined }, { durationMs: undefined }, { operationId: undefined },
        { operationId: 'workspace.status' }, { operationId: 'synthetic-workspace-id' },
        { errorCode: 'unknown' }, { errorCode: 'PROFILE_SCHEMA_UNSUPPORTED' },
        { retryable: !entry.retryable }, { stage: 'status' }, { sideEffectState: 'completed' },
        { sideEffectState: 'committed' }, { sideEffectState: 'rolledBack' }, { sideEffectState: undefined },
        { fingerprint: 'synthetic-fingerprint' }, { cipherName: 'synthetic-cipher' },
        { recoveryPointKind: 'daily' }, { smtpProfile: 'dnaSmtp' }, { companyId: 'synthetic-company' },
        { rawError: 'synthetic-private' }, { path: '/synthetic/private' },
        { workspaceLabel: 'Synthetic' }, { workspaceId: 'synthetic-workspace-id' },
        { message: 'synthetic-private' }, { errorCode: 'WORKSPACE_LABEL_EXISTS' },
        ...(entry.errorCode.endsWith('_LABEL_EXISTS')
          ? [{ stage: 'admission' }, { stage: 'lineageCheck' },
            ...Object.values(workspaceManagementOperationIds).filter(operationId => entry.errorCode === 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'
              ? operationId === 'workspace.replace' || operationId === 'workspace.switch' : operationId !== entry.operationId)
              .map(operationId => ({ operationId }))] : []),
        ...(entry.errorCode.endsWith('_FAILED') || entry.stage === 'lineageCheck'
          ? [{ operationId: entry.operationId === 'workspace.create' ? 'workspace.replace' : 'workspace.create' }, { stage: 'admission' }] : []),
      ]) expect(() => read({ ...event, ...change })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
    }
  });

  it('revalidates every current update writer event and keeps warn-success rollback observations', () => {
    const written: DesktopOperationalEvent[] = [];
    const observer = createUpdateOperationalObserver({
      identity: { appVersion: '0.2.81', buildRevision: 'development',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
      logger: { write(event) { written.push(event); } },
    });
    const correlationId = '22222222-2222-4222-8222-222222222222';
    for (const stage of updateOperationalStages) {
      observer.operationStarted({ correlationId, stage });
      observer.operationCompleted({ correlationId, stage, durationMs: 2 });
      observer.operationFailed({ correlationId, stage, durationMs: 2,
        errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED', retryable: false, sideEffectState: 'unknown' });
      observer.operationStateChanged?.({ correlationId, stage, state: 'recoveryRequired' });
    }
    observer.operationStateChanged?.({ correlationId, stage: 'firstStartValidation', state: 'accepted' });
    observer.operationStateChanged?.({ correlationId, stage: 'firstStartValidation', state: 'installerNotApplied' });
    expect(written).toHaveLength(50);
    const names = Object.keys(desktopOperationalEventSpecs).filter(name => name.startsWith('update.'));
    expect(names).toHaveLength(42);
    expect(new Set(written.map(event => event.eventName))).toEqual(new Set(names.filter(name => !name.startsWith('update.operation'))));
    const read = (value: unknown) => readSupportBundleBackendData({
      ...createValidData(), diagnosticEvents: [value],
    }).diagnosticEvents;
    for (const event of written) {
      const { eventId, timestamp, schemaVersion: _schemaVersion, ...fields } = event;
      const projected = { ...fields, errorCode: 'errorCode' in event ? event.errorCode : null,
        id: `desktop:${eventId}`, occurredAt: timestamp };
      if (event.level === 'info') {
        expect(() => read(projected)).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
        continue;
      }
      expect(read(projected)).toEqual([projected]);
      for (const change of [
        { component: 'backend' }, { category: 'restore' }, { outcome: 'unknown' },
        { level: 'info' }, { stage: 'preUpdateRecovery' }, { correlationId: undefined },
        { targetVersion: '0.3.0' }, { currentVersion: '0.2.81' }, { releaseChannel: 'pilot' },
        { operationId: 'synthetic-private' }, { fingerprint: 'synthetic-private' },
        { cipherName: 'synthetic-cipher' }, { recoveryPointKind: 'preUpdate' },
        { companyId: 'synthetic-company' }, { path: '/synthetic/private' }, { rawError: 'synthetic-private' },
        ...(event.outcome === 'failure'
          ? [{ errorCode: null }, { durationMs: undefined }, { retryable: undefined }, { sideEffectState: undefined }]
          : [{ errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED' }, { retryable: false }, { sideEffectState: 'none' }]),
        ...(event.eventName === 'update.recoveryRequired'
          ? [{ errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED' }, { retryable: true }, { sideEffectState: 'none' }] : []),
      ]) expect(() => read({ ...projected, ...change })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
    }
  });

  it.each(['preUpdateRecovery', 'runtimeShutdown', 'installerHandoff', 'firstStartValidation'])(
    'retains historical generic update failure at %s without renaming it', stage => {
      const event = {
        category: 'update', component: 'desktop', correlationId: '22222222-2222-4222-8222-222222222222',
        id: 'desktop:synthetic-generic-update', occurredAt: '2026-10-22T10:00:00.000Z',
        eventName: 'update.operationFailed', level: 'error', outcome: 'failure', stage,
        errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED', durationMs: 2, retryable: false, sideEffectState: 'unknown',
      };
      const read = (value: unknown) => readSupportBundleBackendData({ ...createValidData(), diagnosticEvents: [value] });
      expect(read(event).diagnosticEvents).toEqual([event]);
      expect(() => read({ ...event, stage: 'packageStaging' })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
      for (const suffix of ['Started', 'Completed']) {
        expect(() => read({ ...event, eventName: `update.operation${suffix}`,
          errorCode: null, level: 'info', outcome: 'success' })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
      }
    },
  );

  it.each([
    { eventName: 'invoicePdfArchive.queueFailed', component: 'backend', level: 'warn',
      outcome: 'failure', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED', stage: 'queue',
      retryable: true, sideEffectState: 'none' },
    { eventName: 'invoicePdfArchive.copyFailed', component: 'desktop', level: 'warn', outcome: 'failure', errorCode: 'ARCHIVE_REQUEST_FAILED', durationMs: 1, retryable: true, sideEffectState: 'none' },
  ])('revalidates the minimized $eventName projection', payload => {
    const event = { category: 'invoicePdfArchive', id: 'synthetic-archive', occurredAt: '2026-10-22T10:00:00.000Z', ...payload };
    const read = (value: unknown) => readSupportBundleBackendData({
      ...createValidData(), diagnosticEvents: [value],
    }).diagnosticEvents;
    expect(read(event)).toEqual([event]);
    for (const change of [
      { category: 'smtp' }, { component: event.component === 'backend' ? 'desktop' : 'backend' },
      { level: 'error' }, { outcome: 'unknown' }, { eventName: 'invoicePdfArchive.unknown' },
      { attemptCount: 1 }, { fingerprint: 'synthetic-fingerprint' },
      { operationId: 'synthetic-invoice' }, { recoveryPointKind: 'daily' },
      { cipherName: 'synthetic-cipher' }, { rawError: 'synthetic-private' },
      { path: '/synthetic/private.pdf' }, { companyId: 'synthetic-company' },
      { errorCode: event.errorCode === null ? 'ARCHIVE_REQUEST_FAILED' : null },
      ...(payload.eventName === 'invoicePdfArchive.queueFailed'
        ? [{ stage: undefined }, { stage: 'copy' }, { retryable: false },
          { sideEffectState: 'unknown' }, { errorCode: 'ARCHIVE_REQUEST_FAILED' }] : []),
    ]) expect(() => read({ ...event, ...change })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it.each([
    { eventName: 'invoicePdfArchive.taskQueued' },
    { eventName: 'invoicePdfArchive.copySucceeded', durationMs: 1 },
    { eventName: 'invoicePdfArchive.configurationChanged', stage: 'enabled' },
  ])('excludes archive info event $eventName from the support receiver', payload => {
    expect(() => readSupportBundleBackendData({
      ...createValidData(), diagnosticEvents: [{
        ...payload, category: 'invoicePdfArchive', component: 'desktop',
        id: 'synthetic-archive', occurredAt: '2026-10-22T10:00:00.000Z',
        level: 'info', outcome: 'success', errorCode: null,
      }],
    })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  const profileRecoveryCases = Object.entries(desktopRecoveryEventStages)
    .filter(([eventName]) => !eventName.startsWith('workspaceBackup.'))
    .flatMap(([eventName, stages]) => stages.map(stage => ({
      eventName: eventName as keyof typeof desktopRecoveryEventStages, stage,
    })));

  it.each(profileRecoveryCases)('revalidates $eventName at $stage', ({ eventName, stage }) => {
    const spec = desktopOperationalEventSpecs[eventName];
    const event = {
      category: spec.category, component: 'desktop',
      correlationId: '33333333-3333-4333-8333-333333333333',
      errorCode: spec.outcome === 'failure'
        ? eventName === 'restore.recoveryRequired' ? 'PROFILE_RESTORE_RECOVERY_REQUIRED' : 'PROFILE_SCHEMA_UNSUPPORTED'
        : null,
      eventName, id: 'desktop:synthetic-profile-event', level: spec.level,
      occurredAt: '2026-10-10T12:00:00.000Z', outcome: spec.outcome, stage,
      ...(spec.category === 'recoveryPoint' ? { recoveryPointKind: 'daily' } : {}),
      ...(spec.payloadFields.includes('durationMs') ? { durationMs: 1 } : {}),
      ...(spec.outcome === 'failure' ? { retryable: false, sideEffectState: 'unknown' } : {}),
    };
    const read = (value: unknown) => readSupportBundleBackendData({
      ...createValidData(), diagnosticEvents: [value],
    }).diagnosticEvents;
    expect(read(event)).toEqual([event]);
    const withIdentity = {
      ...event, appVersion: '0.2.81', buildRevision: 'abcdef1234',
      runtimeInstanceId: '44444444-4444-4444-8444-444444444444',
    };
    expect(read(withIdentity)).toEqual([withIdentity]);
    for (const change of [
      { stage: 'syntheticPrivateStage' }, { stage: undefined },
      { stage: stage === 'portable' ? 'activation' : 'portable' },
      { correlationId: undefined }, { category: 'smtp' }, { component: 'backend' },
      { level: spec.level === 'info' ? 'error' : 'info' },
      { outcome: spec.outcome === 'failure' ? 'success' : 'failure' },
      { operationId: 'syntheticPrivateOperation' }, { cipherName: 'syntheticPrivateCipher' },
      { smtpProfile: 'dnaSmtp' }, { tlsVersion: 'TLSv1.3' },
      { peerCertificateFingerprint256: Array(32).fill('AA').join(':') },
      { companyId: 'synthetic-company' }, { rawError: 'synthetic private detail' },
      ...(spec.category !== 'recoveryPoint' ? [{ recoveryPointKind: 'daily' }] : []),
      ...(spec.outcome === 'success'
        ? [{ errorCode: 'PROFILE_SCHEMA_UNSUPPORTED' }, { fingerprint: 'syntheticFingerprint' }, { retryable: false }, { sideEffectState: 'unknown' }]
        : [{ errorCode: null }]),
      ...(!spec.payloadFields.includes('durationMs') ? [{ durationMs: 1 }] : []),
      ...(eventName === 'restore.recoveryRequired'
        ? [{ errorCode: 'PROFILE_SCHEMA_UNSUPPORTED' }, { retryable: true }, { retryable: undefined }, { sideEffectState: 'none' }, { sideEffectState: undefined }]
        : []),
      ...(eventName === 'restore.activationFailed'
        ? [{ durationMs: undefined }, { retryable: undefined }, { sideEffectState: undefined }]
        : []),
      ...(eventName === 'restore.acceptanceFailed'
        ? [{ durationMs: undefined }, { retryable: undefined }, { retryable: true },
          { sideEffectState: undefined }, { sideEffectState: 'committed' }, { errorCode: 'PRIVATE_CODE' }]
        : []),
      ...(eventName === 'recoveryPoint.started' || eventName === 'recoveryPoint.completed'
        ? [{ recoveryPointKind: undefined }] : []),
    ]) {
      expect(() => read({ ...event, ...change })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
    }
    if (spec.outcome === 'failure') {
      const fingerprintEvent = { ...event, fingerprint: 'profile.failure:PROFILE_SCHEMA_UNSUPPORTED' };
      expect(read(fingerprintEvent)).toEqual([fingerprintEvent]);
    }
    if (eventName !== 'restore.activationFailed' && eventName !== 'restore.recoveryRequired' && eventName !== 'restore.acceptanceFailed') {
      const legacy = JSON.parse(JSON.stringify({
        ...event, durationMs: undefined, retryable: undefined, sideEffectState: undefined,
        recoveryPointKind: eventName === 'recoveryPoint.failed' ? undefined : event.recoveryPointKind,
      }));
      expect(read(legacy)).toEqual([legacy]);
    }
  });

  it('accepts the exact safe backend contract', () => {
    expect(readSupportBundleBackendData(createValidData())).toEqual(
      createValidData(),
    );
  });

  it('rejects raw metadata and personal fields', () => {
    expect(() =>
      readSupportBundleBackendData({
        ...createValidData(),
        diagnosticEvents: [
          {
            ...createValidData().diagnosticEvents[0],
            email: 'person@example.test',
          },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
    expect(() =>
      readSupportBundleBackendData({
        ...createValidData(),
        incidentSummaries: [
          {
            ...createValidData().incidentSummaries[0],
            email: 'person@example.test',
          },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it.each(['workspaceBackup.operationFailed', 'workspaceBackup.cleanupFailed'])(
    'accepts only the closed %s failure contract', eventName => {
      const event = {
        category: 'backup', component: 'desktop' as const,
        correlationId: '22222222-2222-4222-8222-222222222222', durationMs: 1,
        errorCode: 'PROFILE_SCHEMA_UNSUPPORTED', eventName, id: 'desktop:safe-failure',
        level: 'error' as const, occurredAt: '2026-10-09T10:00:00.000Z',
        outcome: 'failure' as const, retryable: false, sideEffectState: 'unknown' as const,
        stage: 'import',
      };
      expect(readSupportBundleBackendData({
        ...createValidData(), diagnosticEvents: [event],
      }).diagnosticEvents).toEqual([event]);
      for (const errorCode of workspaceCandidateFailureCauses) {
        expect(readSupportBundleBackendData({
          ...createValidData(), diagnosticEvents: [{ ...event, errorCode }],
        }).diagnosticEvents).toEqual([{ ...event, errorCode }]);
      }
      const unknown = { ...event, errorCode: 'unknown', stage: 'replace' };
      expect(readSupportBundleBackendData({
        ...createValidData(), diagnosticEvents: [unknown],
      }).diagnosticEvents).toEqual([unknown]);
      for (const change of [
        { rawError: 'synthetic private message' },
        { errorCode: 'syntheticPrivateMessage' },
        { errorCode: null },
        { stage: 'syntheticPrivateStage' },
        { stage: undefined },
        { correlationId: undefined },
        { durationMs: undefined },
        { retryable: true },
        { sideEffectState: 'rolledBack' },
        { category: 'smtp' },
        { component: 'backend' },
        { level: 'info' },
        { outcome: 'success' },
        { fingerprint: 'syntheticPrivateFingerprint' },
        { operationId: 'syntheticPrivateOperation' },
        { cipherName: 'syntheticPrivateCipher' },
      ]) {
        expect(() => readSupportBundleBackendData({
          ...createValidData(), diagnosticEvents: [{ ...event, ...change }],
        })).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
      }
    },
  );

  it('accepts safe TLS metadata and rejects the SMTP peer address', () => {
    const peerCertificateFingerprint256 = Array.from(
      { length: 32 },
      (_, index) =>
        index.toString(16).padStart(2, '0').toUpperCase(),
    ).join(':');
    const validData = createValidData();
    const tlsEvent = {
      category: 'smtp',
      cipherName: 'TLS_AES_256_GCM_SHA384',
      component: 'backend' as const,
      durationMs: 25,
      errorCode: null,
      eventName: 'smtp.connectionSecured',
      id: 'backend:smtp-event-1',
      level: 'info' as const,
      occurredAt: '2026-07-27T13:00:00.000Z',
      outcome: 'success' as const,
      peerCertificateFingerprint256,
      smtpProfile: 'dnaSmtp' as const,
      stage: 'connect',
      tlsVersion: 'TLSv1.3' as const,
    };

    expect(
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [tlsEvent],
      }).diagnosticEvents,
    ).toEqual([tlsEvent]);
    expect(() =>
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [
          { ...tlsEvent, remoteAddress: '192.0.2.10' },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it('accepts only the allowlisted recovery point projection', () => {
    const validData = createValidData();
    const recoveryEvent = {
      category: 'recoveryPoint',
      component: 'desktop' as const,
      correlationId: '33333333-3333-4333-8333-333333333333',
      errorCode: 'RECOVERY_POINT_SOURCE_UNHEALTHY',
      eventName: 'recoveryPoint.failed',
      id: 'desktop:recovery-event-1',
      level: 'warn' as const,
      occurredAt: '2026-07-27T13:00:00.000Z',
      outcome: 'failure' as const,
      recoveryPointKind: 'daily' as const,
      retryable: true,
      sideEffectState: 'unknown' as const,
      stage: 'creation',
    };

    expect(
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [recoveryEvent],
      }).diagnosticEvents,
    ).toEqual([recoveryEvent]);
    expect(() =>
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [
          { ...recoveryEvent, manifest: { entries: ['private'] } },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });
});

function createValidData() {
  return {
    backendVersion: '1.2.3',
    database: {
      appliedMigrationCount: 35,
      health: 'ok' as const,
      latestMigrationName: '035_example.sql',
    },
    diagnosticEvents: [
      {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'abcdef123456',
        category: 'smtp',
        component: 'backend' as const,
        correlationId: '11111111-1111-4111-8111-111111111111',
        durationMs: 120,
        errorCode: 'SMTP_TLS_FAILED',
        eventName: 'smtp.tlsFailed',
        fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
        id: 'backend:event-1',
        level: 'error' as const,
        occurredAt: '2026-07-27T12:00:00.000Z',
        operationId: 'send-attempt-1',
        outcome: 'failure' as const,
        retryable: true,
        runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
        sideEffectState: 'none' as const,
        stage: 'tlsHandshake',
      },
    ],
    diagnosticPeriodDays: 30 as const,
    incidentSummaries: [
      {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'abcdef123456',
        count: 2,
        errorCode: 'SMTP_TLS_FAILED',
        eventName: 'smtp.tlsFailed',
        fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
        firstOccurredAt: '2026-07-26T12:00:00.000Z',
        lastOccurredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'failure' as const,
      },
    ],
    incidentSummariesTruncated: false,
    runtimeSummary: createRuntimeSummary(),
    truncated: false,
  };
}

function createRuntimeSummary() {
  return {
    appVersion: '0.1.0-alpha.1',
    appliedMigrationCount: 35,
    architecture: 'x64',
    buildCreatedAt: '2026-07-27T10:00:00.000Z',
    buildDirty: false,
    buildRevision: 'abcdef123456',
    databaseHealth: 'ok' as const,
    electronVersion: '42.7.0',
    latestErrorAt: null,
    latestMigrationName: '035_example.sql',
    latestSecurityEventAt: null,
    latestWarningAt: null,
    nodeVersion: 'v24.11.0',
    operationalLogNewestMonth: '2026-07',
    operationalLogOldestMonth: '2026-07',
    operationalLogsAvailable: true,
    operationalLogTotalBytes: 4_096,
    platform: 'win32',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}
