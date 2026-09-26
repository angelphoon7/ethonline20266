import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The console talks to the owner API through a same-origin proxy, so the API needs no CORS and the bearer token never
 * leaves localhost. Both servers bind 127.0.0.1 only (OPERATIONAL_GUARDRAILS section 9).
 */
const api = { '/api': { target: `http://127.0.0.1:${process.env.OWNER_PORT ?? 4100}`, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, proxy: api },
  preview: { host: '127.0.0.1', port: 5173, proxy: api },
});
