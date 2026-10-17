import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/*.native.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "native",
          include: ["**/*.native.test.ts"],
          testTimeout: 15 * 60 * 1000,
          hookTimeout: 5 * 60 * 1000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "component",
          include: ["**/*.component.test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
