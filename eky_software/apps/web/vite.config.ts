import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { createDevelopmentBackendProxy } from './src/app/developmentBackendProxy.js';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: createDevelopmentBackendProxy('http://127.0.0.1:3000'),
  },
});
