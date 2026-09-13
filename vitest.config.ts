import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "electron/**/*.test.ts", "shared/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
        },
      },
      {
        plugins: [react()],
        optimizeDeps: {
          include: ["@gfazioli/mantine-split-pane"],
        },
        test: {
          name: "component",
          include: ["src/**/*.component.test.tsx"],
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
