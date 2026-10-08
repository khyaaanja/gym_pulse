import { z } from "zod";
import { memberRoute, parseJson } from "@/lib/api";
import { placeOrder } from "@/services/marketplace";

export const GET = memberRoute({ feature: "marketplace" }, async (ctx) => {
  const orders = await ctx.db.marketplaceOrder.findMany({ where: { memberId: ctx.member.id }, include: { items: true, payments: { select: { id: true, status: true }, orderBy: { createdAt: "desc" } } }, orderBy: { placedAt: "desc" }, take: 30 });
  // An order can have several checkout attempts; show the one that paid it, else the latest.
  return orders.map(({ payments, ...o }) => ({ ...o, payment: payments.find((p) => p.status === "SUCCEEDED") ?? payments[0] ?? null }));
});

export const POST = memberRoute({ feature: "marketplace" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(20) })).min(1).max(20), couponCode: z.string().max(40).optional().nullable() }));
  const order = await placeOrder(ctx.gym, ctx.member, b.items, b.couponCode);
  return { orderId: order.id, number: order.number, totalPaisa: order.totalPaisa };
});
