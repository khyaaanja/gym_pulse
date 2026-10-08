import { chromium } from 'playwright';

// Screens script for GymPulse
// Generates/screenshots UI pages for documentation

(async () => {
  console.log('GymPulse Screens Generator');
  console.log('==========================\n');

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();
  page.setViewportSize({ width: 1920, height: 1080 });

  const PAGES = [
    { name: 'login', url: 'http://localhost:3000/login' },
    { name: 'signup', url: 'http://localhost:3000/signup' },
    { name: 'checkin', url: 'http://localhost:3000/checkin' },
    { name: 'marketplace', url: 'http://localhost:3000/marketplace' },
    { name: 'risk', url: 'http://localhost:3000/risk' },
  ];

  for (const { name, url } of PAGES) {
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForLoadState();

      // Take screenshot
      await page.screenshot({
        path: `screenshots/${name}.png`,
        fullPage: true,
        width: 1920,
        height: 1080,
      });

      console.log(`✅ Screenshot: screenshots/${name}.png`);
    } catch (error) {
      console.log(`❌ Failed: ${name} - ${error.message}`);
    }
  }

  await browser.close();
  console.log('\nScreens generation complete.');
})().catch((err) => {
  console.error('Error:', err);
});