import { windowsServiceProfiles } from './windowsServiceProfile.js';
import { createWindowsServiceProtocol, windowsServiceSchemaVersion, windowsServiceFrameBytes,
  windowsServiceCleanupMilliseconds, type WindowsServiceReply } from './windowsServiceProtocol.js';

export const backendServiceProtocol = windowsServiceProfiles.backend.protocol;
export const backendServiceSchemaVersion = windowsServiceSchemaVersion;
export const backendServiceFrameBytes = windowsServiceFrameBytes;
export const backendServiceCleanupMilliseconds = windowsServiceCleanupMilliseconds;
export type { WindowsServiceRequestKind as BackendServiceRequestKind,
  WindowsServiceIdentity as BackendServiceIdentity, WindowsServiceState as BackendServiceState } from './windowsServiceProtocol.js';
export type BackendServiceReply = WindowsServiceReply<'backend'>;
const wire = createWindowsServiceProtocol('backend');
export const requireBackendServiceToken = wire.requireWindowsServiceToken;
export const encodeBackendServiceRequest = wire.encodeWindowsServiceRequest;
export const validateBackendServiceReply = wire.validateWindowsServiceReply;
export const createBackendServiceFrameReader = wire.createWindowsServiceFrameReader;
