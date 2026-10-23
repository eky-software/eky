import { describe, expect, it } from 'vitest';
import { readDiagnosticsResponse } from './diagnosticsResponse.js';
import { diagnosticEventNames } from './diagnosticsTypes.js';

const stages = [
  'packageInspection', 'packageStaging', 'currentPackageRegistration', 'candidateDiscard',
  'confirmation', 'recoveryPoint', 'runtimeShutdown', 'installerHandoff',
  'firstStartValidation', 'businessRollback', 'binaryRollback', 'restoreCompatibility',
];
const cases = [
  ...stages.flatMap(stage => ['Started', 'Succeeded', 'Failed'].map(suffix => ({
    eventName: `update.${stage}${suffix}`, stage,
    level: suffix === 'Failed' ? 'error' : ['businessRollback', 'binaryRollback'].includes(stage) ? 'warn' : 'info',
    outcome: suffix === 'Failed' ? 'failure' : 'success', duration: suffix !== 'Started', failure: suffix === 'Failed',
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

describe('strict update response projection', () => {
  it('includes exactly the approved current and historical update event names', () => {
    const expected = new Set(cases.map(entry => entry.eventName));
    expect(expected.size).toBe(42);
    expect(new Set(diagnosticEventNames.filter(name => name.startsWith('update.')))).toEqual(expected);
  });

  it.each(cases)('revalidates $eventName at $stage', entry => {
    const event = {
      category: 'update', component: 'desktop',
      correlationId: '22222222-2222-4222-8222-222222222222', id: 'desktop:synthetic-update',
      occurredAt: '2026-10-22T10:00:00.000Z', eventName: entry.eventName,
      level: entry.level, outcome: entry.outcome, stage: entry.stage,
      errorCode: entry.failure ? entry.eventName === 'update.recoveryRequired' ? 'UPDATE_RECOVERY_REQUIRED' : 'UPDATE_RUNTIME_SHUTDOWN_FAILED' : null,
      ...(entry.duration ? { durationMs: 2 } : {}),
      ...(entry.failure ? { retryable: false, sideEffectState: 'unknown' } : {}),
    };
    const read = (value: unknown) => readDiagnosticsResponse({ diagnosticEvents: [value] });
    expect(read(event)).toEqual([event]);
    for (const change of [
      { component: 'backend' }, { category: 'restore' }, { level: entry.level === 'info' ? 'warn' : 'info' },
      { outcome: entry.outcome === 'failure' ? 'success' : 'failure' },
      { correlationId: undefined }, { stage: 'copy' }, { eventName: 'update.unknown' },
      { currentVersion: '0.2.81' }, { targetVersion: '0.3.0' }, { releaseChannel: 'pilot' },
      { fingerprint: 'synthetic-private-fingerprint' }, { operationId: 'synthetic-private' },
      { recoveryPointKind: 'preUpdate' }, { smtpProfile: 'dnaSmtp' }, { cipherName: 'synthetic-cipher' },
      { companyId: 'synthetic-company' }, { path: '/synthetic/private' }, { rawError: 'synthetic-private' },
      ...(entry.duration ? [{ durationMs: undefined }] : [{ durationMs: 1 }]),
      ...(entry.failure ? [{ errorCode: null }, { retryable: undefined }, { sideEffectState: undefined }]
        : [{ errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED' }, { retryable: false }, { sideEffectState: 'none' }]),
      ...(entry.eventName === 'update.recoveryRequired'
        ? [{ errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED' }, { retryable: true }, { sideEffectState: 'none' }] : []),
    ]) expect(() => read({ ...event, ...change })).toThrow('Invalid diagnostics response.');
    if (!entry.eventName.startsWith('update.operation') && entry.eventName !== 'update.recoveryRequired') {
      expect(() => read({ ...event, stage: entry.stage === 'runtimeShutdown' ? 'installerHandoff' : 'runtimeShutdown' }))
        .toThrow('Invalid diagnostics response.');
    }
  });
});
