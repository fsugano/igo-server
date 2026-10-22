import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the shared sources directly so the rules engine does not need a separate build in dev.
    alias: { '@igo/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': api,
      '/socket.io': { target: api, ws: true },
    },
  },
});
