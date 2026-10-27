import { test, expect } from "../fixtures/users";

test.describe("Journey 6: Owner Dashboard", () => {
  test("owner views dashboard with key metrics", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app");
    await expect(page.locator("text=Dashboard")).toBeVisible();
    
    // Key metrics cards
    await expect(page.locator("text=Total Members")).toBeVisible();
    await expect(page.locator("text=Active Memberships")).toBeVisible();
    await expect(page.locator("text=Revenue")).toBeVisible();
    await expect(page.locator("text=Check-ins Today")).toBeVisible();

    // Charts
    await expect(page.locator("canvas")).toBeVisible(); // Attendance chart
    await expect(page.locator("text=Revenue Trend")).toBeVisible();
  });

  test("owner views member analytics", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/analytics");
    await expect(page.locator("text=Member Analytics")).toBeVisible();
    
    await expect(page.locator("text=New Members")).toBeVisible();
    await expect(page.locator("text=Retention Rate")).toBeVisible();
    await expect(page.locator("text=Churn Rate")).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible(); // Trend chart
  });

  test("owner views retention predictions", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/pulse");
    await expect(page.locator("text=Retention Pulse")).toBeVisible();
    
    await expect(page.locator("text=At Risk")).toBeVisible();
    await expect(page.locator("text=Expiring Soon")).toBeVisible();
    await expect(page.locator("text=Healthy")).toBeVisible();
    
    // Click on at-risk member
    await page.click('[data-risk="HIGH"]:first-child');
    await expect(page.locator("text=Member Details")).toBeVisible();
  });

  test("owner generates and downloads report", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/reports");
    await expect(page.locator("text=Reports")).toBeVisible();
    
    await page.click('button:has-text("Generate Report")');
    await page.selectOption('[name="reportType"]', "MONTHLY_REVENUE");
    await page.click('button:has-text("Generate")');
    
    await expect(page.locator("text=Report Generated")).toBeVisible();
    await page.click('button:has-text("Download")');
    // Download would be tested separately
  });
});

test.describe("Journey 7: Super-Admin Operations", () => {
  test("super-admin views all gyms", async ({ superAdmin }) => {
    const { page } = superAdmin;

    await page.goto("/super-admin");
    await expect(page.locator("text=Gyms")).toBeVisible();
    
    await expect(page.locator("text=E2E Test Gym")).toBeVisible();
    await expect(page.locator("text=ACTIVE")).toBeVisible();
  });

  test("super-admin manages SaaS plans", async ({ superAdmin }) => {
    const { page } = superAdmin;

    await page.goto("/super-admin/plans");
    await expect(page.locator("text=Plans")).toBeVisible();
    
    await page.click('button:has-text("Create Plan")');
    await page.fill('[name="name"]', "Enterprise");
    await page.fill('[name="pricePaisa"]', "5000000");
    await page.fill('[name="memberLimit"]', "1000");
    await page.click('button:has-text("Save")');
    
    await expect(page.locator("text=Enterprise")).toBeVisible();
  });

  test("super-admin views platform analytics", async ({ superAdmin }) => {
    const { page } = superAdmin;

    await page.goto("/super-admin/analytics");
    await expect(page.locator("text=Platform Analytics")).toBeVisible();
    
    await expect(page.locator("text=Total Gyms")).toBeVisible();
    await expect(page.locator("text=Total Members")).toBeVisible();
    await expect(page.locator("text=Monthly Revenue")).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("super-admin handles support tickets", async ({ superAdmin }) => {
    const { page } = superAdmin;

    await page.goto("/super-admin/support");
    await expect(page.locator("text=Support Tickets")).toBeVisible();
    
    await page.click('[data-ticket]:first-child');
    await expect(page.locator("text=Ticket Details")).toBeVisible();
    
    await page.fill('[name="response"]', "Working on this issue");
    await page.click('button:has-text("Send Response")');
    await expect(page.locator("text=Response Sent")).toBeVisible();
  });

  test("super-admin manages feature flags", async ({ superAdmin }) => {
    const { page } = superAdmin;

    await page.goto("/super-admin/flags");
    await expect(page.locator("text=Feature Flags")).toBeVisible();
    
    await page.click('[data-flag="new_dashboard"] button:has-text("Enable")');
    await expect(page.locator("text=Enabled")).toBeVisible();
  });
});

test.describe("Journey 8: Public Page → Lead → Conversion", () => {
  test("visitor views public gym page", async ({ page }) => {
    const gym = await (await import("@/db/client")).prisma.gym.findFirst({ 
      where: { slug: { startsWith: "e2e-gym-" } } 
    });
    
    if (gym) {
      await page.goto(`/g/${gym.slug}`);
      await expect(page.locator("text=E2E Test Gym")).toBeVisible();
      await expect(page.locator("text=Join Now")).toBeVisible();
    }
  });

  test("visitor submits lead form", async ({ page }) => {
    const gym = await (await import("@/db/client")).prisma.gym.findFirst({ 
      where: { slug: { startsWith: "e2e-gym-" } } 
    });
    
    if (gym) {
      await page.goto(`/g/${gym.slug}/join`);
      await expect(page.locator("text=Start Your Fitness Journey")).toBeVisible();
      
      await page.fill('[name="name"]', "Jane Smith");
      await page.fill('[name="phone"]', "+977-9800000006");
      await page.fill('[name="email"]', "jane.smith@example.com");
      await page.fill('[name="goal"]', "Weight loss");
      await page.click('button:has-text("Submit")');
      
      await expect(page.locator("text=Thanks for your interest")).toBeVisible();
    }
  });

  test("owner converts lead to member", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/leads");
    await expect(page.locator("text=Leads")).toBeVisible();
    
    await expect(page.locator("text=Jane Smith")).toBeVisible();
    await page.click('[data-lead="Jane Smith"] button:has-text("Convert")');
    
    await page.selectOption('[name="planId"]', { index: 0 });
    await page.click('button:has-text("Create Membership")');
    
    await expect(page.locator("text=Member Created")).toBeVisible();
    await expect(page.locator("text=Jane Smith")).toBeVisible();
  });
});

test.describe("Cross-cutting: Settings & Preferences", () => {
  test("member updates notification preferences", async ({ member }) => {
    const { page } = member;

    await page.goto("/app/settings");
    await page.click('text=Notifications');
    
    await page.uncheck('[name="email-marketing"]');
    await page.check('[name="push-checkin"]');
    await page.click('button:has-text("Save")');
    
    await expect(page.locator("text=Preferences Saved")).toBeVisible();
  });

  test("member sets up MFA", async ({ member }) => {
    const { page } = member;

    await page.goto("/app/security");
    await page.click('button:has-text("Enable MFA")');
    
    await expect(page.locator("text=Scan QR Code")).toBeVisible();
    await page.fill('[name="token"]', "123456"); // Would use real TOTP in integration
    await page.click('button:has-text("Verify")');
    
    // In real test, would verify TOTP
  });

  test("owner manages gym settings", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/settings");
    await page.click('text=Gym Settings');
    
    await page.fill('[name="phone"]', "+977-1-9876543");
    await page.fill('[name="address"]', "New Address, Kathmandu");
    await page.selectOption('[name="timezone"]', "Asia/Kathmandu");
    await page.click('button:has-text("Save")');
    
    await expect(page.locator("text=Settings Saved")).toBeVisible();
  });
});