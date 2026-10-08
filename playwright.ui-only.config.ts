import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests', testMatch: /ui-only\.spec\.ts/,
  timeout: 20000, expect: {timeout: 3000}, globalTimeout: 90000,
  fullyParallel: true, workers: 2, retries: 0,
  projects: [
    {name: 'webkit-ui', use: {browserName: 'webkit'}},
    {name: 'chromium', use: {browserName: 'chromium'}},
  ],
  reporter: [['list'], ['json', {outputFile: 'test-results/ui-only-results.json'}]],
  use: {
    baseURL: 'http://127.0.0.1:4176', viewport: {width: 393, height: 648},
    hasTouch: true, deviceScaleFactor: 1,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config vite.ui-only.config.ts --mode ui-only',
    url: 'http://127.0.0.1:4176', reuseExistingServer: false, timeout: 10000,
  },
});
