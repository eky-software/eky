import { createDesktopOperationalEvent } from '../../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../../observability/desktopOperationalLogger.js';
import { workspaceManagementOperationIds } from '../../observability/workspaceManagementFailureContext.js';
import type {
  WorkspaceManagementObserver,
  WorkspaceManagementOperationEvent,
} from './workspaceManagementTypes.js';

export function createWorkspaceBackupOperationalObserver(options: {
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
}): WorkspaceManagementObserver {
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
      options.operationalLogger.write(
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
          options.operationalLogger.write(createDesktopOperationalEvent({
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
