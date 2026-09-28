import { prepareWindowsViteService } from './windowsViteServiceConfiguration.js';
import { startOwnedWindowsService, windowsServiceDependencies,
  type OwnedWindowsService, type OwnedWindowsServiceInput, type OwnedWindowsServiceDependencies } from './startOwnedWindowsService.js';

export { OwnedWindowsViteStartupFailure } from './startOwnedWindowsService.js';
export type { OwnedWindowsService as OwnedWindowsVite,
  OwnedWindowsServiceStartupFailureCode as OwnedWindowsViteStartupFailureCode,
  OwnedWindowsServiceStartupFailureEvidence as OwnedWindowsViteStartupFailureEvidence } from './startOwnedWindowsService.js';

interface OwnedWindowsViteInput extends OwnedWindowsServiceInput {
  readonly repositoryRoot: string;
  readonly runRoot: string;
  readonly webPort: number;
  readonly environmentRoot: string;
  readonly backendOrigin: string;
  readonly sessionSecret: string;
}
type OwnedWindowsViteDependencies = OwnedWindowsServiceDependencies<'vite', OwnedWindowsViteInput>;
const defaultDependencies = windowsServiceDependencies<'vite', OwnedWindowsViteInput>('vite', prepareWindowsViteService);

export function startOwnedWindowsVite(
  input: OwnedWindowsViteInput, overrides: Partial<OwnedWindowsViteDependencies> = {},
): Promise<OwnedWindowsService> {
  return startOwnedWindowsService('vite', { ...input, redactedValues: [...input.redactedValues, input.sessionSecret] },
    { ...defaultDependencies, ...overrides });
}
