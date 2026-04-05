import { defineConfig } from '@playwright/test';

const port = process.env.DEV_SERVER_PORT ?? '3000';
const baseURL = `http://127.0.0.1:${port}`;
const healthUrl = `${baseURL}/signin`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: healthUrl,
    reuseExistingServer: !process.env.CI
  }
});
