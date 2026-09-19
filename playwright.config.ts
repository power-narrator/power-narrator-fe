import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  retries: process.env.CI ? 2 : 1,
  use: {
    trace: "on-first-retry",
  },
});
