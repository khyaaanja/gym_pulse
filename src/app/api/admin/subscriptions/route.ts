import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = adminRoute({ permission: "billing.view" }, async (_ctx, req) => {
  const q = parseQuery(req, z.object({ status: z.enum(["ALL", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"]).default("ALL") }));
  const [subscriptions, dueInvoices] = await Promise.all([
    prisma.subscription.findMany({ where: q.status === "ALL" ? {} : { status: q.status }, include: { gym: { select: { id: true, name: true, status: true } }, plan: { select: { name: true, pricePaisa: true, billingPeriod: true } } }, orderBy: { currentPeriodEnd: "asc" }, take: 200 }),
    prisma.subscriptionInvoice.findMany({ where: { status: { in: ["DUE", "FAILED"] } }, include: { gym: { select: { name: true } } }, orderBy: { dueAt: "asc" }, take: 100 }),
  ]);
  return { subscriptions, dueInvoices };
});
