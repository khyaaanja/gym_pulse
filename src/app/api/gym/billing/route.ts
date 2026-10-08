import { gymRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { usage, type LimitKind } from "@/lib/limits";

export const GET = gymRoute({ permission: "billing.manage", allowSuspended: true }, async (ctx) => {
  const [subscription, invoices, plans] = await Promise.all([
    prisma.subscription.findUnique({ where: { gymId: ctx.gym.id }, include: { plan: true } }),
    prisma.subscriptionInvoice.findMany({ where: { gymId: ctx.gym.id }, orderBy: { periodStart: "desc" }, take: 24 }),
    prisma.saasPlan.findMany({ where: { active: true, isPublic: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const kinds: LimitKind[] = ["members", "staff", "importsPerMonth", "predictionsPerMonth", "notificationsPerMonth"];
  const used = Object.fromEntries(await Promise.all(kinds.map(async (k) => [k, await usage(ctx.gym.id, k, ctx.gym.timezone)] as const)));
  return { subscription, invoices, plans, usage: used };
});
