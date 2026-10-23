import { describe, expect, it } from 'vitest';

import { readDiagnosticsResponse } from './diagnosticsResponse.js';

const cases = [
  ['backup.started', 'backup', 'info', 'success', 'portable'],
  ['backup.completed', 'backup', 'info', 'success', 'portable'],
  ['backup.failed', 'backup', 'error', 'failure', 'portable'],
  ['backup.inspectionCompleted', 'backup', 'info', 'success', 'portable'],
  ['backup.inspectionFailed', 'backup', 'warn', 'failure', 'portable'],
  ['recoveryPoint.started', 'recoveryPoint', 'info', 'success', 'creation'],
  ['recoveryPoint.completed', 'recoveryPoint', 'info', 'success', 'creation'],
  ['recoveryPoint.failed', 'recoveryPoint', 'warn', 'failure', 'creation'],
  ['recoveryPoint.failed', 'recoveryPoint', 'warn', 'failure', 'automaticCheck'],
  ['restore.inspectionCompleted', 'restore', 'info', 'success', 'inspection'],
  ['restore.inspectionFailed', 'restore', 'warn', 'failure', 'inspection'],
  ['restore.stagingCompleted', 'restore', 'info', 'success', 'staging'],
  ['restore.stagingFailed', 'restore', 'error', 'failure', 'staging'],
  ['restore.activationStarted', 'restore', 'info', 'success', 'activation'],
  ['restore.activationFailed', 'restore', 'error', 'failure', 'activation'],
  ['restore.validationCompleted', 'restore', 'info', 'success', 'restoredProfile'],
  ['restore.validationCompleted', 'restore', 'info', 'success', 'rolledBackProfile'],
  ['restore.validationFailed', 'restore', 'error', 'failure', 'restoredProfile'],
  ['restore.validationFailed', 'restore', 'error', 'failure', 'rolledBackProfile'],
  ['restore.acceptanceFailed', 'restore', 'error', 'failure', 'acceptancePreparation'],
  ['restore.acceptanceFailed', 'restore', 'error', 'failure', 'acceptanceCommit'],
  ['restore.acceptanceFailed', 'restore', 'error', 'failure', 'acceptedCleanup'],
  ['restore.rollbackStarted', 'restore', 'warn', 'success', 'activationRollback'],
  ['restore.rollbackStarted', 'restore', 'warn', 'success', 'startupRollback'],
  ['restore.rollbackCompleted', 'restore', 'warn', 'success', 'activationRollback'],
  ['restore.rollbackCompleted', 'restore', 'warn', 'success', 'startupRollback'],
  ['restore.rollbackFailed', 'restore', 'error', 'failure', 'activationRollback'],
  ['restore.rollbackFailed', 'restore', 'error', 'failure', 'startupRollback'],
  ['restore.recoveryRequired', 'restore', 'error', 'failure', 'activation'],
  ['restore.recoveryRequired', 'restore', 'error', 'failure', 'activationRollback'],
  ['restore.recoveryRequired', 'restore', 'error', 'failure', 'startupRollback'],
  ['restore.recoveryRequired', 'restore', 'error', 'failure', 'rolledBackProfile'],
  ['restore.recoveryRequired', 'restore', 'error', 'failure', 'failedSafeJournal'],
] as const;

describe('profile recovery diagnostic response contract', () => {
  it.each(cases)('revalidates %s at %s/%s/%s/%s', (eventName, category, level, outcome, stage) => {
    const event = {
      category, component: 'desktop', correlationId: '33333333-3333-4333-8333-333333333333',
      errorCode: outcome === 'failure'
        ? eventName === 'restore.recoveryRequired' ? 'PROFILE_RESTORE_RECOVERY_REQUIRED' : 'PROFILE_SCHEMA_UNSUPPORTED'
        : null,
      eventName, id: 'desktop:synthetic-profile-event', level,
      occurredAt: '2026-10-10T12:00:00.000Z', outcome, stage,
      ...(category === 'recoveryPoint' ? { recoveryPointKind: 'daily' } : {}),
      ...(eventName.endsWith('Started') || eventName.endsWith('.started') ? {} : { durationMs: 1 }),
      ...(outcome === 'failure' ? { retryable: false, sideEffectState: 'unknown' } : {}),
    };
    const read = (value: unknown) => readDiagnosticsResponse({
      diagnosticEvents: [value], readState: { status: 'complete', reasons: [] },
    }).diagnosticEvents;
    expect(read(event)).toEqual([event]);
    const withIdentity = {
      ...event, appVersion: '0.2.81', buildRevision: 'abcdef1234',
      runtimeInstanceId: '44444444-4444-4444-8444-444444444444',
    };
    expect(read(withIdentity)).toEqual([withIdentity]);
    const changes = [
      { stage: 'syntheticPrivateStage' },
      { stage: stage === 'portable' ? 'activation' : 'portable' },
      { stage: undefined }, { correlationId: undefined },
      { category: 'smtp' }, { component: 'backend' },
      { level: level === 'info' ? 'error' : 'info' },
      { outcome: outcome === 'failure' ? 'success' : 'failure' },
      ...(outcome === 'success' ? [{ fingerprint: 'syntheticPrivateFingerprint' }] : []),
      { operationId: 'syntheticPrivateOperation' },
      { cipherName: 'syntheticPrivateCipher' },
      { smtpProfile: 'dnaSmtp' }, { tlsVersion: 'TLSv1.3' },
      { peerCertificateFingerprint256: Array(32).fill('AA').join(':') },
      { companyId: 'synthetic-company' }, { rawError: 'synthetic private detail' },
      ...(category !== 'recoveryPoint' ? [{ recoveryPointKind: 'daily' }] : []),
      ...(outcome === 'failure' ? [{ errorCode: null }] : [{ errorCode: 'PROFILE_SCHEMA_UNSUPPORTED' }]),
      ...(eventName.endsWith('Started') || eventName.endsWith('.started') ? [{ durationMs: 1 }] : []),
      ...(outcome === 'success' ? [{ retryable: false }, { sideEffectState: 'unknown' }] : []),
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
    ];
    for (const change of changes) expect(() => read({ ...event, ...change })).toThrow();
    if (outcome === 'failure') {
      const fingerprintEvent = { ...event, fingerprint: 'profile.failure:PROFILE_SCHEMA_UNSUPPORTED' };
      expect(read(fingerprintEvent)).toEqual([fingerprintEvent]);
    }
    const legacy = {
      ...event, durationMs: undefined, retryable: undefined, sideEffectState: undefined,
      recoveryPointKind: eventName === 'recoveryPoint.failed' ? undefined : event.recoveryPointKind,
    };
    if (eventName !== 'restore.activationFailed' && eventName !== 'restore.recoveryRequired' && eventName !== 'restore.acceptanceFailed') {
      expect(read(JSON.parse(JSON.stringify(legacy)))).toEqual([JSON.parse(JSON.stringify(legacy))]);
    }
  });
});
