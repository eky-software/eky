import { describe, expect, it, vi } from 'vitest';

import type { DesktopOperationalEvent } from '../../observability/desktopOperationalEvent.js';
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
const { inspectionCauseCode: _inspectionCauseCode, ...managementFailure } = failure;
const primaryFailures = [
  { role: 'inspection', event: failure, eventName: 'workspaceBackup.operationFailed', errorCode: 'unknown' },
  { role: 'management', event: managementFailure, eventName: 'workspaceManagement.operationFailed',
    errorCode: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED' },
] as const;

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

  it.each(primaryFailures)('delivers the same frozen $role and cleanup events before each write', ({ event, eventName, errorCode }) => {
    const order: string[] = [];
    const observeProjectedEvent = vi.fn((projected: Readonly<DesktopOperationalEvent>) => {
      order.push(`observe:${projected.eventName}`);
    });
    const write = vi.fn((projected: DesktopOperationalEvent) => {
      order.push(`write:${projected.eventName}`);
    });
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });

    expect(observer.record({ ...event, cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' })).toBeUndefined();

    expect(order).toEqual([
      `observe:${eventName}`, `write:${eventName}`,
      'observe:workspaceBackup.cleanupFailed', 'write:workspaceBackup.cleanupFailed',
    ]);
    expect(observeProjectedEvent).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    const projected = observeProjectedEvent.mock.calls.map(([value]) => value);
    expect(projected).toEqual([
      expect.objectContaining({ eventName, errorCode }),
      expect.objectContaining({ eventName: 'workspaceBackup.cleanupFailed', errorCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' }),
    ]);
    projected.forEach((value, index) => {
      expect(write.mock.calls[index]?.[0]).toBe(value);
      expect(Object.isFrozen(value)).toBe(true);
      expect(value).toMatchObject({ correlationId: failure.correlationId });
    });
    expect(new Set(projected.map(value => value.eventId)).size).toBe(2);
    expect(JSON.stringify(projected)).not.toMatch(/workspaceId|profileId|companyId|password|message|stack|causeCode/);
  });

  it.each(primaryFailures)('isolates receiver mutation and synchronous failure for $role and cleanup', ({ event, eventName, errorCode }) => {
    const mutations: boolean[] = [];
    const observeProjectedEvent = vi.fn((projected: Readonly<DesktopOperationalEvent>) => {
      mutations.push(Reflect.set(projected, 'errorCode', 'WORKSPACE_DELETE_FAILED'));
      mutations.push(Reflect.set(projected, 'message', 'synthetic receiver data'));
      throw new Error('synthetic receiver failure');
    });
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });
    const input = Object.freeze({ ...event, cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' as const });

    expect(() => observer.record(input)).not.toThrow();

    expect(mutations).toEqual([false, false, false, false]);
    expect(observeProjectedEvent).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map(([value]) => [value.eventName, value.errorCode])).toEqual([
      [eventName, errorCode], ['workspaceBackup.cleanupFailed', 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED'],
    ]);
    expect(input).toEqual({ ...event, cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' });
    expect(JSON.stringify(write.mock.calls)).not.toContain('synthetic receiver');
  });

  it.each(primaryFailures)('observes accidental async rejection without awaiting $role or cleanup', async ({ event }) => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const catchRejection = vi.spyOn(pending, 'catch');
    const observeProjectedEvent = vi.fn(() => pending);
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });

    expect(observer.record({ ...event, cleanupCauseCode: 'unknown' })).toBeUndefined();
    expect(observeProjectedEvent).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(catchRejection).toHaveBeenCalledTimes(2);

    reject(new Error('synthetic async receiver failure'));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(write).toHaveBeenCalledTimes(2);
    expect(observeProjectedEvent).toHaveBeenCalledTimes(2);
  });

  it.each(primaryFailures)('preserves receiver and cleanup delivery when every $role logger write fails', ({ event, eventName, errorCode }) => {
    const observeProjectedEvent = vi.fn();
    const write = vi.fn(() => { throw new Error('synthetic logger failure'); });
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });

    expect(() => observer.record({ ...event, cleanupCauseCode: 'unknown' })).not.toThrow();

    expect(observeProjectedEvent.mock.calls.map(([value]) => [value.eventName, value.errorCode])).toEqual([
      [eventName, errorCode], ['workspaceBackup.cleanupFailed', 'unknown'],
    ]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each(primaryFailures)('attempts both consumers for $role and cleanup when both consumers throw', ({ event }) => {
    const observeProjectedEvent = vi.fn(() => { throw new Error('synthetic receiver failure'); });
    const write = vi.fn(() => { throw new Error('synthetic logger failure'); });
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });

    expect(() => observer.record({ ...event, cleanupCauseCode: 'unknown' })).not.toThrow();
    expect(observeProjectedEvent).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each(['delete', 'deleteResume'] as const)('preserves separate %s primary and deleteCleanup projections', operationKind => {
    const observeProjectedEvent = vi.fn();
    const write = vi.fn().mockImplementationOnce(() => { throw new Error('synthetic logger failure'); });
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });
    observer.record({ ...managementFailure, operationKind, stage: 'deletePurge', errorCode: 'WORKSPACE_DELETE_IO_FAILED' });
    observer.record({ ...managementFailure, operationKind, stage: 'deleteCleanup', errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED' });

    expect(observeProjectedEvent.mock.calls.map(([value]) => [value.eventName, value.stage, value.errorCode])).toEqual([
      ['workspaceManagement.operationFailed', 'deletePurge', 'WORKSPACE_DELETE_IO_FAILED'],
      ['workspaceManagement.operationFailed', 'deleteCleanup', 'WORKSPACE_DELETE_CLEANUP_FAILED'],
    ]);
    expect(write).toHaveBeenCalledTimes(2);
    observeProjectedEvent.mock.calls.forEach(([value], index) => {
      expect(write.mock.calls[index]?.[0]).toBe(value);
      expect(value.operationId).toBe(`workspace.${operationKind}`);
      expect(value.correlationId).toBe(failure.correlationId);
    });
  });

  it('does not deliver unreported or invalid events to either consumer', () => {
    const observeProjectedEvent = vi.fn();
    const write = vi.fn();
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: identity, operationalLogger: { write }, observeProjectedEvent,
    });
    observer.record({ ...failure, outcome: 'succeeded' });
    observer.record({ ...failure, operationKind: 'status' });
    observer.record({ ...failure, operationKind: 'create' });
    observer.record({ ...failure, durationMs: -1 });
    observer.record({ ...managementFailure, errorCode: 'UNKNOWN_UNCATALOGUED_CODE' });
    expect(observeProjectedEvent).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
