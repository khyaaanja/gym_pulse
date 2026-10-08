import { adminRoute } from "@/lib/api";
import { prisma } from "@/db/client";

/** Listings across gyms (read-only overview + vendor listings awaiting approval). */
export const GET = adminRoute({ permission: "marketplace.manage" }, async () => {
  const [pending, featured, counts] = await Promise.all([
    prisma.marketplaceProduct.findMany({ where: { status: "PENDING_APPROVAL" }, include: { gym: { select: { name: true } }, vendor: { select: { name: true } }, category: { select: { name: true } } }, orderBy: { updatedAt: "asc" } }),
    prisma.marketplaceProduct.findMany({ where: { featured: true, status: "ACTIVE" }, include: { gym: { select: { name: true } } }, take: 50 }),
    prisma.marketplaceProduct.groupBy({ by: ["status"], _count: true }),
  ]);
  return { pending, featured, counts };
});
