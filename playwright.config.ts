import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:8788'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 120_000,
  use: { ...devices['iPhone 13'], baseURL, javaScriptEnabled: false },
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
})
