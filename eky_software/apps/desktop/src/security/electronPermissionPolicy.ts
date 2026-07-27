import type { Session } from 'electron';

import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import {
  desktopPermissionTypes,
  type DesktopPermissionType,
} from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';

type PermissionCheckHandler = Exclude<
  Parameters<Session['setPermissionCheckHandler']>[0],
  null
>;
type PermissionRequestHandler = Exclude<
  Parameters<Session['setPermissionRequestHandler']>[0],
  null
>;

interface ElectronPermissionSession {
  setPermissionCheckHandler(handler: PermissionCheckHandler): void;
  setPermissionRequestHandler(handler: PermissionRequestHandler): void;
}

interface ElectronPermissionPolicyOptions {
  appVersion: string;
  operationalLogger: DesktopOperationalLogger;
  permissionSession: ElectronPermissionSession;
}

const allowedPermissionTypes = new Set<DesktopPermissionType>(
  desktopPermissionTypes,
);

export function registerElectronPermissionPolicy(
  options: ElectronPermissionPolicyOptions,
): void {
  const recordedRequests = new Set<string>();

  options.permissionSession.setPermissionCheckHandler(() => false);
  options.permissionSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(false);

      const permissionType = classifyPermissionType(permission);
      const originClass = classifyOrigin(details.requestingUrl);
      const frameClass = classifyFrame(details.isMainFrame);
      const deduplicationKey = [
        permissionType,
        originClass,
        frameClass,
      ].join(':');

      if (recordedRequests.has(deduplicationKey)) {
        return;
      }
      recordedRequests.add(deduplicationKey);

      options.operationalLogger.write(
        createDesktopOperationalEvent(
          {
            eventName: 'electron.permissionRequestBlocked',
            frameClass,
            originClass,
            permissionType,
            stage: 'request',
          },
          { appVersion: options.appVersion },
        ),
      );
    },
  );
}

function classifyPermissionType(value: unknown): DesktopPermissionType {
  return typeof value === 'string' &&
    allowedPermissionTypes.has(value as DesktopPermissionType)
    ? (value as DesktopPermissionType)
    : 'unknown';
}

function classifyOrigin(value: unknown): 'eky' | 'external' | 'unknown' {
  if (typeof value !== 'string' || value.length === 0) {
    return 'unknown';
  }

  try {
    return new URL(value).protocol === 'eky:' ? 'eky' : 'external';
  } catch {
    return 'unknown';
  }
}

function classifyFrame(
  isMainFrame: unknown,
): 'mainFrame' | 'subFrame' | 'unknown' {
  return isMainFrame === true
    ? 'mainFrame'
    : isMainFrame === false
      ? 'subFrame'
      : 'unknown';
}
