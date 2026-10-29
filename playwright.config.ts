import { defineConfig, devices } from "@playwright/test";

// A second checkout (worktree, parallel agent) can pick its own port.
const port = Number(process.env.WYRD_E2E_PORT ?? 4789);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "phone", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "bun e2e/server.ts",
    url: `${baseURL}/api/auth/status`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
