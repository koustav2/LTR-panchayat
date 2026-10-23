import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately; in production nginx (or the
    // Node process itself, on cPanel) serves both from the same origin.
    proxy: {
      // API_PORT lets dev run beside anything else already squatting on 4000.
      '/api': { target: `http://localhost:${process.env.API_PORT || 4000}`, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
