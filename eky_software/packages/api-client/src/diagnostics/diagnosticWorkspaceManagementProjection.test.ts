import { describe, expect, it } from 'vitest';
import { readDiagnosticsResponse } from './diagnosticsResponse.js';

const operations = ['create', 'import', 'replace', 'switch', 'rename'];
const cases = operations.flatMap(operation => [
  { operation, errorCode: `WORKSPACE_MANAGEMENT_${operation.toUpperCase()}_FAILED`, stage: 'operation', retryable: false },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_INVALID', stage: 'operation', retryable: false },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', stage: 'operation', retryable: false },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'operation', retryable: true },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'admission', retryable: true },
]).concat([{ operation: 'replace', errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', stage: 'lineageCheck', retryable: false }]);

describe('strict workspace management response projection', () => {
  it.each(cases)('revalidates $operation $errorCode at $stage', entry => {
    const event = {
      category: 'workspaceManagement', component: 'desktop',
      correlationId: '22222222-2222-4222-8222-222222222222', durationMs: 2,
      id: 'desktop:synthetic-workspace-failure', eventName: 'workspaceManagement.operationFailed',
      level: 'error', outcome: 'failure', occurredAt: '2026-10-22T10:00:00.000Z',
      operationId: `workspace.${entry.operation}`, errorCode: entry.errorCode,
      stage: entry.stage, retryable: entry.retryable, sideEffectState: 'unknown',
    };
    const read = (value: unknown) => readDiagnosticsResponse({
      diagnosticEvents: [value], readState: { status: 'complete', reasons: [] },
    }).diagnosticEvents;
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
      ...(entry.errorCode.endsWith('_FAILED') || entry.stage === 'lineageCheck'
        ? [{ operationId: `workspace.${entry.operation === 'create' ? 'replace' : 'create'}` }, { stage: 'admission' }] : []),
    ]) expect(() => read({ ...event, ...change })).toThrow('Invalid diagnostics response.');
  });
});
