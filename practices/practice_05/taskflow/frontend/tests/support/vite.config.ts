import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

declare const process: { env: Record<string, string | undefined> };

// Test-only proxy: production/dev configuration remains untouched.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.TASKFLOW_TEST_BACKEND_PORT ?? '18765'}` } },
});
