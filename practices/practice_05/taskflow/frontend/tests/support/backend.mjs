import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const backend = fileURLToPath(new URL('../../../backend/', import.meta.url));
export function fixture(action = 'seed', id) {
  const control = process.env.TASKFLOW_TEST_CONTROL;
  if (!control) throw new Error('Missing owned test backend control file');
  const result = execFileSync(process.env.TASKFLOW_TEST_PYTHON, ['-m', 'tests.support.read_fixtures', '--control', control, '--action', action, ...(id ? ['--id', id] : [])],
    { cwd: backend, stdio: 'pipe', encoding: 'utf8' });
  return action === 'snapshot' ? JSON.parse(result) : undefined;
}

export function ensureTestDirectory(path) { mkdirSync(path, { recursive: true }); }
