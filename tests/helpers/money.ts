import { prisma } from "@/db/client";
import { addDays, toDbDate, today, type DateOnly } from "@/lib/time";

export const sumLedger = async (where: object, account: string) =>
  (await prisma.ledgerEntry.aggregate({ where: { ...where, account: account as never }, _sum: { amountPaisa: true } }))._sum.amountPaisa ?? 0;

/** Marketplace identity: gross = platform commission + gym share + vendor payables (per order). */
export async function marketplaceBalance(orderId: string) {
  const [gross, fee, gym, vendor] = await Promise.all(["MARKETPLACE_GROSS", "PLATFORM_COMMISSION", "GYM_SHARE", "VENDOR_PAYABLE"].map((a) => sumLedger({ orderId }, a)));
  return { gross, parts: fee + gym + vendor, fee, gym, vendor };
}

export async function giveMembership(gymId: string, memberId: string, planId: string, startOffset: number, endOffset: number, tz = "Asia/Kathmandu", status: "ACTIVE" | "EXPIRED" = "ACTIVE") {
  const t = today(tz);
  return prisma.membership.create({ data: { gymId, memberId, planId, startDate: toDbDate(addDays(t, startOffset)), endDate: toDbDate(addDays(t, endOffset)), pricePaisa: 150_000, status } });
}

export const ds = (d: Date): DateOnly => d.toISOString().slice(0, 10);

import { NextRequest } from "next/server";
import { signSandboxWebhook } from "@/services/payments/providers";

/** Delivers a signed sandbox webhook straight to the route handler. */
export async function sandboxWebhook(event: Record<string, unknown>, sig?: string) {
  const { POST } = await import("@/app/api/webhooks/payments/[provider]/route");
  const raw = JSON.stringify(event);
  return POST(
    new NextRequest("http://localhost:3000/api/webhooks/payments/sandbox", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-gympulse-signature": sig ?? signSandboxWebhook(raw), "x-forwarded-for": "10.55.0.2" } }),
    { params: Promise.resolve({ provider: "sandbox" }) },
  );
}
let ev = 0;
export const paidEvent = (p: { reference: string; amountPaisa: number }, status = "SUCCEEDED") => ({ id: `mevt-${Date.now()}-${ev++}`, reference: p.reference, status, amountPaisa: p.amountPaisa });

export async function makeCategory(kind: "PRODUCT" | "SERVICE" = "PRODUCT") {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return prisma.marketplaceCategory.create({ data: { name: `Cat ${id}`, slug: `cat-${id}`, kind } });
}

export async function makeListing(gymId: string, o: { kind?: "PRODUCT" | "SERVICE"; price?: number; inventory?: number | null; sessionCount?: number; vendorId?: string | null; categoryId?: string; trainerId?: string } = {}) {
  const kind = o.kind ?? "PRODUCT";
  const category = o.categoryId ? { id: o.categoryId } : await makeCategory(kind);
  return prisma.marketplaceProduct.create({
    data: {
      gymId, categoryId: category.id, kind, name: `Item ${Math.random().toString(36).slice(2, 8)}`, pricePaisa: o.price ?? 50_000,
      inventory: kind === "SERVICE" ? null : o.inventory === undefined ? 10 : o.inventory, sessionCount: o.sessionCount, vendorId: o.vendorId ?? null, trainerId: o.trainerId, status: "ACTIVE",
    },
  });
}
