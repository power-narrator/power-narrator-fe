import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  workers: 1, // Run tests serially for Electron
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
});
