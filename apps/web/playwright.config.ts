import { defineConfig, devices } from '@playwright/test'

// End-to-end tests of the core journey (e2e/), against a real deployment.
//   E2E_BASE_URL=https://<stage host> pnpm test:e2e    stage (what the roadmap asks for)
//   pnpm test:e2e                                       local `pnpm dev` (started if not running)
// The journey uploads a real clip to Stream (stage's library, also from local dev) and
// deletes it again at the end. See docs/LocalDevelopment.md "End-to-end tests".
const remote = process.env.E2E_BASE_URL
const baseURL = remote ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  // Encoding on Stream takes from seconds to a couple of minutes.
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  // One journey, one account, one upload: run it alone.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: remote
    ? undefined
    : { command: 'pnpm dev', url: baseURL, reuseExistingServer: true, timeout: 120_000 },
})
