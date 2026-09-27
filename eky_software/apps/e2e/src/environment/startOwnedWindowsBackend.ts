import { prepareWindowsBackendService } from './windowsBackendServiceConfiguration.js';
import { startOwnedWindowsService, windowsServiceDependencies,
  type OwnedWindowsService, type OwnedWindowsServiceInput, type OwnedWindowsServiceDependencies } from './startOwnedWindowsService.js';

export { OwnedWindowsBackendStartupFailure } from './startOwnedWindowsService.js';
export type { OwnedWindowsService as OwnedWindowsBackend,
  OwnedWindowsServiceStartupFailureCode as OwnedWindowsBackendStartupFailureCode,
  OwnedWindowsServiceStartupFailureEvidence as OwnedWindowsBackendStartupFailureEvidence } from './startOwnedWindowsService.js';

interface OwnedWindowsBackendInput extends OwnedWindowsServiceInput {
  readonly repositoryRoot: string;
  readonly runRoot: string;
  readonly runtimeConfigPath: string;
}
type OwnedWindowsBackendDependencies = OwnedWindowsServiceDependencies<'backend', OwnedWindowsBackendInput>;
const defaultDependencies = windowsServiceDependencies<'backend', OwnedWindowsBackendInput>('backend', prepareWindowsBackendService);

export function startOwnedWindowsBackend(
  input: OwnedWindowsBackendInput, overrides: Partial<OwnedWindowsBackendDependencies> = {},
): Promise<OwnedWindowsService> {
  return startOwnedWindowsService('backend', input,
    { ...defaultDependencies, ...overrides });
}
