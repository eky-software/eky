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

  it('does not report success, unrelated operations or unobserved causes', () => {
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    observer.record({ ...failure, outcome: 'succeeded' });
    observer.record({ ...failure, operationKind: 'create' });
    const { inspectionCauseCode: _cause, ...unobserved } = failure;
    observer.record(unobserved);
    expect(write).not.toHaveBeenCalled();
  });
});
