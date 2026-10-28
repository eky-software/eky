import { describe, expect, it } from 'vitest';
import { readDiagnosticsResponse } from './diagnosticsResponse.js';

const operations = ['create', 'import', 'replace', 'switch', 'rename'];
const cases = operations.flatMap(operation => [
  { operation, errorCode: `WORKSPACE_MANAGEMENT_${operation.toUpperCase()}_FAILED`, stage: 'operation', retryable: false },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_INVALID', stage: 'operation', retryable: false },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', stage: 'operation', retryable: false },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'operation', retryable: true },
  { operation, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'admission', retryable: true },
]).concat([
  ...['admission', 'deletePreparation'].flatMap(stage => [
    { operation: 'delete', errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage, retryable: true },
    ...['WORKSPACE_MANAGEMENT_INVALID', 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'WORKSPACE_DELETE_FAILED']
      .map(errorCode => ({ operation: 'delete', errorCode, stage, retryable: false })),
  ]),
  { operation: 'replace', errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', stage: 'lineageCheck', retryable: false },
  { operation: 'create', errorCode: 'WORKSPACE_CREATION_LABEL_EXISTS', stage: 'operation', retryable: false },
  { operation: 'import', errorCode: 'WORKSPACE_IMPORT_LABEL_EXISTS', stage: 'operation', retryable: false },
  ...['create', 'import', 'rename'].map(operation => ({
    operation, errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS', stage: 'operation', retryable: false,
  })),
]);

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
    const read = (value: unknown) => {
      const result = readDiagnosticsResponse({
        state: 'ready', older: { state: 'end' }, newer: { state: 'end' },
        diagnosticEvents: [value], readState: { status: 'complete', reasons: [] },
      });
      expect(result.state).toBe('ready');
      if (result.state !== 'ready') throw new Error('Expected a ready page.');
      return result.diagnosticEvents;
    };
    expect(read(event)).toEqual([event]);
    if (entry.operation === 'delete' && entry.stage === 'deletePreparation' && !entry.retryable) {
      expect(() => read({ ...event, sideEffectState: 'none' })).toThrow('Invalid diagnostics response.');
    } else {
      expect(read({ ...event, sideEffectState: 'none' })).toEqual([{ ...event, sideEffectState: 'none' }]);
    }
    for (const change of [
      { component: 'backend' }, { category: 'backup' }, { level: 'warn' }, { outcome: 'success' },
      { correlationId: undefined }, { durationMs: undefined }, { operationId: undefined },
      { correlationId: 'synthetic-not-a-uuid' }, { durationMs: -1 }, { durationMs: 1.5 },
      { durationMs: Number.MAX_SAFE_INTEGER + 1 }, { errorCode: undefined }, { retryable: undefined }, { stage: undefined },
      { operationId: 'workspace.status' }, { operationId: 'synthetic-workspace-id' },
      { errorCode: 'unknown' }, { errorCode: 'PROFILE_SCHEMA_UNSUPPORTED' },
      { retryable: !entry.retryable }, { stage: 'status' }, { sideEffectState: 'completed' },
      { sideEffectState: 'committed' }, { sideEffectState: 'rolledBack' }, { sideEffectState: undefined },
      { fingerprint: 'synthetic-fingerprint' }, { cipherName: 'synthetic-cipher' },
      { recoveryPointKind: 'daily' }, { smtpProfile: 'dnaSmtp' }, { companyId: 'synthetic-company' },
      { rawError: 'synthetic-private' }, { path: '/synthetic/private' },
      { workspaceLabel: 'Synthetic' }, { workspaceId: 'synthetic-workspace-id' },
      { message: 'synthetic-private' }, { errorCode: 'WORKSPACE_LABEL_EXISTS' },
      { operationId: 'workspace.deleteResume' }, { stage: 'deleteAuthorization' },
      { stage: 'deletePurge' }, { stage: 'deleteRegistry' }, { stage: 'deleteCleanup' },
      { eventName: 'workspaceManagement.operationCompleted' },
      { inventory: [] }, { lineageIdentity: 'synthetic-lineage' }, { cause: {} }, { stack: 'synthetic-private' },
      ...(entry.operation === 'delete'
        ? [{ stage: 'operation' }, { stage: 'lineageCheck' },
          ...['WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'WORKSPACE_MANAGEMENT_DELETE_FAILED',
            ...operations.map(operation => `WORKSPACE_MANAGEMENT_${operation.toUpperCase()}_FAILED`),
            'WORKSPACE_CREATION_LABEL_EXISTS', 'WORKSPACE_IMPORT_LABEL_EXISTS', 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
            'WORKSPACE_MANAGEMENT_LABEL_EXISTS', 'WORKSPACE_DELETE_STALE_CONFIRMATION',
            'WORKSPACE_DELETE_BACKUP_UNAVAILABLE', 'WORKSPACE_DELETE_INVENTORY_INVALID',
            'WORKSPACE_DELETE_JOURNAL_CONFLICT', 'WORKSPACE_DELETE_IO_FAILED', 'WORKSPACE_DELETE_CLEANUP_FAILED']
            .map(errorCode => ({ errorCode }))]
        : [{ stage: 'deletePreparation' },
          { errorCode: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' }, { errorCode: 'WORKSPACE_DELETE_FAILED' }]),
      ...(entry.errorCode.endsWith('_LABEL_EXISTS')
        ? [{ stage: 'admission' }, { stage: 'lineageCheck' },
          ...operations.filter(operation => entry.errorCode === 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'
            ? operation === 'replace' || operation === 'switch' : operation !== entry.operation)
            .map(operation => ({ operationId: `workspace.${operation}` }))] : []),
      ...((entry.errorCode.endsWith('_FAILED') && entry.operation !== 'delete') || entry.stage === 'lineageCheck'
        ? [{ operationId: `workspace.${entry.operation === 'create' ? 'replace' : 'create'}` }, { stage: 'admission' }] : []),
      ...(entry.operation === 'delete' && entry.errorCode.startsWith('WORKSPACE_DELETE_')
        ? operations.map(operation => ({ operationId: `workspace.${operation}` })) : []),
    ]) expect(() => read({ ...event, ...change })).toThrow('Invalid diagnostics response.');
  });
});
