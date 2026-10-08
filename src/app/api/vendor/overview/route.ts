import { vendorRoute } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = vendorRoute({ requireApproved: false }, async (ctx) => {
  const [gyms, products, items, categories] = await Promise.all([
    prisma.vendorGym.findMany({ where: { vendorId: ctx.vendor.id, active: true }, include: { gym: { select: { id: true, name: true, city: true } } } }),
    prisma.marketplaceProduct.findMany({ where: { vendorId: ctx.vendor.id }, include: { gym: { select: { name: true } }, category: { select: { name: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.orderItem.findMany({ where: { vendorId: ctx.vendor.id, order: { status: { in: ["PAID", "FULFILLED"] } } }, include: { order: { select: { number: true, status: true, paidAt: true, gym: { select: { name: true } } } } }, orderBy: { order: { paidAt: "desc" } }, take: 100 }),
    prisma.marketplaceCategory.findMany({ where: { active: true, kind: "PRODUCT" }, orderBy: { sortOrder: "asc" } }),
  ]);
  const payable = await prisma.ledgerEntry.aggregate({ _sum: { amountPaisa: true }, where: { vendorId: ctx.vendor.id, account: "VENDOR_PAYABLE" } });
  // Vendors see their own line items only — never the member's identity.
  return {
    vendor: { id: ctx.vendor.id, name: ctx.vendor.name, status: ctx.vendor.status },
    gyms: gyms.map((g) => g.gym),
    products,
    sales: items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitPricePaisa: i.unitPricePaisa, vendorBps: i.vendorBps, order: i.order.number, status: i.order.status, paidAt: i.order.paidAt, gym: i.order.gym.name })),
    categories,
    payablePaisa: payable._sum.amountPaisa ?? items.reduce((a, i) => a + Math.round((i.unitPricePaisa * i.quantity * i.vendorBps) / 10000), 0),
  };
});
