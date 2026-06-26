import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/company-settings': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3000',
      },
      '/customers': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3000',
      },
      '/invoice-drafts': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3000',
      },
      '/invoice-numbering-settings': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3000',
      },
    },
  },
});
