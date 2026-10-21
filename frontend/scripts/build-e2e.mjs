// Builds the app for Playwright: enables the NEXT_PUBLIC_E2E-gated test hooks and points the
// client at the e2e backend that playwright.config.ts starts. Production builds use `npm run build`.
import { spawnSync } from 'node:child_process';

const apiPort = process.env.E2E_API_PORT || '8765';
const env = {
  ...process.env,
  NEXT_PUBLIC_E2E: '1',
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${apiPort}`,
};
const result = spawnSync('npx', ['next', 'build'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
