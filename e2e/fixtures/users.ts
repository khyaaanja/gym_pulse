import { test as base, type Page } from "@playwright/test";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";

type UserFixtures = {
  owner: { email: string; password: string; page: Page };
  staff: { email: string; password: string; page: Page; role: string };
  member: { email: string; password: string; page: Page };
  superAdmin: { email: string; password: string; page: Page };
};

export const test = base.extend<UserFixtures>({
  owner: async ({ page }, use) => {
    // Create or get test owner
    const email = `owner-${Date.now()}@test.com`;
    const password = "GymPulse!Test2026";
    
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name: "Test Owner", passwordHash },
    });

    const gym = await prisma.gym.create({
      data: {
        name: "E2E Test Gym",
        slug: `e2e-gym-${Date.now()}`,
        email: "e2e@gym.com",
        phone: "+977-1-1234567",
        city: "Kathmandu",
        timezone: "Asia/Kathmandu",
        currency: "NPR",
        currencySymbol: "Rs.",
        status: "ACTIVE",
        onboardingStep: 5,
        onboardedAt: new Date(),
      },
    });

    await prisma.staffMember.create({
      data: { gymId: gym.id, userId: user.id, role: "OWNER", active: true },
    });

    const plan = await prisma.membershipPlan.create({
      data: { gymId: gym.id, name: "Monthly", durationDays: 30, pricePaisa: 500000, active: true },
    });

    // Login
    await page.goto("/login");
    await page.fill('[name="identifier"]', email);
    await page.fill('[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL("/app");

    await use({ email, password, page });

    // Cleanup
    await prisma.$transaction([
      prisma.membershipPlan.deleteMany({ where: { gymId: gym.id } }),
      prisma.staffMember.deleteMany({ where: { gymId: gym.id } }),
      prisma.gym.delete({ where: { id: gym.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);
  },

  staff: async ({ page }, use) => {
    const email = `staff-${Date.now()}@test.com`;
    const password = "StaffPass!2026";
    const role = "TRAINER";

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name: "Test Staff", passwordHash },
    });

    const gym = await prisma.gym.findFirst({ where: { slug: { startsWith: "e2e-gym-" } } });
    if (gym) {
      await prisma.staffMember.create({
        data: { gymId: gym.id, userId: user.id, role: role as any, active: true },
      });
    }

    await page.goto("/login");
    await page.fill('[name="identifier"]', email);
    await page.fill('[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL("/app");

    await use({ email, password, page, role });

    await prisma.staffMember.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  },

  member: async ({ page }, use) => {
    const email = `member-${Date.now()}@test.com`;
    const password = "MemberPass!2026";

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name: "Test Member", passwordHash },
    });

    const gym = await prisma.gym.findFirst({ where: { slug: { startsWith: "e2e-gym-" } } });
    if (gym) {
      const member = await prisma.member.create({
        data: {
          gymId: gym.id,
          userId: user.id,
          memberCode: `M${Date.now()}`,
          fullName: "Test Member",
          email,
          joinedOn: new Date(),
          status: "ACTIVE",
        },
      });

      const plan = await prisma.membershipPlan.findFirst({ where: { gymId: gym.id } });
      if (plan) {
        await prisma.membership.create({
          data: {
            gymId: gym.id,
            memberId: member.id,
            planId: plan.id,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 86400000),
            pricePaisa: plan.pricePaisa,
            status: "ACTIVE",
          },
        });
      }
    }

    await page.goto("/login");
    await page.fill('[name="identifier"]', email);
    await page.fill('[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL("/app");

    await use({ email, password, page });

    await prisma.member.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  },

  superAdmin: async ({ page }, use) => {
    const email = "admin@gympulse.demo";
    const password = "SuperAdmin!2026";

    await page.goto("/super-admin/login");
    await page.fill('[name="identifier"]', email);
    await page.fill('[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL("/super-admin");

    await use({ email, password, page });
  },
});

export { expect } from "@playwright/test";