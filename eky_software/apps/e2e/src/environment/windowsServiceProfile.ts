export const windowsServiceProfiles = Object.freeze({
  backend: Object.freeze({ protocol: 'eky.e2e.backend-service', mode: '--backend-owner',
    pipePrefix: 'eky-e2e-backend-v1-', configName: 'backend-service-config.json',
    terminalName: 'backend-service-terminal.json', errorPrefix: 'E2E_BACKEND' } as const),
  vite: Object.freeze({ protocol: 'eky.e2e.vite-service', mode: '--vite-owner',
    pipePrefix: 'eky-e2e-vite-v1-', configName: 'vite-service-config.json',
    terminalName: 'vite-service-terminal.json', errorPrefix: 'E2E_VITE' } as const),
  electron: Object.freeze({ protocol: 'eky.e2e.electron-service', mode: '--electron-owner',
    pipePrefix: 'eky-e2e-electron-v1-', configName: 'electron-service-config.json',
    terminalName: 'electron-service-terminal.json', errorPrefix: 'E2E_ELECTRON' } as const),
});
export type WindowsServiceProfile = keyof typeof windowsServiceProfiles;
