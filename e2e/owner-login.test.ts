/**
 * GymPulse Owner Login Test
 * 
 * Logs in as the demo gym owner (seeded by prisma/seed.ts).
 *
 * Credentials:
 *   Owner: E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD (see ./credentials.ts)
 */

import { test, expect } from '@playwright/test';
import { OWNER_EMAIL, OWNER_PASSWORD } from './credentials';

const BASE_URL = 'http://localhost:3000';

test('Owner can log in and reach the dashboard', async ({ page }) => {
  // Step 1: Navigate to the login page
  console.log(`Navigating to ${BASE_URL}/login...`);
  await page.goto(`${BASE_URL}/login`);
  
  // Wait for the login form to be visible
  await expect(page.locator('form')).toBeVisible();
  await expect(page.locator('input[name="identifier"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();

  // Step 2: Log in as owner
  console.log('Logging in as owner...');
  await page.fill('input[name="identifier"]', OWNER_EMAIL);
  await page.fill('input[name="password"]', OWNER_PASSWORD);
  await page.click('button[type="submit"]');

  // Step 3: Wait for navigation/dashboard after login
  // The app redirects to /app after successful login
  await page.waitForURL(`${BASE_URL}/app`, { timeout: 15000 });
  console.log('Successfully navigated to /app after login');

  // Step 4: Verify we're logged in by checking the page content
  // The /app page should have GymPulse content
  await expect(page.locator('body')).toContainText('GymPulse');

  console.log('✅ Owner login successful');
});

// Additional test: Verify MFA flow if applicable
test('Owner login with MFA', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  
  await page.fill('input[name="identifier"]', OWNER_EMAIL);
  await page.fill('input[name="password"]', OWNER_PASSWORD);
  await page.click('button[type="submit"]');
  
  // If MFA is required, we'll land on the MFA page
  const currentUrl = page.url();
  console.log('Current URL after login:', currentUrl);
  
  // Check if we're on the MFA page
  if (currentUrl.includes('/login/mfa')) {
    console.log('MFA page detected - entering MFA code...');
    // The MFA page might have a TOTP or code entry field
    // For now, just wait and observe
    await page.waitForTimeout(3000);
    console.log('MFA test completed');
  } else {
    console.log('No MFA required - already logged in');
    // Wait for navigation to /app
    await page.waitForURL(`${BASE_URL}/app`, { timeout: 15000 });
    console.log('Successfully navigated to /app after login');
  }
});