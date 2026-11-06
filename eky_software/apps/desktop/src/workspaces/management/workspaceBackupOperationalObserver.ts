import { createDesktopOperationalEvent } from '../../observability/createDesktopOperationalEvent.js';
import type {
  DesktopOperationalEvent,
  DesktopOperationalIdentity,
} from '../../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../../observability/desktopOperationalLogger.js';
import { workspaceManagementOperationIds } from '../../observability/workspaceManagementFailureContext.js';
import type {
  WorkspaceManagementObserver,
  WorkspaceManagementOperationEvent,
} from './workspaceManagementTypes.js';

export function createWorkspaceBackupOperationalObserver(options: {
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
  // Main-only synchronous observation, never operation authority.
  observeProjectedEvent?(event: Readonly<DesktopOperationalEvent>): void;
}): WorkspaceManagementObserver {
  function recordProjectedEvent(event: DesktopOperationalEvent): void {
    // The event factory validates and freezes this same projection for both consumers.
    try {
      const result: unknown = options.observeProjectedEvent?.(event);
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // A receiver failure must not suppress the logger or separate cleanup.
    }
    try {
      options.operationalLogger.write(event);
    } catch {
      // Logging cannot change the original failure or workspace recovery.
    }
  }

  function recordFailure(
    event: Readonly<WorkspaceManagementOperationEvent>,
    eventName:
      | 'workspaceBackup.operationFailed'
      | 'workspaceBackup.cleanupFailed',
    errorCode: string,
  ): void {
    if (event.operationKind !== 'import' && event.operationKind !== 'replace') {
      return;
    }
    try {
      recordProjectedEvent(
        createDesktopOperationalEvent(
          {
            correlationId: event.correlationId,
            durationMs: event.durationMs,
            errorCode,
            eventName,
            retryable: false,
            sideEffectState:
              event.sideEffectState === 'none' ? 'none' : 'unknown',
            stage: event.operationKind,
          },
          options.operationalIdentity,
        ),
      );
    } catch {
      // Each projection is best effort and cannot change workspace recovery.
    }
  }

  return Object.freeze({
    record(event: Readonly<WorkspaceManagementOperationEvent>): void {
      if (event.outcome !== 'failed' || event.operationKind === 'status') {
        return;
      }
      if (event.inspectionCauseCode !== undefined) {
        recordFailure(event, 'workspaceBackup.operationFailed', event.inspectionCauseCode);
      } else if (event.stage !== 'status' && event.errorCode !== undefined) {
        try {
          recordProjectedEvent(createDesktopOperationalEvent({
            eventName: 'workspaceManagement.operationFailed', correlationId: event.correlationId,
            durationMs: event.durationMs, errorCode: event.errorCode,
            operationId: workspaceManagementOperationIds[event.operationKind],
            retryable: event.retryable ?? false,
            sideEffectState: event.sideEffectState === 'none' ? 'none' : 'unknown',
            stage: event.stage,
          }, options.operationalIdentity));
        } catch {
          // A failed primary projection must not suppress a separate cleanup event.
        }
      }
      if (event.cleanupCauseCode !== undefined) {
        recordFailure(event, 'workspaceBackup.cleanupFailed', event.cleanupCauseCode);
      }
    },
  });
}
