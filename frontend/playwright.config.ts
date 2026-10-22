import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = process.env.PLAYWRIGHT_PORT || '3000';

// Headless Chromium defaults to SwiftShader (software GL): the editor renders ~2 fps there versus
// ~60 fps on hardware ANGLE. Use the GPU when present; E2E_SOFTWARE_GL=1 forces the CI-like path.
const gpuArgs = process.env.E2E_SOFTWARE_GL
  ? []
  : ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
const apiPort = process.env.E2E_API_PORT || '8765';

// One throwaway project store per run. Stored in env so Playwright worker processes reuse it.
process.env.SPACEGEN_E2E_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'spacegen-e2e-'));
process.env.E2E_API_URL = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Gitignored. Screenshots go to test-results/screenshots unless E2E_SCREENSHOT_DIR is set.
  outputDir: './test-results/artifacts',
  // Software GL renders ~1 fps, so every UI step is far slower there; long flows call test.slow() (x3).
  timeout: process.env.E2E_SOFTWARE_GL ? 300000 : 60000,
  expect: {
    timeout: process.env.E2E_SOFTWARE_GL ? 60000 : 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: gpuArgs } },
    },
  ],
  webServer: [
    {
      // The real FastAPI backend with an isolated DATA_DIR. Never reused: a developer's backend
      // on this port would point at real project data.
      command: `python -m uvicorn main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        DATA_DIR: process.env.SPACEGEN_E2E_DATA_DIR,
        CORS_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
        GEMINI_API_KEY: '',
        // The objects stage runs the CPU worker pipeline in-process: no Colab, no tunnel.
        GPU_WORKER_MODE: 'fake',
        GPU_WORKER_URL: '',
        GPU_WORKER_TOKEN: '',
      },
    },
    {
      // Requires `npm run build:e2e` (NEXT_PUBLIC_E2E=1, API pointed at the backend above).
      command: `npm run start -- --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      cwd: './',
    },
  ],
});
