/**
 * Playwright configuration for GymPulse e2e tests.
 * @see https://playwright.dev/docs/test-configuration
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  // Playwright's bundled Chromium, headless, so the suite runs the same on a laptop and on a CI runner without a
  // screen. Set HEADED=1 to watch it locally.
  use: {
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 720 },
    // Base URL for tests - we'll use absolute URLs instead
    baseURL: 'http://localhost:3000',
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },
  // Run tests in isolation – each test gets a fresh browser context
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
});