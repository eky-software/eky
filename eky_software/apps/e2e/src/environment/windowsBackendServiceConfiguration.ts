import { prepareWindowsServiceConfiguration,
  type WindowsBackendServiceInput } from './windowsServiceConfiguration.js';

export function prepareWindowsBackendService(input: WindowsBackendServiceInput) {
  return prepareWindowsServiceConfiguration({ profile: 'backend', input });
}
