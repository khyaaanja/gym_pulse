import { test, expect } from "@playwright/test";

test.describe("Visual Regression Tests", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.describe("3D Components", () => {
    test("gym-rig renders correctly", async ({ page }) => {
      await page.goto("/test/3d/gym-rig");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000); // Allow 3D to render
      
      await expect(page).toHaveScreenshot("gym-rig.png", {
        maxDiffPixels: 100,
        threshold: 0.2,
      });
    });

    test("gym-lifter renders correctly", async ({ page }) => {
      await page.goto("/test/3d/gym-lifter");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      
      await expect(page).toHaveScreenshot("gym-lifter.png", {
        maxDiffPixels: 100,
        threshold: 0.2,
      });
    });

    test("gym-scene renders correctly", async ({ page }) => {
      await page.goto("/test/3d/gym-scene");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      
      await expect(page).toHaveScreenshot("gym-scene.png", {
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    });
  });

  test.describe("Dashboard Charts", () => {
    test("attendance chart renders", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      const chart = page.locator('[data-chart="attendance"]');
      await expect(chart).toBeVisible();
      
      await expect(chart).toHaveScreenshot("attendance-chart.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("revenue chart renders", async ({ page }) => {
      await page.goto("/app/analytics");
      await page.waitForLoadState("networkidle");
      
      const chart = page.locator('[data-chart="revenue"]');
      await expect(chart).toBeVisible();
      
      await expect(chart).toHaveScreenshot("revenue-chart.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("retention pulse chart renders", async ({ page }) => {
      await page.goto("/app/pulse");
      await page.waitForLoadState("networkidle");
      
      const chart = page.locator('[data-chart="retention-pulse"]');
      await expect(chart).toBeVisible();
      
      await expect(chart).toHaveScreenshot("retention-pulse.png", {
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });
  });

  test.describe("Public Gym Pages", () => {
    test("public gym page renders", async ({ page }) => {
      await page.goto("/g/test-gym");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("public-gym-page.png", {
        fullPage: true,
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    });

    test("join page renders", async ({ page }) => {
      await page.goto("/g/test-gym/join");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("join-page.png", {
        fullPage: true,
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });

    test("poster page renders", async ({ page }) => {
      await page.goto("/g/test-gym/poster");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("poster-page.png", {
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });
  });

  test.describe("Member-Facing Pages", () => {
    test("member home renders", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("member-home.png", {
        fullPage: true,
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });

    test("member renew page renders", async ({ page }) => {
      await page.goto("/app/renew");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("member-renew.png", {
        fullPage: true,
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });

    test("marketplace page renders", async ({ page }) => {
      await page.goto("/app/marketplace");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("marketplace.png", {
        fullPage: true,
        maxDiffPixels: 150,
        threshold: 0.2,
      });
    });

    test("diet calculator renders", async ({ page }) => {
      await page.goto("/app/diet");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("diet-calculator.png", {
        fullPage: true,
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });
  });

  test.describe("Receipt & Print Layouts", () => {
    test("receipt page renders", async ({ page }) => {
      await page.goto("/app/receipts/test-receipt");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("receipt.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("receipt print layout renders", async ({ page }) => {
      await page.goto("/app/receipts/test-receipt?print=true");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("receipt-print.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });
  });

  test.describe("Kiosk Mode", () => {
    test("kiosk page renders", async ({ page }) => {
      await page.goto("/app/kiosk");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("kiosk.png", {
        fullPage: true,
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });

    test("self check-in page renders", async ({ page }) => {
      await page.goto("/checkin/self");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("self-checkin.png", {
        fullPage: true,
        maxDiffPixels: 100,
        threshold: 0.15,
      });
    });
  });

  test.describe("Responsive Views", () => {
    const viewports = [
      { name: "mobile", width: 375, height: 667 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1280, height: 720 },
      { name: "wide", width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      test(`dashboard at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/app");
        await page.waitForLoadState("networkidle");
        
        await expect(page).toHaveScreenshot(`dashboard-${viewport.name}.png`, {
          fullPage: true,
          maxDiffPixels: 200,
          threshold: 0.2,
        });
      });
    }
  });

  test.describe("Dark Mode", () => {
    test.use({ colorScheme: "dark" });

    test("dashboard in dark mode", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("dashboard-dark.png", {
        fullPage: true,
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    });

    test("public gym page in dark mode", async ({ page }) => {
      await page.goto("/g/test-gym");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("public-gym-dark.png", {
        fullPage: true,
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    });
  });

  test.describe("UI Components", () => {
    test("button variants", async ({ page }) => {
      await page.goto("/test/ui/buttons");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("buttons.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("form fields", async ({ page }) => {
      await page.goto("/test/ui/forms");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("form-fields.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("cards", async ({ page }) => {
      await page.goto("/test/ui/cards");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("cards.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("modals", async ({ page }) => {
      await page.goto("/test/ui/modals");
      await page.waitForLoadState("networkidle");
      await page.click('button:has-text("Open Modal")');
      
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await expect(page).toHaveScreenshot("modal.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("tables", async ({ page }) => {
      await page.goto("/test/ui/tables");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("tables.png", {
        maxDiffPixels: 50,
        threshold: 0.1,
      });
    });

    test("badges", async ({ page }) => {
      await page.goto("/test/ui/badges");
      await page.waitForLoadState("networkidle");
      
      await expect(page).toHaveScreenshot("badges.png", {
        maxDiffPixels: 30,
        threshold: 0.1,
      });
    });
  });
});