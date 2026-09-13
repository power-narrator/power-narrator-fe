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
          // Browser-mode files share one page, so a suite tearing down
          // `window.electronAPI` would rip it out from under a concurrent one.
          fileParallelism: false,
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
