import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { createDevelopmentBackendProxy } from './src/app/developmentBackendProxy.js';
import {
  createE2eViteBackendProxy,
  readE2eViteRuntimeConfig,
} from './viteE2eRuntime.js';

export default defineConfig(() => {
  const e2eRuntime = readE2eViteRuntimeConfig(process.env);

  return {
    ...(e2eRuntime === null
      ? {}
      : {
          cacheDir: e2eRuntime.cacheDirectory,
          envDir: e2eRuntime.environmentDirectory,
        }),
    clearScreen: false,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      open: false,
      proxy:
        e2eRuntime === null
          ? createDevelopmentBackendProxy('http://127.0.0.1:3000')
          : createE2eViteBackendProxy(e2eRuntime),
      strictPort: e2eRuntime !== null,
    },
  };
});
