import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PW_STATIC_PORT || 4777);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  webServer: {
    command: `node scripts/playwright-static-server.mjs`,
    url: `${baseURL}/index.html`,
    timeout: 25_000,
    reuseExistingServer: !process.env.CI
  }
});
