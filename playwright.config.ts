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
  // Use Chrome for all tests - channel: 'chrome' uses Google Chrome
  // headless: false keeps the browser open after tests
  use: {
    channel: 'chrome', // Use Google Chrome channel
    headless: false, // Keep browser open (not headless) - this is the key setting
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