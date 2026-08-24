import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);
// The managed remote environment ships a pinned Chromium outside the default
// browser cache; CI installs browsers normally and takes the default path.
const pinnedChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The app registers a service worker; block it so route interception stays
    // deterministic across repeated runs (idempotency is what we are testing).
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    viewport: { width: 1360, height: 850 }
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: existsSync(pinnedChromium) ? { executablePath: pinnedChromium } : {}
      }
    }
  ],
  webServer: {
    command: 'node tests/e2e/serve-site.mjs',
    cwd: '../..',
    port: PORT,
    reuseExistingServer: !process.env.CI
  }
});
