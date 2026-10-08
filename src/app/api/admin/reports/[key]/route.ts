import { adminRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { toCsv } from "@/services/reports";

const rs = (p: number | null | undefined) => (p ? (p / 100).toFixed(2) : "0.00");

export const GET = adminRoute({ permission: "analytics.view" }, async (ctx, _req, params) => {
  const key = String(params.key);
  let headers: string[];
  let rows: unknown[][];
  if (key === "gyms") {
    const gyms = await prisma.gym.findMany({ include: { plan: true, _count: { select: { members: true } } }, orderBy: { createdAt: "asc" } });
    headers = ["Gym", "City", "Province", "Status", "Plan", "Members", "Created"];
    rows = gyms.map((g) => [g.name, g.city, g.province, g.status, g.plan?.name, g._count.members, g.createdAt.toISOString().slice(0, 10)]);
  } else if (key === "subscriptions") {
    const inv = await prisma.subscriptionInvoice.findMany({ include: { gym: { select: { name: true } } }, orderBy: { periodStart: "desc" } });
    headers = ["Invoice", "Gym", "Period start", "Period end", "Amount (NPR)", "Status", "Paid at", "Reference"];
    rows = inv.map((i) => [i.number, i.gym.name, i.periodStart.toISOString().slice(0, 10), i.periodEnd.toISOString().slice(0, 10), rs(i.amountPaisa), i.status, i.paidAt?.toISOString().slice(0, 10), i.paymentRef]);
  } else if (key === "commissions") {
    const l = await prisma.ledgerEntry.findMany({ where: { account: { in: ["PLATFORM_COMMISSION", "VENDOR_PAYABLE", "SAAS_REVENUE"] } }, orderBy: { createdAt: "desc" }, take: 50_000 });
    headers = ["Date", "Account", "Gym", "Vendor", "Order", "Amount (NPR)", "Description"];
    rows = l.map((e) => [e.createdAt.toISOString().slice(0, 10), e.account, e.gymId, e.vendorId, e.orderId, rs(e.amountPaisa), e.description]);
  } else throw notFound();
  await audit({ actor: ctx.actor, action: "reports.platform_exported", entityType: "Report", entityId: key });
  return new Response("﻿" + toCsv(headers, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gympulse-platform-${key}.csv"`, "cache-control": "no-store" } });
});
