import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";

export type SearchHit = { type: string; id: string; title: string; subtitle?: string; href: string };

/** Gym-scoped global search (⌘K). Every query is tenant-scoped; results are capped per type. */
export async function gymSearch(gymId: string, q: string, opts: { canPayments: boolean; canImports: boolean }): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const db = tenantDb(gymId);
  const digits = term.replace(/\D/g, "");
  const [members, payments, orders, staff, imports, memberships] = await Promise.all([
    db.member.findMany({
      where: { archivedAt: null, OR: [{ fullName: { contains: term, mode: "insensitive" } }, { memberCode: { contains: term, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []), { email: { contains: term, mode: "insensitive" } }] },
      take: 8,
      select: { id: true, fullName: true, memberCode: true, phone: true, riskStatus: true },
    }),
    opts.canPayments ? db.payment.findMany({ where: { reference: { contains: term, mode: "insensitive" } }, take: 4, select: { id: true, reference: true, status: true } }) : [],
    db.marketplaceOrder.findMany({ where: { number: { contains: term, mode: "insensitive" } }, take: 4, select: { id: true, number: true, status: true } }),
    db.staffMember.findMany({ where: { active: true, user: { name: { contains: term, mode: "insensitive" } } }, take: 4, include: { user: { select: { name: true } } } }),
    opts.canImports ? db.importJob.findMany({ where: { file: { originalName: { contains: term, mode: "insensitive" } } }, take: 4, include: { file: { select: { originalName: true } } } }) : [],
    db.membershipPlan.findMany({ where: { name: { contains: term, mode: "insensitive" } }, take: 3 }),
  ]);
  return [
    ...members.map((m) => ({ type: "Member", id: m.id, title: m.fullName, subtitle: `${m.memberCode}${m.phone ? ` · ${m.phone}` : ""}`, href: `/app/members/${m.id}` })),
    ...memberships.map((p) => ({ type: "Membership plan", id: p.id, title: p.name, href: `/app/settings?tab=plans` })),
    ...payments.map((p) => ({ type: "Payment", id: p.id, title: p.reference, subtitle: p.status, href: `/app/renew` })),
    ...orders.map((o) => ({ type: "Order", id: o.id, title: o.number, subtitle: o.status, href: `/app/marketplace?tab=orders` })),
    ...staff.map((s) => ({ type: s.role === "TRAINER" ? "Trainer" : "Staff", id: s.id, title: s.user.name, subtitle: s.role, href: `/app/settings?tab=staff` })),
    ...imports.map((j) => ({ type: "Import report", id: j.id, title: j.file.originalName, subtitle: j.status, href: `/app/imports/${j.id}` })),
  ];
}

export async function adminSearch(q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const [gyms, vendors] = await Promise.all([
    prisma.gym.findMany({ where: { OR: [{ name: { contains: term, mode: "insensitive" } }, { slug: { contains: term, mode: "insensitive" } }, { city: { contains: term, mode: "insensitive" } }] }, take: 8 }),
    prisma.marketplaceVendor.findMany({ where: { name: { contains: term, mode: "insensitive" } }, take: 5 }),
  ]);
  return [
    ...gyms.map((g) => ({ type: "Gym", id: g.id, title: g.name, subtitle: `${g.city ?? ""} · ${g.status}`, href: `/super-admin/gyms/${g.id}` })),
    ...vendors.map((v) => ({ type: "Vendor", id: v.id, title: v.name, subtitle: v.status, href: `/super-admin/vendors?focus=${v.id}` })),
  ];
}
