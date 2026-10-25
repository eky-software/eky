import { describe, expect, it, vi } from 'vitest';

import { workspaceCandidateFailureCauses } from '../../runtime/workspaceCandidateMessages.js';
import { createWorkspaceBackupOperationalObserver } from './workspaceBackupOperationalObserver.js';
import type { WorkspaceManagementOperationEvent } from './workspaceManagementTypes.js';

const identity = {
  appVersion: '0.2.81', buildRevision: 'development',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
};
const failure: WorkspaceManagementOperationEvent = {
  correlationId: '22222222-2222-4222-8222-222222222222',
  durationMs: 1, errorCode: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED',
  inspectionCauseCode: 'unknown', operationKind: 'import', outcome: 'failed',
  retryable: false, sideEffectState: 'unknown', stage: 'operation',
};

describe('workspace backup operational observer', () => {
  it.each(workspaceCandidateFailureCauses)('writes only the closed first cause %s', errorCode => {
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    observer.record({ ...failure, inspectionCauseCode: errorCode });
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'workspaceBackup.operationFailed', errorCode,
      correlationId: failure.correlationId, stage: 'import',
    }));
  });

  it('keeps the unknown first cause separate from known cleanup', () => {
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    observer.record({ ...failure, operationKind: 'replace', cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' });
    expect(write.mock.calls.map(([event]) => [event.eventName, event.errorCode])).toEqual([
      ['workspaceBackup.operationFailed', 'unknown'],
      ['workspaceBackup.cleanupFailed', 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED'],
    ]);
    expect(new Set(write.mock.calls.map(([event]) => event.correlationId)).size).toBe(1);
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/workspaceId|profileId|password|message|stack|causeCode/);
  });

  it('attempts cleanup reporting even if the first projection throws', () => {
    const write = vi.fn().mockImplementationOnce(() => { throw new Error('private write failure'); });
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    expect(() => observer.record({ ...failure, cleanupCauseCode: 'unknown' })).not.toThrow();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('does not report success, status or an impossible inspection on another operation', () => {
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    observer.record({ ...failure, outcome: 'succeeded' });
    observer.record({ ...failure, operationKind: 'create' });
    observer.record({ ...failure, operationKind: 'status' });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['create', 'WORKSPACE_MANAGEMENT_CREATE_FAILED'], ['import', 'WORKSPACE_MANAGEMENT_IMPORT_FAILED'],
    ['replace', 'WORKSPACE_MANAGEMENT_REPLACE_FAILED'], ['switch', 'WORKSPACE_MANAGEMENT_SWITCH_FAILED'],
    ['rename', 'WORKSPACE_MANAGEMENT_RENAME_FAILED'],
    ['create', 'WORKSPACE_CREATION_LABEL_EXISTS'], ['import', 'WORKSPACE_IMPORT_LABEL_EXISTS'],
    ['create', 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'], ['import', 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'],
    ['rename', 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'],
  ] as const)('writes one non-inspection %s failure with a logical operation only', (operationKind, errorCode) => {
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    const { inspectionCauseCode: _cause, ...unobserved } = failure;
    observer.record({ ...unobserved, operationKind, errorCode });
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'workspaceManagement.operationFailed', operationId: `workspace.${operationKind}`,
      errorCode, stage: 'operation', sideEffectState: 'unknown',
    }));
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/workspaceId|profileId|companyId|password|message|stack/);
  });

  it('keeps a separate cleanup failure even when the non-inspection primary writer fails', () => {
    const write = vi.fn().mockImplementationOnce(() => { throw new Error('synthetic write failure'); });
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    const { inspectionCauseCode: _cause, ...unobserved } = failure;
    observer.record({ ...unobserved, cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' });
    expect(write.mock.calls.map(([event]) => [event.eventName, event.errorCode])).toEqual([
      ['workspaceManagement.operationFailed', 'WORKSPACE_MANAGEMENT_IMPORT_FAILED'],
      ['workspaceBackup.cleanupFailed', 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED'],
    ]);
  });
});
