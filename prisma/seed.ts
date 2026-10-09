/**
 * Demo data for local development and demos. Refuses to run in production.
 * Creates: platform config (plans, flags, providers, templates, automations, commissions, content),
 * three gyms (a healthy 200-member gym, a tiny trial gym with too little data for an estimate,
 * and a suspended gym), 7 months of attendance, memberships, payments, marketplace activity,
 * recovery history, two record imports run through the real import pipeline, and prediction reports.
 */
import "dotenv/config";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { addDays, diffDays, toDbDate, today as todayIn, type DateOnly } from "@/lib/time";
import { generatePredictionReport, evaluateOutcomes, recalculateGymRisk } from "@/services/risk/run";
import { createImport, processImport, requestCommit, commitImport, applyRowAction } from "@/services/imports/pipeline";
import { streakFrom } from "@/services/attendance";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { platformReferenceData } from "./reference-data";

if (process.env.APP_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "GymPulse!Demo2026";

// Deterministic PRNG so demo data is identical on every run.
let seed = 20260924;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST = ["Aarav", "Sita", "Ram", "Gita", "Hari", "Sunita", "Bikash", "Anjali", "Suman", "Pooja", "Nabin", "Sabina", "Rajesh", "Kabita", "Prakash", "Manisha", "Dipesh", "Srijana", "Kiran", "Asmita", "Roshan", "Bipana", "Sagar", "Ritu", "Anil", "Pratima", "Sujan", "Nisha", "Bishal", "Shristi", "Aayush", "Samjhana", "Pawan", "Sarita", "Rohit", "Laxmi", "Niraj", "Susmita", "Ujjwal", "Rekha", "Saurav", "Priya", "Binod", "Muna", "Ashish", "Kripa", "Rabin", "Alisha", "Tenzing", "Pema"];
const LAST = ["Shrestha", "Sharma", "Adhikari", "Thapa", "Gurung", "Tamang", "Rai", "Limbu", "Magar", "Karki", "Basnet", "Poudel", "Khadka", "Bhattarai", "Koirala", "Maharjan", "Joshi", "Pandey", "Bista", "Shahi", "KC", "Lama", "Sherpa", "Pradhan", "Dahal", "Ghimire", "Aryal", "Neupane", "Subedi", "Rana"];

function nepalPhone() {
  return `98${between(0, 9)}${String(between(0, 9999999)).padStart(7, "0")}`;
}

/** Visit time in Nepal local time → UTC instant. */
function visitInstant(day: DateOnly, early: boolean) {
  const minutes = early ? between(5 * 60 + 15, 8 * 60 + 30) : between(16 * 60, 20 * 60);
  const utcMinutes = minutes - (5 * 60 + 45);
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + utcMinutes * 60_000);
}

async function platform() {
  const planRows = await platformReferenceData(prisma, { overwrite: true, supportEmail: "support@gympulse.example" });

  const admins = [
    { email: "super@gympulse.local", name: "Priya Admin", role: "SUPER_ADMIN" as const },
    { email: "support@gympulse.local", name: "Sujan Support", role: "SUPPORT_ADMIN" as const },
    { email: "finance@gympulse.local", name: "Kabita Finance", role: "FINANCE_ADMIN" as const },
  ];
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const a of admins) await prisma.platformAdmin.upsert({ where: { email: a.email }, create: { ...a, passwordHash: hash }, update: {} });

  // Demo only: the test gateway lets members approve their own payments.
  if (!(await prisma.paymentProviderConfig.findFirst({ where: { gymId: null, providerKey: "sandbox" } }))) {
    await prisma.paymentProviderConfig.create({ data: { gymId: null, providerKey: "sandbox", displayName: "GymPulse Test Gateway", enabled: true, methods: ["test"] } });
  }
  return planRows;
}

type SeedMember = { id: string; pattern: string; joined: DateOnly; planIdx: number };

async function bigGym(plans: Record<string, { id: string }>) {
  const existing = await prisma.gym.findUnique({ where: { slug: "pulse-fitness" } });
  if (existing) {
    console.log("Pulse Fitness already seeded — skipping gym data.");
    return existing;
  }
  const tz = "Asia/Kathmandu";
  const today = todayIn(tz);
  const gym = await prisma.gym.create({
    data: {
      name: "Pulse Fitness Kathmandu", slug: "pulse-fitness", phone: "01-4481234", email: "hello@pulsefitness.demo",
      address: "New Baneshwor", city: "Kathmandu", province: "Bagmati", status: "ACTIVE", planId: plans.growth!.id, onboardingStep: 10, onboardedAt: new Date(),
      settings: {}, createdAt: new Date(`${addDays(today, -220)}T04:00:00Z`),
    },
  });
  await prisma.subscription.create({ data: { gymId: gym.id, planId: plans.growth!.id, status: "ACTIVE", currentPeriodStart: new Date(`${addDays(today, -12)}T00:00:00Z`), currentPeriodEnd: new Date(`${addDays(today, 18)}T00:00:00Z`) } });
  await prisma.location.create({ data: { gymId: gym.id, name: "Baneshwor", address: "New Baneshwor, Kathmandu", isPrimary: true } });

  const hash = await hashPassword(DEMO_PASSWORD);
  const mkUser = (email: string, name: string, phone?: string) => prisma.user.create({ data: { email, name, phone, passwordHash: hash, emailVerifiedAt: new Date() } });
  const owner = await mkUser("owner@pulsefitness.demo", "Rajan Maharjan", "9801000001");
  const manager = await mkUser("manager@pulsefitness.demo", "Sneha Karki", "9801000002");
  const staffU = await mkUser("staff@pulsefitness.demo", "Bikram Rai", "9801000003");
  const t1 = await mkUser("trainer@pulsefitness.demo", "Tenzing Sherpa", "9801000004");
  const t2 = await mkUser("trainer2@pulsefitness.demo", "Anita Gurung", "9801000005");
  await prisma.staffMember.create({ data: { gymId: gym.id, userId: owner.id, role: "OWNER", title: "Owner" } });
  await prisma.staffMember.create({ data: { gymId: gym.id, userId: manager.id, role: "MANAGER", title: "Gym Manager" } });
  await prisma.staffMember.create({ data: { gymId: gym.id, userId: staffU.id, role: "STAFF", title: "Front desk" } });
  const trainer1 = await prisma.staffMember.create({ data: { gymId: gym.id, userId: t1.id, role: "TRAINER", title: "Head Trainer", bio: "Strength & conditioning, 8 years.", specialties: ["Strength", "Weight loss"] } });
  const trainer2 = await prisma.staffMember.create({ data: { gymId: gym.id, userId: t2.id, role: "TRAINER", title: "Yoga & Mobility", bio: "RYT-500 yoga teacher.", specialties: ["Yoga", "Mobility"] } });

  const planDefs = [
    { name: "Monthly", durationDays: 30, pricePaisa: 150_000, sortOrder: 1, description: "Full gym access for 30 days" },
    { name: "Quarterly", durationDays: 90, pricePaisa: 400_000, sortOrder: 2, description: "3 months — save Rs. 500" },
    { name: "Half-yearly", durationDays: 180, pricePaisa: 750_000, sortOrder: 3, description: "6 months — save Rs. 1,500" },
    { name: "Annual", durationDays: 365, pricePaisa: 1_350_000, sortOrder: 4, description: "12 months — best value" },
  ];
  const mplans = [];
  for (const p of planDefs) mplans.push(await prisma.membershipPlan.create({ data: { ...p, gymId: gym.id } }));

  // Engagement config
  const badge = await prisma.reward.create({ data: { gymId: gym.id, name: "Streak badge", kind: "BADGE" } });
  const discount = await prisma.reward.create({ data: { gymId: gym.id, name: "10% off next renewal", kind: "DISCOUNT", value: 1000 } });
  const freePt = await prisma.reward.create({ data: { gymId: gym.id, name: "Free PT session", kind: "FREE_SESSION", value: 1 } });
  await prisma.milestone.createMany({
    data: [
      { gymId: gym.id, name: "Bronze", tier: "Bronze", kind: "STREAK", threshold: 5, rewardId: badge.id },
      { gymId: gym.id, name: "Silver", tier: "Silver", kind: "STREAK", threshold: 10, rewardId: badge.id },
      { gymId: gym.id, name: "Gold", tier: "Gold", kind: "STREAK", threshold: 14, rewardId: freePt.id },
      { gymId: gym.id, name: "Platinum", tier: "Platinum", kind: "STREAK", threshold: 30, rewardId: discount.id },
      { gymId: gym.id, name: "50 visits", tier: "Club 50", kind: "TOTAL_VISITS", threshold: 50, rewardId: badge.id },
      { gymId: gym.id, name: "100 visits", tier: "Club 100", kind: "TOTAL_VISITS", threshold: 100, rewardId: discount.id },
    ],
  });
  await prisma.challenge.createMany({
    data: [
      { gymId: gym.id, name: "10 visits this month", kind: "VISITS_IN_MONTH", target: 10, rewardId: badge.id, description: "Show up 10 times this month." },
      { gymId: gym.id, name: "20 visits this month", kind: "VISITS_IN_MONTH", target: 20, rewardId: freePt.id, description: "Twenty sessions in a month." },
      { gymId: gym.id, name: "30-day streak", kind: "STREAK_DAYS", target: 30, rewardId: discount.id, description: "Keep your streak alive for 30 visits (one rest day between is fine)." },
      { gymId: gym.id, name: "Weekend Warrior", kind: "WEEKEND_VISITS", target: 4, config: { weekendDays: [6] }, description: "Train on 4 Saturdays this month." },
      { gymId: gym.id, name: "Early Bird", kind: "EARLY_BIRD", target: 8, config: { beforeHour: 7 }, description: "8 check-ins before 7 AM this month." },
    ],
  });

  // Members with distinct behaviour patterns
  const patterns = [
    ...Array(90).fill("regular"), ...Array(40).fill("moderate"), ...Array(24).fill("decliner"),
    ...Array(20).fill("dropped"), ...Array(16).fill("new"), ...Array(10).fill("lost"),
  ] as string[];
  const usedNames = new Set<string>();
  const members: SeedMember[] = [];
  const attendance: { gymId: string; memberId: string; localDate: Date; checkedInAt: Date; method: "QR" | "STAFF" }[] = [];
  const memberships: { gymId: string; memberId: string; planId: string; startDate: Date; endDate: Date; pricePaisa: number; status: "ACTIVE" | "EXPIRED"; isRenewal: boolean }[] = [];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]!;
    let name = `${pick(FIRST)} ${pick(LAST)}`;
    while (usedNames.has(name)) name = `${pick(FIRST)} ${pick(LAST)}`;
    usedNames.add(name);
    // Two named members mirror the product's example scenarios.
    if (i === 0) name = "Aarav Shrestha";
    if (i === 130) name = "Rahul Sharma";
    const joinAgo = pattern === "new" ? between(10, 45) : between(90, 210);
    const joined = addDays(today, -joinAgo);
    const planIdx = pattern === "new" ? 0 : pick([0, 0, 0, 1, 1, 2, 3]);
    const m = await prisma.member.create({
      data: {
        gymId: gym.id, memberCode: `M-${String(i + 1).padStart(5, "0")}`, fullName: name, phone: nepalPhone(),
        email: rand() < 0.4 ? `${name.toLowerCase().replace(/[^a-z]/g, ".")}@example.com` : null,
        joinedOn: toDbDate(joined), trainerId: rand() < 0.2 ? pick([trainer1.id, trainer2.id]) : null,
        createdAt: new Date(`${joined}T05:00:00Z`),
      },
    });
    members.push({ id: m.id, pattern, joined, planIdx });

    // Membership chain from join date
    const plan = mplans[planIdx]!;
    let start = joined;
    let first = true;
    const lostEnd = pattern === "lost" ? addDays(today, -between(20, 80)) : null;
    // Rahul's membership ends in 8 days; Aarav's in 5 (renewal demo)
    const forcedEnd = i === 0 ? addDays(today, 5) : i === 130 ? addDays(today, 8) : null;
    while (true) {
      let end = addDays(start, plan.durationDays - 1);
      if (forcedEnd && end >= forcedEnd) end = forcedEnd;
      if (lostEnd && end > lostEnd) break;
      memberships.push({ gymId: gym.id, memberId: m.id, planId: plan.id, startDate: toDbDate(start), endDate: toDbDate(end), pricePaisa: plan.pricePaisa, status: end >= today ? "ACTIVE" : "EXPIRED", isRenewal: !first });
      first = false;
      if (end >= today) break;
      start = addDays(end, 1);
    }
    const lastEnd = memberships.filter((x) => x.memberId === m.id).at(-1)?.endDate;

    // Attendance by pattern
    const early = rand() < 0.45;
    const baseRate = pattern === "regular" ? 0.55 + rand() * 0.2 : pattern === "moderate" ? 0.25 + rand() * 0.1 : pattern === "new" ? 0.35 + rand() * 0.3 : 0.45 + rand() * 0.2;
    const stopAgo = pattern === "dropped" ? between(10, 40) : pattern === "lost" ? diffDays(lastEnd ? lastEnd.toISOString().slice(0, 10) : joined, today) + between(3, 15) : pattern === "decliner" ? between(3, 9) : 0;
    for (let d = joined; d <= today; d = addDays(d, 1)) {
      const ago = diffDays(d, today);
      if (ago === 0 && i !== 1) continue; // leave "today" mostly empty so check-ins can be demoed
      if (ago < stopAgo) continue;
      let rate = baseRate;
      if (pattern === "decliner" && ago < 35) rate = baseRate * 0.25;
      if (i === 0) rate = ago <= 12 ? 1 : 0.6; // Aarav: 12-day streak
      if (i === 130) rate = ago < 13 ? 0 : ago < 30 ? 0.2 : ago < 60 ? 0.47 : 0.45; // Rahul: sharp decline, 13 days inactive
      if (rand() < rate) attendance.push({ gymId: gym.id, memberId: m.id, localDate: toDbDate(d), checkedInAt: visitInstant(d, early), method: rand() < 0.7 ? "QR" : "STAFF" });
    }
  }
  for (let i = 0; i < memberships.length; i += 1000) await prisma.membership.createMany({ data: memberships.slice(i, i + 1000) });
  for (let i = 0; i < attendance.length; i += 2000) await prisma.attendance.createMany({ data: attendance.slice(i, i + 2000), skipDuplicates: true });

  // Denormalised engagement fields
  for (const m of members) {
    const days = attendance.filter((a) => a.memberId === m.id).map((a) => a.localDate.toISOString().slice(0, 10)).sort();
    const s = streakFrom(days, today);
    const last = attendance.filter((a) => a.memberId === m.id).at(-1);
    await prisma.member.update({ where: { id: m.id }, data: { totalVisits: days.length, currentStreak: s.current, bestStreak: s.best, lastAttendanceAt: last?.checkedInAt ?? null } });
  }

  // Payments for memberships in the last 120 days (+ ledger + receipts)
  const recent = await prisma.membership.findMany({ where: { gymId: gym.id, startDate: { gte: toDbDate(addDays(today, -120)) } }, include: { plan: true } });
  let n = 0;
  for (const ms of recent) {
    const paidAt = new Date(ms.startDate.getTime() + 4 * 3_600_000);
    const online = rand() < 0.45;
    const p = await prisma.payment.create({
      data: { gymId: gym.id, memberId: ms.memberId, membershipId: ms.id, purpose: "MEMBERSHIP", method: online ? "ONLINE" : pick(["CASH", "CASH", "BANK_TRANSFER"] as const), provider: online ? pick(["esewa", "khalti"]) : null, reference: `SEED-${String(++n).padStart(5, "0")}`, amountPaisa: ms.pricePaisa, planId: ms.planId, status: "SUCCEEDED", paidAt, recordedById: online ? null : staffU.id, createdAt: paidAt },
    });
    await prisma.invoice.create({ data: { gymId: gym.id, memberId: ms.memberId, paymentId: p.id, number: `R${paidAt.toISOString().slice(2, 10).replace(/-/g, "")}-${String(n).padStart(4, "0")}`, totalPaisa: ms.pricePaisa, issuedAt: paidAt, lines: [{ description: `${ms.plan.name} membership`, amountPaisa: ms.pricePaisa }] } });
    await prisma.ledgerEntry.create({ data: { gymId: gym.id, paymentId: p.id, account: "MEMBERSHIP_REVENUE", amountPaisa: ms.pricePaisa, description: `${ms.plan.name} membership`, createdAt: paidAt } });
  }
  for (let k = 0; k < 4; k++) {
    const m = pick(members.filter((x) => x.pattern === "dropped"));
    await prisma.payment.create({ data: { gymId: gym.id, memberId: m.id, purpose: "MEMBERSHIP", method: "ONLINE", provider: "esewa", reference: `SEED-F${k}`, amountPaisa: 150_000, planId: mplans[0]!.id, status: "FAILED", failureReason: "Payment was not completed", createdAt: new Date(Date.now() - between(1, 6) * 86_400_000) } });
  }

  // Marketplace
  const cat = async (slug: string) => (await prisma.marketplaceCategory.findUniqueOrThrow({ where: { slug } })).id;
  const vendor = await prisma.marketplaceVendor.upsert({ where: { id: "seed-vendor-himalayan" }, create: { id: "seed-vendor-himalayan", name: "Himalayan Nutrition Pvt. Ltd.", email: "sales@himalayan-nutrition.demo", phone: "9851000010", status: "APPROVED", description: "Lab-tested supplements, distributed in Nepal.", reviewedAt: new Date() }, update: {} });
  await prisma.marketplaceVendor.upsert({ where: { id: "seed-vendor-everest" }, create: { id: "seed-vendor-everest", name: "Everest Gear Traders", email: "hello@everestgear.demo", status: "PENDING", description: "Fitness accessories and equipment." }, update: {} });
  const vUser = await mkUser("vendor@himalayan-nutrition.demo", "Himalayan Nutrition");
  await prisma.vendorUser.create({ data: { vendorId: vendor.id, userId: vUser.id } });
  await prisma.vendorGym.create({ data: { gymId: gym.id, vendorId: vendor.id } });
  const productDefs = [
    { name: "Personal Training — 4 sessions", categoryId: await cat("personal-training"), kind: "SERVICE", pricePaisa: 600_000, sessionCount: 4, durationMinutes: 60, trainerId: trainer1.id, featured: true, suggestAtStreak: 14, description: "Four 1:1 sessions with a certified trainer, including a program you keep." },
    { name: "Personal Training — single session", categoryId: await cat("personal-training"), kind: "SERVICE", pricePaisa: 180_000, sessionCount: 1, durationMinutes: 60, trainerId: trainer1.id },
    { name: "Diet plan (4 weeks)", categoryId: await cat("diet-plans"), kind: "SERVICE", pricePaisa: 250_000, sessionCount: 2, description: "Nepali-food friendly plan with a check-in after 2 weeks." },
    { name: "Yoga class pack (8 classes)", categoryId: await cat("yoga"), kind: "SERVICE", pricePaisa: 300_000, sessionCount: 8, trainerId: trainer2.id, featured: true },
    { name: "Zumba — monthly", categoryId: await cat("zumba"), kind: "SERVICE", pricePaisa: 200_000, sessionCount: 12 },
    { name: "Boxing intro (3 sessions)", categoryId: await cat("boxing"), kind: "SERVICE", pricePaisa: 250_000, sessionCount: 3 },
    { name: "Fitness assessment", categoryId: await cat("fitness-assessments"), kind: "SERVICE", pricePaisa: 80_000, sessionCount: 1, suggestAtStreak: 5 },
    { name: "Recovery massage (45 min)", categoryId: await cat("recovery"), kind: "SERVICE", pricePaisa: 150_000, sessionCount: 1 },
    { name: "Pulse Fitness T-shirt", categoryId: await cat("merchandise"), kind: "PRODUCT", pricePaisa: 120_000, inventory: 40 },
    { name: "Shaker bottle", categoryId: await cat("accessories"), kind: "PRODUCT", pricePaisa: 60_000, inventory: 25 },
    { name: "Resistance band set", categoryId: await cat("equipment"), kind: "PRODUCT", pricePaisa: 140_000, inventory: 18 },
    { name: "Whey protein 2 lb (chocolate)", categoryId: await cat("supplements"), kind: "PRODUCT", pricePaisa: 850_000, compareAtPaisa: 900_000, inventory: 12, vendorId: vendor.id, description: "Batch-tested. Approved by Pulse Fitness." },
  ] as const;
  const products = [];
  for (const p of productDefs) products.push(await prisma.marketplaceProduct.create({ data: { ...p, gymId: gym.id, status: "ACTIVE" } }));
  const bundle = await prisma.marketplaceProduct.create({ data: { gymId: gym.id, categoryId: await cat("merchandise"), kind: "PRODUCT", isBundle: true, name: "Starter kit (T-shirt + shaker)", pricePaisa: 160_000, inventory: 10, status: "ACTIVE" } });
  await prisma.bundleItem.createMany({ data: [{ bundleId: bundle.id, productId: products[8]!.id }, { bundleId: bundle.id, productId: products[9]!.id }] });

  for (let k = 0; k < 26; k++) {
    const m = pick(members.filter((x) => x.pattern === "regular" || x.pattern === "moderate"));
    const p = pick(products);
    const paidAt = new Date(Date.now() - between(1, 90) * 86_400_000);
    const total = p.pricePaisa;
    const vendorBps = p.vendorId ? 7000 : 0;
    const platformBps = p.vendorId ? 1200 : 1000;
    const platformFee = Math.round((total * platformBps) / 10000);
    const vendorShare = Math.round((total * vendorBps) / 10000);
    const order = await prisma.marketplaceOrder.create({
      data: { gymId: gym.id, memberId: m.id, number: `ORD-SEED-${String(k + 1).padStart(3, "0")}`, status: k < 3 ? "PAID" : "FULFILLED", subtotalPaisa: total, totalPaisa: total, platformFeePaisa: platformFee, vendorSharePaisa: vendorShare, gymSharePaisa: total - platformFee - vendorShare, placedAt: paidAt, paidAt, fulfilledAt: k < 3 ? null : paidAt },
    });
    const item = await prisma.orderItem.create({ data: { gymId: gym.id, orderId: order.id, productId: p.id, vendorId: p.vendorId, name: p.name, kind: p.kind, unitPricePaisa: p.pricePaisa, quantity: 1, platformBps, gymBps: 10000 - platformBps - vendorBps, vendorBps } });
    const pay = await prisma.payment.create({ data: { gymId: gym.id, memberId: m.id, orderId: order.id, purpose: "MARKETPLACE_ORDER", method: "ONLINE", provider: "khalti", reference: `SEED-O${k}`, amountPaisa: total, status: "SUCCEEDED", paidAt, createdAt: paidAt } });
    await prisma.ledgerEntry.createMany({ data: [
      { gymId: gym.id, paymentId: pay.id, orderId: order.id, account: "MARKETPLACE_GROSS", amountPaisa: total, description: `Order ${order.number}`, createdAt: paidAt },
      { gymId: gym.id, paymentId: pay.id, orderId: order.id, account: "PLATFORM_COMMISSION", amountPaisa: platformFee, description: `Platform commission — ${order.number}`, createdAt: paidAt },
      { gymId: gym.id, paymentId: pay.id, orderId: order.id, account: "GYM_SHARE", amountPaisa: total - platformFee - vendorShare, description: `Gym share — ${order.number}`, createdAt: paidAt },
      ...(vendorShare ? [{ gymId: gym.id, paymentId: pay.id, orderId: order.id, account: "VENDOR_PAYABLE" as const, vendorId: p.vendorId, amountPaisa: vendorShare, description: `Vendor payable — ${order.number}`, createdAt: paidAt }] : []),
    ] });
    if (p.kind === "SERVICE") await prisma.booking.create({ data: { gymId: gym.id, memberId: m.id, orderItemId: item.id, trainerId: p.trainerId, title: p.name, status: k < 5 ? "PENDING" : "CONFIRMED", sessionsTotal: p.sessionCount ?? 1, sessionsUsed: k < 5 ? 0 : between(0, p.sessionCount ?? 1) } });
  }

  // Recovery history: closed tasks with outcomes (gives the "if contacted" scenario real data)
  const regulars = members.filter((x) => x.pattern === "regular" || x.pattern === "moderate");
  for (let k = 0; k < 22; k++) {
    const m = regulars[k * 3]!;
    const opened = new Date(Date.now() - between(40, 150) * 86_400_000);
    const contacted = new Date(opened.getTime() + between(0, 2) * 86_400_000);
    const outcome = k < 12 ? "RENEWED" : k < 16 ? "RETURNED" : "LOST";
    const plan = mplans[m.planIdx]!;
    const fee = Math.round((plan.pricePaisa * 30) / plan.durationDays);
    const closedAt = new Date(contacted.getTime() + between(2, 10) * 86_400_000);
    const task = await prisma.recoveryTask.create({
      data: {
        gymId: gym.id, memberId: m.id, reason: `${between(10, 20)} days without a visit`, monthlyFeePaisa: fee, status: outcome, lastContactAt: contacted,
        contactMethod: pick(["CALL", "WHATSAPP", "SMS"] as const), contactResult: outcome === "LOST" ? "Moving to another city" : "Will come back this week",
        returnedAt: outcome !== "LOST" ? closedAt : null, recoveredAt: outcome === "RENEWED" ? closedAt : null,
        protectedRevenuePaisa: outcome === "RENEWED" ? fee * 6 : null, protectedMonths: outcome === "RENEWED" ? 6 : null,
        closedAt: outcome === "RETURNED" ? null : closedAt, createdAt: opened, assignedToId: null,
      },
    });
    await prisma.recoveryEvent.createMany({ data: [
      { gymId: gym.id, taskId: task.id, memberId: m.id, type: "CREATED", note: task.reason, createdAt: opened },
      { gymId: gym.id, taskId: task.id, memberId: m.id, type: task.contactMethod === "CALL" ? "CALLED" : "MESSAGE_SENT", channel: task.contactMethod, note: task.contactResult, actorId: staffU.id, createdAt: contacted },
      { gymId: gym.id, taskId: task.id, memberId: m.id, type: outcome === "RENEWED" ? "RENEWED" : outcome === "RETURNED" ? "MEMBER_RETURNED" : "MARKED_LOST", createdAt: closedAt },
    ] });
    // Returned-but-not-renewed tasks stay open; close them so they don't block new tasks for regulars.
    if (outcome === "RETURNED") await prisma.recoveryTask.update({ where: { id: task.id }, data: { closedAt } });
  }

  await prisma.auditLog.create({ data: { actorType: "USER", actorId: owner.id, actorName: owner.name, actorRole: "OWNER", action: "plans.price_changed", entityType: "MembershipPlan", entityId: mplans[0]!.id, gymId: gym.id, before: { pricePaisa: 140_000 }, after: { pricePaisa: 150_000 }, createdAt: new Date(Date.now() - 60 * 86_400_000) } });

  // Member app accounts for the demo
  const aarav = members[0]!;
  const aaravUser = await prisma.user.create({ data: { email: "member@pulsefitness.demo", name: "Aarav Shrestha", passwordHash: hash, emailVerifiedAt: new Date() } });
  await prisma.member.update({ where: { id: aarav.id }, data: { userId: aaravUser.id, email: "member@pulsefitness.demo" } });

  // Backtest: an estimate "as of" 45 days ago, scored against what actually happened since.
  const backtestDay = addDays(today, -45);
  const bt = await generatePredictionReport(gym.id, { source: "SCHEDULED", asOf: backtestDay });
  const btAt = new Date(`${backtestDay}T06:00:00.000Z`);
  await prisma.predictionReport.update({ where: { id: bt.id }, data: { generatedAt: btAt } });
  await prisma.riskAssessment.updateMany({ where: { reportId: bt.id }, data: { assessedAt: btAt } });
  const evaluated = await evaluateOutcomes();
  console.log(`Backtest: evaluated ${evaluated.evaluated} assessments from ${backtestDay}.`);

  // Current state
  await recalculateGymRisk(gym.id);
  const report = await generatePredictionReport(gym.id, { source: "MANUAL", createdById: owner.id });
  console.log(`Pulse Fitness report: confidence ${report.confidence}, estimated at risk ${report.estimatedAtRisk} (${report.rangeLow}–${report.rangeHigh}).`);

  // Open recovery tasks for everyone currently at risk
  const { runInactivityAutomation } = await import("@/services/automation");
  const atRisk = await prisma.member.findMany({ where: { gymId: gym.id, riskStatus: "AT_RISK" }, select: { id: true } });
  await runInactivityAutomation(gym.id, atRisk.map((m) => ({ memberId: m.id, from: "ACTIVE", to: "AT_RISK", score: 0, category: "HIGH" })));

  // Record imports through the real pipeline: one imported, one waiting for review.
  const actor = { ...SYSTEM_ACTOR, type: "USER" as const, id: owner.id, name: owner.name, role: "OWNER" };
  const legacyRows = ["Customer Name,Mobile,Package,Last Seen,Expire,Fee"];
  for (let k = 0; k < 24; k++) {
    const nm = `${pick(FIRST)} ${pick(LAST)}`;
    const last = addDays(today, -between(1, 40));
    const exp = addDays(today, between(-20, 60));
    const [ly, lm, ld] = last.split("-");
    const [ey, em, ed] = exp.split("-");
    legacyRows.push(`${k === 5 ? nm.toUpperCase() : nm},${k === 9 ? "12345" : nepalPhone()},${pick(["Monthly", "3 Months", "Quarterly", "Monthly"])},${ld}/${lm}/${ly},${k === 14 ? "31/02/2026" : `${ed}/${em}/${ey}`},${pick(["Rs. 1,500", "1500", "4000"])}`);
  }
  legacyRows.push(`${members.find((x) => x.pattern === "regular") ? "Aarav Shrestha" : "Duplicate"},,Monthly,,,`);
  const job1 = await createImport(gym, actor, { name: "old-members-2082.csv", type: "text/csv", data: Buffer.from(legacyRows.join("\n")) });
  await processImport(job1.id, gym.id, "csv");
  const reviewRows = await prisma.importRow.findMany({ where: { importJobId: job1.id, status: { in: ["NEEDS_REVIEW"] } }, select: { id: true } });
  await applyRowAction(gym.id, job1.id, reviewRows.slice(0, 2).map((r) => r.id), "ACCEPT", actor);
  await requestCommit(gym.id, job1.id, actor);
  await commitImport(job1.id, gym.id);

  const register = ["Name,Phone,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15"];
  for (let k = 0; k < 12; k++) {
    const marks = Array.from({ length: 15 }, () => (rand() < 0.5 ? "P" : rand() < 0.9 ? "A" : "?"));
    register.push(`${pick(FIRST)} ${pick(LAST)},${nepalPhone()},${marks.join(",")}`);
  }
  const job2 = await createImport(gym, actor, { name: "attendance-register-august.csv", type: "text/csv", data: Buffer.from(register.join("\n")) });
  await processImport(job2.id, gym.id, "csv");

  // A few in-app notifications for the owner
  await prisma.notification.createMany({ data: [
    { gymId: gym.id, userId: owner.id, channel: "IN_APP", category: "SYSTEM", title: "Welcome to GymPulse", body: "Your Pulse screen shows who needs attention today.", status: "SENT", sentAt: new Date() },
  ] });

  await recalculateGymRisk(gym.id);
  return gym;
}

async function smallGyms(plans: Record<string, { id: string }>) {
  if (await prisma.gym.findUnique({ where: { slug: "yoga-nest" } })) return;
  const hash = await hashPassword(DEMO_PASSWORD);
  const today = todayIn();
  const yoga = await prisma.gym.create({ data: { name: "Yoga Nest Pokhara", slug: "yoga-nest", city: "Pokhara", province: "Gandaki", status: "TRIAL", planId: plans.starter!.id, trialEndsAt: new Date(Date.now() + 9 * 86_400_000), onboardingStep: 5 } });
  await prisma.subscription.create({ data: { gymId: yoga.id, planId: plans.starter!.id, status: "TRIALING", currentPeriodStart: new Date(Date.now() - 5 * 86_400_000), currentPeriodEnd: new Date(Date.now() + 9 * 86_400_000) } });
  const owner = await prisma.user.create({ data: { email: "owner@yoganest.demo", name: "Maya Gurung", passwordHash: hash } });
  await prisma.staffMember.create({ data: { gymId: yoga.id, userId: owner.id, role: "OWNER" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: yoga.id, name: "Monthly Yoga", durationDays: 30, pricePaisa: 250_000 } });
  for (let i = 0; i < 12; i++) {
    const joined = addDays(today, -between(5, 25));
    const m = await prisma.member.create({ data: { gymId: yoga.id, memberCode: `Y-${i + 1}`, fullName: `${pick(FIRST)} ${pick(LAST)}`, phone: nepalPhone(), joinedOn: toDbDate(joined) } });
    await prisma.membership.create({ data: { gymId: yoga.id, memberId: m.id, planId: plan.id, startDate: toDbDate(joined), endDate: toDbDate(addDays(joined, 29)), pricePaisa: plan.pricePaisa } });
    for (let d = joined; d < today; d = addDays(d, 1)) if (rand() < 0.3) await prisma.attendance.create({ data: { gymId: yoga.id, memberId: m.id, localDate: toDbDate(d), checkedInAt: visitInstant(d, true), method: "QR" } });
  }
  await generatePredictionReport(yoga.id, { source: "MANUAL" });

  const iron = await prisma.gym.create({ data: { name: "Iron Temple Lalitpur", slug: "iron-temple", city: "Lalitpur", province: "Bagmati", status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: "Subscription unpaid for 30 days", planId: plans.starter!.id } });
  await prisma.subscription.create({ data: { gymId: iron.id, planId: plans.starter!.id, status: "PAST_DUE", currentPeriodStart: new Date(Date.now() - 40 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 10 * 86_400_000) } });
  const ironOwner = await prisma.user.create({ data: { email: "owner@irontemple.demo", name: "Deepak Thapa", passwordHash: hash } });
  await prisma.staffMember.create({ data: { gymId: iron.id, userId: ironOwner.id, role: "OWNER" } });

  await prisma.supportTicket.createMany({ data: [
    { gymId: yoga.id, requesterEmail: "owner@yoganest.demo", subject: "How do I import my paper register?", priority: "NORMAL", status: "OPEN", slaDueAt: new Date(Date.now() + 20 * 3_600_000) },
    { gymId: iron.id, requesterEmail: "owner@irontemple.demo", subject: "Account suspended — payment sent by bank transfer", priority: "HIGH", status: "WAITING", slaDueAt: new Date(Date.now() - 2 * 3_600_000) },
  ] });
  await prisma.announcement.create({ data: { title: "Khalti KPG-2 now supported", body: "Connect your Khalti merchant account in Settings → Payments.", target: "ALL", roles: ["OWNER", "MANAGER"], status: "PUBLISHED", publishAt: new Date() } });
}

async function main() {
  const plans = await platform();
  await bigGym(plans);
  await smallGyms(plans);
  console.log(`\nDemo accounts (password: ${DEMO_PASSWORD})`);
  console.log("  Gym owner      owner@pulsefitness.demo    → /login");
  console.log("  Manager        manager@pulsefitness.demo");
  console.log("  Front desk     staff@pulsefitness.demo");
  console.log("  Trainer        trainer@pulsefitness.demo");
  console.log("  Member         member@pulsefitness.demo");
  console.log("  Vendor         vendor@himalayan-nutrition.demo");
  console.log("  Small gym      owner@yoganest.demo (too little data for an estimate)");
  console.log("  Super admin    super@gympulse.local       → /super-admin/login");
  console.log("  Support admin  support@gympulse.local");
  console.log("  Finance admin  finance@gympulse.local");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
