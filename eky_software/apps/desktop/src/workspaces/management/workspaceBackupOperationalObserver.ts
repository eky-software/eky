import { createDesktopOperationalEvent } from '../../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../../observability/desktopOperationalLogger.js';
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
      if (event.outcome !== 'failed' || event.inspectionCauseCode === undefined) {
        return;
      }
      recordFailure(event, 'workspaceBackup.operationFailed', event.inspectionCauseCode);
      if (event.cleanupCauseCode !== undefined) {
        recordFailure(event, 'workspaceBackup.cleanupFailed', event.cleanupCauseCode);
      }
    },
  });
}
