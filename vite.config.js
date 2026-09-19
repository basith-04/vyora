import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  server: mode === 'development' ? {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001/demo-vyora-26/asia-south1/api',
        changeOrigin: true,
      },
    },
  } : undefined,
}));
