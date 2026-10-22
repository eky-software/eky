import { describe, expect, it } from 'vitest';
import { projectDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';

const stages = [
  'packageInspection', 'packageStaging', 'currentPackageRegistration', 'candidateDiscard',
  'confirmation', 'recoveryPoint', 'runtimeShutdown', 'installerHandoff',
  'firstStartValidation', 'businessRollback', 'binaryRollback', 'restoreCompatibility',
];
const cases = [
  ...stages.flatMap(stage => ['Started', 'Succeeded', 'Failed'].map(suffix => ({
    eventName: `update.${stage}${suffix}`, stage,
    level: suffix === 'Failed' ? 'error' : ['businessRollback', 'binaryRollback'].includes(stage) ? 'warn' : 'info',
    outcome: suffix === 'Failed' ? 'failure' : 'success',
    duration: suffix !== 'Started', failure: suffix === 'Failed',
  }))),
  ...['preUpdateRecovery', 'runtimeShutdown', 'installerHandoff', 'firstStartValidation'].flatMap(stage =>
    ['Started', 'Completed', 'Failed'].map(suffix => ({
      eventName: `update.operation${suffix}`, stage, level: suffix === 'Failed' ? 'error' : 'info',
      outcome: suffix === 'Failed' ? 'failure' : 'success', duration: suffix !== 'Started', failure: suffix === 'Failed',
    }))),
  { eventName: 'update.accepted', stage: 'firstStartValidation', level: 'info', outcome: 'success', duration: false, failure: false },
  { eventName: 'update.installerNotApplied', stage: 'firstStartValidation', level: 'warn', outcome: 'blocked', duration: false, failure: false },
  ...stages.map(stage => ({ eventName: 'update.recoveryRequired', stage, level: 'error', outcome: 'failure', duration: true, failure: true })),
];

describe('update diagnostic source projection', () => {
  it.each(cases)('projects $eventName only at $stage with its exact payload', entry => {
    const event = {
      appVersion: '0.2.81', buildRevision: 'development', category: 'update', component: 'desktop',
      correlationId: '22222222-2222-4222-8222-222222222222', eventId: 'synthetic-update',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111', schemaVersion: 1,
      timestamp: '2026-10-22T10:00:00.000Z', eventName: entry.eventName,
      level: entry.level, outcome: entry.outcome, stage: entry.stage,
      ...(entry.duration ? { durationMs: 2 } : {}),
      ...(entry.failure ? { errorCode: entry.eventName === 'update.recoveryRequired' ? 'UPDATE_RECOVERY_REQUIRED' : 'UPDATE_RUNTIME_SHUTDOWN_FAILED',
        retryable: false, sideEffectState: 'unknown' } : {}),
    };
    expect(projectDiagnosticOperationalEvent(event)).toMatchObject({
      eventName: entry.eventName, stage: entry.stage, outcome: entry.outcome, level: entry.level,
      correlationId: event.correlationId,
    });
    for (const change of [
      { component: 'backend' }, { category: 'restore' }, { level: entry.level === 'info' ? 'warn' : 'info' },
      { outcome: entry.outcome === 'failure' ? 'success' : 'failure' },
      { correlationId: undefined }, { correlationId: 'synthetic-not-uuid' }, { stage: 'copy' },
      { currentVersion: '0.2.81' }, { targetVersion: '0.3.0' }, { releaseChannel: 'pilot' },
      { fingerprint: 'synthetic-private-fingerprint' }, { entityId: 'synthetic-invoice' },
      { permissionType: 'media' }, { deletedByteCount: 1 }, { attemptCount: 1 },
      { operationId: 'synthetic-operation' }, { companyId: 'synthetic-company' },
      { path: '/synthetic/private' }, { rawError: 'synthetic-private' },
      ...(entry.duration ? [{ durationMs: undefined }] : [{ durationMs: 1 }]),
      ...(entry.failure ? [{ errorCode: undefined }, { retryable: undefined }, { sideEffectState: undefined }]
        : [{ errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED' }, { retryable: false }, { sideEffectState: 'none' }]),
      ...(entry.eventName === 'update.recoveryRequired'
        ? [{ errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED' }, { retryable: true }, { sideEffectState: 'none' }] : []),
    ]) expect(projectDiagnosticOperationalEvent({ ...event, ...change })).toBeNull();
    if (!entry.eventName.startsWith('update.operation') && entry.eventName !== 'update.recoveryRequired') {
      const wrongStage = entry.stage === 'runtimeShutdown' ? 'installerHandoff' : 'runtimeShutdown';
      expect(projectDiagnosticOperationalEvent({ ...event, stage: wrongStage })).toBeNull();
    }
  });

  it('does not turn generic historical names into current named events or widen their stages', () => {
    expect(new Set(cases.map(entry => entry.eventName)).size).toBe(42);
    const event = {
      appVersion: '0.2.81', buildRevision: 'development', category: 'update', component: 'desktop',
      correlationId: '22222222-2222-4222-8222-222222222222', eventId: 'synthetic-update',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111', schemaVersion: 1,
      timestamp: '2026-10-22T10:00:00.000Z', eventName: 'update.operationCompleted',
      level: 'info', outcome: 'success', stage: 'preUpdateRecovery', durationMs: 2,
    };
    expect(projectDiagnosticOperationalEvent(event)?.eventName).toBe('update.operationCompleted');
    expect(projectDiagnosticOperationalEvent({ ...event, stage: 'packageStaging' })).toBeNull();
    expect(projectDiagnosticOperationalEvent({ ...event, eventName: 'update.unknown' })).toBeNull();
  });
});
