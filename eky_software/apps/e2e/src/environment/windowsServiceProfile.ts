import { chromiumWorkerProtocol } from './chromiumWorkerContract.mjs';

export const windowsServiceProfiles = Object.freeze({
  chromium: Object.freeze({ protocol: chromiumWorkerProtocol, mode: '--chromium-owner',
    pipePrefix: 'eky-e2e-chromium-v1-', configName: 'chromium-service-config.json',
    terminalName: 'chromium-service-terminal.json', errorPrefix: 'E2E_CHROMIUM' } as const),
  backend: Object.freeze({ protocol: 'eky.e2e.backend-service', mode: '--backend-owner',
    pipePrefix: 'eky-e2e-backend-v1-', configName: 'backend-service-config.json',
    terminalName: 'backend-service-terminal.json', errorPrefix: 'E2E_BACKEND' } as const),
  vite: Object.freeze({ protocol: 'eky.e2e.vite-service', mode: '--vite-owner',
    pipePrefix: 'eky-e2e-vite-v1-', configName: 'vite-service-config.json',
    terminalName: 'vite-service-terminal.json', errorPrefix: 'E2E_VITE' } as const),
  electron: Object.freeze({ protocol: 'eky.e2e.electron-service', mode: '--electron-owner',
    pipePrefix: 'eky-e2e-electron-v1-', configName: 'electron-service-config.json',
    terminalName: 'electron-service-terminal.json', errorPrefix: 'E2E_ELECTRON' } as const),
  electronBridge: Object.freeze({ protocol: 'eky.e2e.electron-bridge-service', mode: '--electron-bridge-owner',
    pipePrefix: 'eky-e2e-electron-bridge-v1-', configName: 'electron-bridge-service-config.json',
    terminalName: 'electron-bridge-service-terminal.json', errorPrefix: 'E2E_ELECTRON_BRIDGE' } as const),
});
export type WindowsServiceProfile = keyof typeof windowsServiceProfiles;
