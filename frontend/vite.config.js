import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Proxy only the /predict API route to avoid CORS issues
    proxy: {
      '/predict': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
});
