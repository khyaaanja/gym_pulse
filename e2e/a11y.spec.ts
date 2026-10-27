import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility Tests (WCAG 2.1 AA)", () => {
  test.describe("Public Pages", () => {
    test("home page passes accessibility", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("public gym page passes accessibility", async ({ page }) => {
      await page.goto("/g/test-gym");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("join page passes accessibility", async ({ page }) => {
      await page.goto("/g/test-gym/join");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("login page passes accessibility", async ({ page }) => {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("signup page passes accessibility", async ({ page }) => {
      await page.goto("/signup");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  });

  test.describe("Member-Facing Pages", () => {
    test.use({ storageState: "e2e/.auth/member.json" });

    test("member dashboard passes accessibility", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("member check-in passes accessibility", async ({ page }) => {
      await page.goto("/app");
      await page.click('button:has-text("Check In")');
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("member renew page passes accessibility", async ({ page }) => {
      await page.goto("/app/renew");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("member marketplace passes accessibility", async ({ page }) => {
      await page.goto("/app/marketplace");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("member settings passes accessibility", async ({ page }) => {
      await page.goto("/app/settings");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("diet calculator passes accessibility", async ({ page }) => {
      await page.goto("/app/diet");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  });

  test.describe("Kiosk Mode", () => {
    test("self check-in page passes accessibility", async ({ page }) => {
      await page.goto("/checkin/self");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("kiosk page passes accessibility", async ({ page }) => {
      await page.goto("/app/kiosk");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  });

  test.describe("Owner/Admin Pages", () => {
    test.use({ storageState: "e2e/.auth/owner.json" });

    test("owner dashboard passes accessibility", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("members management passes accessibility", async ({ page }) => {
      await page.goto("/app/members");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("analytics page passes accessibility", async ({ page }) => {
      await page.goto("/app/analytics");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("reports page passes accessibility", async ({ page }) => {
      await page.goto("/app/reports");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("marketplace management passes accessibility", async ({ page }) => {
      await page.goto("/app/marketplace");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("settings page passes accessibility", async ({ page }) => {
      await page.goto("/app/settings");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  });

  test.describe("Super-Admin Pages", () => {
    test.use({ storageState: "e2e/.auth/superadmin.json" });

    test("super-admin dashboard passes accessibility", async ({ page }) => {
      await page.goto("/super-admin");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("gyms management passes accessibility", async ({ page }) => {
      await page.goto("/super-admin/gyms");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("support tickets passes accessibility", async ({ page }) => {
      await page.goto("/super-admin/support");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  });

  test.describe("Critical User Flows", () => {
    test("checkout flow passes accessibility", async ({ page }) => {
      await page.goto("/app/renew");
      await page.waitForLoadState("networkidle");
      
      // Select plan
      await page.click('[data-plan]:first-child');
      await page.click('button:has-text("Continue")');
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("member creation modal passes accessibility", async ({ page }) => {
      await page.goto("/app/members");
      await page.click('button:has-text("Add Member")');
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });

    test("payment form passes accessibility", async ({ page }) => {
      await page.goto("/app/renew");
      await page.click('[data-plan]:first-child');
      await page.click('button:has-text("Continue")');
      await page.click('button:has-text("Pay with Sandbox")');
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  });

  test.describe("Keyboard Navigation", () => {
    test("dashboard is keyboard navigable", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      // Tab through main navigation
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toBeVisible();
      
      // Should be able to reach all interactive elements
      let focusableCount = 0;
      while (focusableCount < 20) {
        await page.keyboard.press("Tab");
        const focused = await page.locator(":focus").getAttribute("data-testid");
        if (focused) focusableCount++;
        else break;
      }
      
      expect(focusableCount).toBeGreaterThan(5);
    });

    test("member list is keyboard navigable", async ({ page }) => {
      await page.goto("/app/members");
      await page.waitForLoadState("networkidle");
      
      // Tab to first member row
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toBeVisible();
      
      // Arrow keys should navigate rows
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
    });
  });

  test.describe("Screen Reader Support", () => {
    test("images have alt text", async ({ page }) => {
      await page.goto("/g/test-gym");
      await page.waitForLoadState("networkidle");
      
      const images = await page.locator("img").all();
      for (const img of images) {
        const alt = await img.getAttribute("alt");
        expect(alt).toBeTruthy();
      }
    });

    test("form inputs have labels", async ({ page }) => {
      await page.goto("/g/test-gym/join");
      await page.waitForLoadState("networkidle");
      
      const inputs = await page.locator("input, select, textarea").all();
      for (const input of inputs) {
        const id = await input.getAttribute("id");
        const ariaLabel = await input.getAttribute("aria-label");
        const ariaLabelledBy = await input.getAttribute("aria-labelledby");
        
        if (id) {
          const label = await page.locator(`label[for="${id}"]`).count();
          expect(label + (ariaLabel ? 1 : 0) + (ariaLabelledBy ? 1 : 0)).toBeGreaterThan(0);
        }
      }
    });

    test("headings are hierarchical", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      const headings = await page.locator("h1, h2, h3, h4, h5, h6").all();
      let prevLevel = 0;
      
      for (const heading of headings) {
        const tagName = await heading.evaluate(el => el.tagName.toLowerCase());
        const level = parseInt(tagName[1]);
        
        if (prevLevel === 0) {
          expect(level).toBe(1); // First heading should be h1
        } else {
          expect(level - prevLevel).toBeLessThanOrEqual(1); // No skipping levels
        }
        prevLevel = level;
      }
    });

    test("live regions for dynamic content", async ({ page }) => {
      await page.goto("/app");
      await page.click('button:has-text("Check In")');
      await page.waitForLoadState("networkidle");
      
      // Success message should be announced
      const liveRegion = page.locator('[role="status"], [role="alert"], [aria-live]');
      await expect(liveRegion).toBeVisible();
    });
  });

  test.describe("Color Contrast", () => {
    test("text meets contrast requirements", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      const results = await new AxeBuilder({ page })
        .withTags(["cat.color"])
        .analyze();
      
      // Filter for contrast violations only
      const contrastViolations = results.violations.filter(v => 
        v.id === "color-contrast" || v.id === "text-contrast"
      );
      expect(contrastViolations).toEqual([]);
    });

    test("focus indicators are visible", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      // Focus first interactive element
      await page.keyboard.press("Tab");
      
      const focused = page.locator(":focus");
      const styles = await focused.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          outline: computed.outline,
          outlineWidth: computed.outlineWidth,
          boxShadow: computed.boxShadow,
        };
      });
      
      // Should have visible focus indicator
      const hasFocusIndicator = 
        styles.outline !== "none" && styles.outlineWidth !== "0px" ||
        styles.boxShadow !== "none";
      
      expect(hasFocusIndicator).toBe(true);
    });
  });

  test.describe("Reduced Motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("animations respect reduced motion", async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      
      // Check for animation properties
      const animatedElements = await page.locator("*").evaluateAll(els => 
        els.filter(el => {
          const style = window.getComputedStyle(el);
          return style.animationName !== "none" || style.transitionProperty !== "none";
        }).length
      );
      
      // Should have minimal/no animations
      expect(animatedElements).toBeLessThan(5);
    });
  });
});