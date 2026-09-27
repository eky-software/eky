import { prepareWindowsServiceConfiguration,
  type WindowsViteServiceInput, type WindowsServicePreparationDependencies } from './windowsServiceConfiguration.js';

export function prepareWindowsViteService(
  input: WindowsViteServiceInput, overrides: Partial<WindowsServicePreparationDependencies> = {},
) {
  return prepareWindowsServiceConfiguration({ profile: 'vite', input }, overrides);
}
