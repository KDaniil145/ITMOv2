import { defineConfig, devices } from '@playwright/test';
import { ensureTestDirectory } from './tests/support/backend.mjs';
// Only the Node host fields used here; no additional @types/node dependency.
declare const process: { env: Record<string, string | undefined>; argv: string[] };

const localBrowserLibraries = decodeURIComponent(new URL('../.test-cache/browser-libs/usr/lib/x86_64-linux-gnu/', import.meta.url).pathname);
process.env.LD_LIBRARY_PATH = [localBrowserLibraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= decodeURIComponent(new URL('../.test-cache/ms-playwright/', import.meta.url).pathname);
process.env.TMPDIR = decodeURIComponent(new URL('../.test-cache/tmp/', import.meta.url).pathname);
ensureTestDirectory(process.env.TMPDIR);
process.env.TASKFLOW_TEST_PYTHON ??= decodeURIComponent(new URL('../backend/.venv/bin/python', import.meta.url).pathname);
process.env.TASKFLOW_TEST_CONTROL ??= decodeURIComponent(new URL(`../backend/.test-data/e2e-${crypto.randomUUID()}.json`, import.meta.url).pathname);
const backendRoot = decodeURIComponent(new URL('../backend/', import.meta.url).pathname);
const frontendRoot = decodeURIComponent(new URL('./', import.meta.url).pathname);
const backendPort = Number(process.env.TASKFLOW_TEST_BACKEND_PORT ?? 18765);
const frontendPort = Number(process.env.TASKFLOW_TEST_FRONTEND_PORT ?? 18766);
for (const port of [backendPort, frontendPort]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
}
if (backendPort === frontendPort) throw new Error('Test ports must differ');
// Pure helper tests never need web servers. Default execution includes E2E.
const args = process.argv.slice(2);
const unitProject = args.includes('--project=unit') || args.some((arg, i) => arg === '--project' && args[i + 1] === 'unit');
const testPaths = args.filter(arg => arg.startsWith('tests/'));
const unitOnly = unitProject || (testPaths.length > 0 && testPaths.every(arg => arg.startsWith('tests/unit')));
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1, // A single owned backend/DB per run; parallel runs use different ports.
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${frontendPort}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'unit', testDir: './tests/unit' },
    { name: 'e2e', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: unitOnly ? [] : [
    {
      command: `${process.env.TASKFLOW_TEST_PYTHON ?? 'python3'} -m tests.support.processes --port ${backendPort} --control ${process.env.TASKFLOW_TEST_CONTROL}`,
      cwd: backendRoot,
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: `npm run dev -- --config tests/support/vite.config.ts --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      cwd: frontendRoot,
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ],
});
