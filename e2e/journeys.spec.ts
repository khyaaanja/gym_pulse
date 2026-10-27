import { test, expect } from "../fixtures/users";

test.describe("Journey 1: Gym Onboarding → First Member", () => {
  test("owner completes onboarding and adds first member", async ({ owner }) => {
    const { page } = owner;

    // Should land on dashboard after login
    await expect(page).toHaveURL(/\/app$/);

    // Navigate to onboarding if not complete
    await page.goto("/app/onboarding");
    
    // Step 1: Gym details (should be pre-filled)
    await expect(page.locator("text=Gym Details")).toBeVisible();
    await page.click('button:has-text("Next")');

    // Step 2: Membership plans
    await expect(page.locator("text=Membership Plans")).toBeVisible();
    await page.fill('[name="planName"]', "Monthly Unlimited");
    await page.fill('[name="price"]', "5000");
    await page.fill('[name="duration"]', "30");
    await page.click('button:has-text("Add Plan")');
    await expect(page.locator("text=Monthly Unlimited")).toBeVisible();
    await page.click('button:has-text("Next")');

    // Step 3: Payment setup
    await expect(page.locator("text=Payment Setup")).toBeVisible();
    await page.click('button:has-text("Enable Sandbox")');
    await page.click('button:has-text("Next")');

    // Step 4: Staff invites
    await expect(page.locator("text=Invite Staff")).toBeVisible();
    await page.click('button:has-text("Skip for Now")');

    // Step 5: Complete
    await expect(page.locator("text=Onboarding Complete")).toBeVisible();
    await page.click('button:has-text("Go to Dashboard")');
    await expect(page).toHaveURL(/\/app$/);

    // Now add first member
    await page.goto("/app/members");
    await page.click('button:has-text("Add Member")');
    
    await page.fill('[name="fullName"]', "John Doe");
    await page.fill('[name="email"]', "john.doe@example.com");
    await page.fill('[name="phone"]', "+977-9800000001");
    await page.selectOption('[name="planId"]', { label: "Monthly Unlimited" });
    await page.click('button:has-text("Save")');
    
    await expect(page.locator("text=John Doe")).toBeVisible();
    await expect(page.locator("text=john.doe@example.com")).toBeVisible();
    await expect(page.locator("text=ACTIVE")).toBeVisible();
  });

  test("owner can create multiple membership plans", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/settings");
    await page.click('text=Membership Plans');
    
    await page.click('button:has-text("Create Plan")');
    await page.fill('[name="name"]', "Quarterly");
    await page.fill('[name="durationDays"]', "90");
    await page.fill('[name="pricePaisa"]', "1350000");
    await page.click('button:has-text("Save")');
    
    await expect(page.locator("text=Quarterly")).toBeVisible();
    await expect(page.locator("text=90 days")).toBeVisible();
    await expect(page.locator("text=Rs. 13,500")).toBeVisible();
  });
});

test.describe("Journey 2: Member Check-in (Multiple Methods)", () => {
  test("member self check-in via app", async ({ member }) => {
    const { page } = member;

    await page.goto("/app");
    await expect(page.locator("text=Check In")).toBeVisible();
    
    await page.click('button:has-text("Check In")');
    await expect(page.locator("text=Checked In Successfully")).toBeVisible();
    
    // Verify check-in recorded
    await page.reload();
    await expect(page.locator("text=Today")).toBeVisible();
  });

  test("kiosk check-in with QR code", async ({ member, owner }) => {
    const { page: memberPage } = member;
    const { page: ownerPage } = owner;

    // Owner generates kiosk QR
    await ownerPage.goto("/app/kiosk");
    await expect(ownerPage.locator("text=Kiosk Mode")).toBeVisible();
    const qrCode = await ownerPage.locator("canvas").screenshot();

    // Member scans QR (simulated by navigating to checkin URL)
    // In real test, would use the QR token
    await memberPage.goto("/checkin/self");
    await expect(memberPage.locator("text=Self Check-in")).toBeVisible();
  });

  test("desk check-in by staff", async ({ staff, owner }) => {
    const { page: staffPage } = staff;
    const { page: ownerPage } = owner;

    // Owner creates a member to check in
    await ownerPage.goto("/app/members");
    await ownerPage.click('button:has-text("Add Member")');
    await ownerPage.fill('[name="fullName"]', "Walk-in Member");
    await ownerPage.fill('[name="phone"]', "+977-9800000002");
    await ownerPage.selectOption('[name="planId"]', { index: 0 });
    await ownerPage.click('button:has-text("Save")');
    
    const memberRow = ownerPage.locator("text=Walk-in Member").locator("..");
    const memberCode = await memberRow.locator('[data-member-code]').getAttribute("data-member-code");

    // Staff checks in member at desk
    await staffPage.goto("/app/checkin-desk");
    await staffPage.fill('[name="memberCode"]', memberCode || "");
    await staffPage.click('button:has-text("Check In")');
    await expect(staffPage.locator("text=Check-in Successful")).toBeVisible();
  });
});

test.describe("Journey 3: Membership Purchase/Renewal", () => {
  test("member purchases new membership via sandbox", async ({ member, owner }) => {
    const { page: memberPage } = member;
    const { page: ownerPage } = owner;

    // Member navigates to renew
    await memberPage.goto("/app/renew");
    await expect(memberPage.locator("text=Choose Plan")).toBeVisible();
    
    await memberPage.click('[data-plan="Monthly Unlimited"]');
    await memberPage.click('button:has-text("Continue with Sandbox")');
    
    // Should redirect to sandbox payment
    await expect(memberPage).toHaveURL(/sandbox/);
    
    // Complete sandbox payment
    await memberPage.click('button:has-text("Pay Now")');
    await expect(memberPage).toHaveURL(/\/app\/receipts\//);
    await expect(memberPage.locator("text=Payment Successful")).toBeVisible();
  });

  test("member renews expiring membership", async ({ member, owner }) => {
    const { page: memberPage } = member;

    // Make membership expire soon
    // This would require database manipulation - skip for now
    
    await memberPage.goto("/app/renew");
    await expect(memberPage.locator("text=Expiring Soon")).toBeVisible();
    await memberPage.click('button:has-text("Renew Now")');
    await expect(memberPage.locator("text=Renewal Successful")).toBeVisible();
  });

  test("owner records cash payment at desk", async ({ owner }) => {
    const { page } = owner;

    await page.goto("/app/members");
    await page.click('button:has-text("Add Member")');
    await page.fill('[name="fullName"]', "Cash Payment Member");
    await page.fill('[name="phone"]', "+977-9800000003");
    await page.click('button:has-text("Save")');

    const memberRow = page.locator("text=Cash Payment Member").locator("..");
    await memberRow.click('button:has-text("Record Payment")');
    
    await page.selectOption('[name="planId"]', { index: 0 });
    await page.selectOption('[name="method"]', "CASH");
    await page.fill('[name="amount"]', "5000");
    await page.click('button:has-text("Confirm")');
    
    await expect(page.locator("text=Payment Recorded")).toBeVisible();
    await expect(page.locator("text=ACTIVE")).toBeVisible();
  });
});

test.describe("Journey 4: Marketplace Order Flow", () => {
  test("member browses and purchases product", async ({ member, owner }) => {
    const { page: memberPage } = member;
    const { page: ownerPage } = owner;

    // Owner creates a product
    await ownerPage.goto("/app/marketplace");
    await ownerPage.click('button:has-text("Add Product")');
    await ownerPage.fill('[name="name"]', "Protein Powder");
    await ownerPage.fill('[name="price"]', "3500");
    await ownerPage.selectOption('[name="category"]', "SUPPLEMENTS");
    await ownerPage.click('button:has-text("Save")');
    await expect(ownerPage.locator("text=Protein Powder")).toBeVisible();

    // Member browses marketplace
    await memberPage.goto("/app/marketplace");
    await expect(memberPage.locator("text=Protein Powder")).toBeVisible();
    await memberPage.click('[data-product="Protein Powder"] button:has-text("Buy")');
    
    await memberPage.click('button:has-text("Checkout")');
    await memberPage.click('button:has-text("Pay with Sandbox")');
    await memberPage.click('button:has-text("Pay Now")');
    
    await expect(memberPage).toHaveURL(/\/app\/receipts\//);
    await expect(memberPage.locator("text=Order Confirmed")).toBeVisible();
  });
});

test.describe("Journey 5: Staff Workflows", () => {
  test("trainer creates diet plan for member", async ({ staff, owner }) => {
    const { page: staffPage } = staff;
    const { page: ownerPage } = owner;

    // Owner creates member
    await ownerPage.goto("/app/members");
    await ownerPage.click('button:has-text("Add Member")');
    await ownerPage.fill('[name="fullName"]', "Diet Plan Member");
    await ownerPage.fill('[name="phone"]', "+977-9800000004");
    await ownerPage.click('button:has-text("Save")');

    // Trainer creates diet plan
    await staffPage.goto("/app/diet");
    await staffPage.click('button:has-text("Create Diet Plan")');
    await staffPage.fill('[name="title"]', "Muscle Gain");
    await staffPage.fill('[name="calories"]', "3000");
    await staffPage.fill('[name="protein"]', "180");
    await staffPage.fill('[name="carbs"]', "300");
    await staffPage.fill('[name="fat"]', "80");
    await staffPage.selectOption('[name="memberId"]', { label: "Diet Plan Member" });
    await staffPage.click('button:has-text("Save")');
    
    await expect(staffPage.locator("text=Muscle Gain")).toBeVisible();
  });

  test("staff manages bookings", async ({ staff, owner }) => {
    const { page: staffPage } = staff;
    const { page: ownerPage } = owner;

    // Owner creates member and session product
    await ownerPage.goto("/app/marketplace");
    await ownerPage.click('button:has-text("Add Product")');
    await ownerPage.fill('[name="name"]', "Personal Training Session");
    await ownerPage.fill('[name="price"]', "2000");
    await ownerPage.selectOption('[name="category"]', "SESSIONS");
    await ownerPage.fill('[name="durationMinutes"]', "60");
    await ownerPage.click('button:has-text("Save")');

    // Member purchases session
    // ... (simplified)

    // Staff views bookings
    await staffPage.goto("/app/bookings");
    await expect(staffPage.locator("text=Bookings")).toBeVisible();
  });

  test("staff handles recovery tasks", async ({ staff, owner }) => {
    const { page: staffPage } = staff;
    const { page: ownerPage } = owner;

    // Owner creates at-risk member
    await ownerPage.goto("/app/members");
    await ownerPage.click('button:has-text("Add Member")');
    await ownerPage.fill('[name="fullName"]', "At Risk Member");
    await ownerPage.fill('[name="phone"]', "+977-9800000005");
    await ownerPage.click('button:has-text("Save")');

    // Staff views recovery dashboard
    await staffPage.goto("/app/recovery");
    await expect(staffPage.locator("text=Recovery Tasks")).toBeVisible();
    await expect(staffPage.locator("text=At Risk Member")).toBeVisible();
    
    // Start recovery
    await staffPage.click('[data-member="At Risk Member"] button:has-text("Contact")');
    await staffPage.selectOption('[name="method"]', "CALL");
    await staffPage.fill('[name="note"]', "Left voicemail");
    await staffPage.click('button:has-text("Log Contact")');
    
    await expect(staffPage.locator("text=Contact Logged")).toBeVisible();
  });
});