import { defineConfig } from "@playwright/test";
const cameraControlsOnly = process.env.CAMERA_CONTROLS_ONLY === "1";
export default defineConfig({
  grepInvert: cameraControlsOnly ? undefined : /@camera-controls/,
  testDir: "./browser-tests",
  testIgnore: /ui-only\.spec\.ts/,
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  projects: [
    { name: "webkit-ui", testMatch: cameraControlsOnly ? /home\.spec\.ts/ : /mobile-settings-ui\.spec\.ts/, use: { browserName: "webkit", launchOptions: {} } },
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/browser-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4176",
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    screenshot: cameraControlsOnly ? "off" : "only-on-failure",
    trace: cameraControlsOnly ? "off" : "retain-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config vite.browser-tests.config.ts",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
