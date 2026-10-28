import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4789", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "phone", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "bun e2e/server.ts",
    url: "http://127.0.0.1:4789/api/auth/status",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
