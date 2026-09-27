import { windowsServiceProfiles } from './windowsServiceProfile.js';
import { createWindowsServiceProtocol, windowsServiceSchemaVersion, windowsServiceFrameBytes,
  windowsServiceCleanupMilliseconds, type WindowsServiceReply } from './windowsServiceProtocol.js';

export const viteServiceProtocol = windowsServiceProfiles.vite.protocol;
export const viteServiceSchemaVersion = windowsServiceSchemaVersion;
export const viteServiceFrameBytes = windowsServiceFrameBytes;
export const viteServiceCleanupMilliseconds = windowsServiceCleanupMilliseconds;
export type { WindowsServiceRequestKind as ViteServiceRequestKind,
  WindowsServiceIdentity as ViteServiceIdentity, WindowsServiceState as ViteServiceState } from './windowsServiceProtocol.js';
export type ViteServiceReply = WindowsServiceReply<'vite'>;
const wire = createWindowsServiceProtocol('vite');
export const requireViteServiceToken = wire.requireWindowsServiceToken;
export const encodeViteServiceRequest = wire.encodeWindowsServiceRequest;
export const validateViteServiceReply = wire.validateWindowsServiceReply;
export const createViteServiceFrameReader = wire.createWindowsServiceFrameReader;
