import { prepareWindowsServiceConfiguration, type WindowsElectronServiceInput } from './windowsServiceConfiguration.js';
import { startOwnedWindowsService, windowsServiceDependencies,
  type OwnedWindowsServiceInput, type OwnedWindowsServiceDependencies } from './startOwnedWindowsService.js';

export { OwnedWindowsElectronStartupFailure } from './startOwnedWindowsService.js';
interface Input extends WindowsElectronServiceInput, OwnedWindowsServiceInput {}
type Dependencies = OwnedWindowsServiceDependencies<'electron', Input>;
const defaults = windowsServiceDependencies<'electron', Input>('electron',
  input => prepareWindowsServiceConfiguration({ profile: 'electron', input }));

export function startOwnedWindowsElectron(input: Input, overrides: Partial<Dependencies> = {}) {
  return startOwnedWindowsService('electron', input, { ...defaults, ...overrides });
}
