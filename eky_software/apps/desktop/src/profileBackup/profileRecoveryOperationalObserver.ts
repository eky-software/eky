import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type {
  DesktopOperationalEvent,
  DesktopOperationalEventInput,
  DesktopOperationalIdentity,
} from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';

type ProfileRecoveryEventName =
  | 'recoveryPoint.completed'
  | 'recoveryPoint.failed'
  | 'recoveryPoint.started'
  | 'restore.activationFailed'
  | 'restore.activationStarted'
  | 'restore.inspectionCompleted'
  | 'restore.inspectionFailed'
  | 'restore.rollbackCompleted'
  | 'restore.rollbackFailed'
  | 'restore.rollbackStarted'
  | 'restore.recoveryRequired'
  | 'restore.stagingCompleted'
  | 'restore.stagingFailed'
  | 'restore.validationCompleted'
  | 'restore.validationFailed';

export type ProfileRecoveryOperationalEvent = Extract<
  DesktopOperationalEventInput,
  { eventName: ProfileRecoveryEventName }
>;

export interface ProfileRecoveryOperationalObserver {
  observe(event: ProfileRecoveryOperationalEvent): void;
}

export const noOpProfileRecoveryOperationalObserver: ProfileRecoveryOperationalObserver =
  Object.freeze({
    observe() {},
  });

export function createProfileRecoveryOperationalObserver(options: {
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
}): ProfileRecoveryOperationalObserver {
  return Object.freeze({
    observe(event: ProfileRecoveryOperationalEvent): void {
      try {
        options.operationalLogger.write(
          createProfileRecoveryEvent(event, options.operationalIdentity),
        );
      } catch {
        // Recovery behavior stays authoritative when diagnostics fail.
      }
    },
  });
}

function createProfileRecoveryEvent(
  event: ProfileRecoveryOperationalEvent,
  identity: DesktopOperationalIdentity,
): DesktopOperationalEvent {
  switch (event.eventName) {
    case 'recoveryPoint.completed':
      return createDesktopOperationalEvent(event, identity);
    case 'recoveryPoint.failed':
      return createDesktopOperationalEvent(event, identity);
    case 'recoveryPoint.started':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.activationStarted':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.activationFailed':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.inspectionCompleted':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.inspectionFailed':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.rollbackCompleted':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.rollbackFailed':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.rollbackStarted':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.recoveryRequired':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.stagingCompleted':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.stagingFailed':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.validationCompleted':
      return createDesktopOperationalEvent(event, identity);
    case 'restore.validationFailed':
      return createDesktopOperationalEvent(event, identity);
  }
}

export function observeProfileRecoverySafely(
  observer: ProfileRecoveryOperationalObserver,
  event: ProfileRecoveryOperationalEvent,
): void {
  try {
    observer.observe(event);
  } catch {
    // A custom observer must not change recovery behavior either.
  }
}
