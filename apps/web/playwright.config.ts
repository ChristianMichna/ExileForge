import { defineConfig, devices } from "@playwright/test";

// Screenshot baselines are rendered in the official Playwright container
// (mcr.microsoft.com/playwright, same version as @playwright/test) so they
// match pixel for pixel in CI and in every dev environment. See
// docs/dev-tooling.md, "Screenshots". Only the linux baselines are committed;
// other platforms keep local ones (git-ignored).
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  // CI never writes baselines silently; a missing or changed baseline fails.
  updateSnapshots: isCI ? "none" : "missing",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "small-window",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 640 } },
    },
  ],
  webServer: {
    command: "pnpm preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
