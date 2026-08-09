import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type {
  DesktopOperationalEvent,
  DesktopOperationalEventInput,
  DesktopOperationalIdentity,
} from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';

type ProfileBackupEventName =
  | 'backup.completed'
  | 'backup.failed'
  | 'backup.inspectionCompleted'
  | 'backup.inspectionFailed'
  | 'backup.started';

export type ProfileBackupOperationalEvent = Extract<
  DesktopOperationalEventInput,
  { eventName: ProfileBackupEventName }
>;

export interface ProfileBackupOperationalObserver {
  observe(event: ProfileBackupOperationalEvent): void;
}

export function createProfileBackupOperationalObserver(options: {
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
}): ProfileBackupOperationalObserver {
  return Object.freeze({
    observe(event: ProfileBackupOperationalEvent): void {
      try {
        options.operationalLogger.write(
          createProfileBackupEvent(event, options.operationalIdentity),
        );
      } catch {
        // Portable backup behavior stays authoritative when diagnostics fail.
      }
    },
  });
}

function createProfileBackupEvent(
  event: ProfileBackupOperationalEvent,
  identity: DesktopOperationalIdentity,
): DesktopOperationalEvent {
  switch (event.eventName) {
    case 'backup.completed':
      return createDesktopOperationalEvent(event, identity);
    case 'backup.failed':
      return createDesktopOperationalEvent(event, identity);
    case 'backup.inspectionCompleted':
      return createDesktopOperationalEvent(event, identity);
    case 'backup.inspectionFailed':
      return createDesktopOperationalEvent(event, identity);
    case 'backup.started':
      return createDesktopOperationalEvent(event, identity);
  }
}
