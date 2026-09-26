import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Static build only: no proxy, no API, no environment variables. Output: apps/site/dist. */
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174 },
  preview: { host: '127.0.0.1', port: 5174 },
});
