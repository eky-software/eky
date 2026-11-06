import { describe, expect, it, vi } from 'vitest';

import {
  workspaceDeletionFailureCodes,
  workspaceDeletionFailureStages,
} from '../../observability/workspaceManagementFailureContext.js';
import { createWorkspaceBackupOperationalObserver } from './workspaceBackupOperationalObserver.js';
import { mapWorkspaceManagementError, WorkspaceManagementError } from './workspaceManagementError.js';

const codes = [
  'WORKSPACE_MANAGEMENT_BUSY', 'WORKSPACE_MANAGEMENT_INVALID',
  'WORKSPACE_DELETE_STALE_CONFIRMATION', 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
  'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'WORKSPACE_DELETE_INVENTORY_INVALID',
  'WORKSPACE_DELETE_JOURNAL_CONFLICT', 'WORKSPACE_DELETE_IO_FAILED',
  'WORKSPACE_DELETE_CLEANUP_FAILED', 'WORKSPACE_DELETE_FAILED',
] as const;
const stages = [
  'admission', 'deletePreparation', 'deleteAuthorization',
  'deletePurge', 'deleteRegistry', 'deleteCleanup',
] as const;
const identity = {
  appVersion: '0.2.81', buildRevision: 'development',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
};
const failure = {
  correlationId: '22222222-2222-4222-8222-222222222222',
  durationMs: 1, outcome: 'failed', sideEffectState: 'unknown',
} as const;

describe('deletion failure reporting', () => {
  it('owns exactly the approved closed codes and stages', () => {
    expect(workspaceDeletionFailureCodes).toEqual(codes);
    expect(workspaceDeletionFailureStages).toEqual(stages);
  });

  it.each(['delete', 'deleteResume'] as const)('preserves typed %s causes without guessing raw messages', operationKind => {
    for (const code of codes) {
      const error = new WorkspaceManagementError(code, operationKind);
      expect(mapWorkspaceManagementError(error, operationKind)).toBe(error);
      const rebound = mapWorkspaceManagementError(new WorkspaceManagementError(code, 'delete'), operationKind);
      expect(rebound).toMatchObject({ code, operationKind });
    }
    const original = new Error('WORKSPACE_DELETE_IO_FAILED');
    const mapped = mapWorkspaceManagementError(original, operationKind);
    expect(mapped).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: original, operationKind });
    expect(mapWorkspaceManagementError(new WorkspaceManagementError(
      'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'replace'), operationKind))
      .toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', operationKind });
    expect(mapWorkspaceManagementError(new WorkspaceManagementError(
      'WORKSPACE_MANAGEMENT_IMPORT_FAILED', 'import'), operationKind))
      .toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', operationKind });
  });

  it.each(['delete', 'deleteResume'] as const)('writes the real closed %s event builder at every approved stage', operationKind => {
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    for (const stage of stages) for (const errorCode of codes) {
      observer.record({ ...failure, operationKind, stage, errorCode,
        retryable: errorCode === 'WORKSPACE_MANAGEMENT_BUSY' });
    }
    expect(write).toHaveBeenCalledTimes(stages.length * codes.length);
    for (const [event] of write.mock.calls) {
      expect(event).toMatchObject({ ...identity, eventName: 'workspaceManagement.operationFailed',
        correlationId: failure.correlationId, operationId: `workspace.${operationKind}`, sideEffectState: 'unknown' });
    }
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/workspaceId|companyId|inventory|password|rawError|stack|cause|path/);
    observer.record({ ...failure, operationKind, stage: 'deleteCleanup', outcome: 'succeeded' });
    expect(write).toHaveBeenCalledTimes(stages.length * codes.length);
  });

  it.each(['delete', 'deleteResume'] as const)('attempts separate cleanup after a failed %s primary write', operationKind => {
    const write = vi.fn().mockImplementationOnce(() => { throw new Error('synthetic private writer failure'); });
    const observer = createWorkspaceBackupOperationalObserver({ operationalIdentity: identity, operationalLogger: { write } });
    expect(() => {
      observer.record({ ...failure, operationKind, stage: 'deleteRegistry', errorCode: 'WORKSPACE_DELETE_FAILED', retryable: false });
      observer.record({ ...failure, operationKind, stage: 'deleteCleanup', errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', retryable: false });
    }).not.toThrow();
    expect(write.mock.calls.map(([event]) => [event.stage, event.errorCode, event.correlationId])).toEqual([
      ['deleteRegistry', 'WORKSPACE_DELETE_FAILED', failure.correlationId],
      ['deleteCleanup', 'WORKSPACE_DELETE_CLEANUP_FAILED', failure.correlationId],
    ]);
  });
});
