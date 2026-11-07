import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4317",
    channel: "chrome",
    viewport: { width: 1440, height: 1100 },
  },
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4317",
      url: "http://127.0.0.1:4317",
      reuseExistingServer: true,
    },
    {
      command: "npm --prefix workers/sessions run dev",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
