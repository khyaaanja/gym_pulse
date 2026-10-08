import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const GET = adminRoute({ permission: "support.manage" }, async (_ctx, _req, params) => {
  const t = await prisma.supportTicket.findUnique({ where: { id: String(params.id) }, include: { messages: { orderBy: { createdAt: "asc" } }, assignedAdmin: { select: { id: true, name: true } } } });
  if (!t) throw notFound();
  return t;
});

export const PATCH = adminRoute({ permission: "support.manage" }, async (ctx, req, params) => {
  const t = await prisma.supportTicket.findUnique({ where: { id: String(params.id) } });
  if (!t) throw notFound();
  const b = await parseJson(req, z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assignedAdminId: z.string().nullable().optional() }));
  const after = await prisma.supportTicket.update({ where: { id: t.id }, data: { ...b, ...(b.status === "RESOLVED" ? { resolvedAt: new Date() } : {}) } });
  await audit({ actor: ctx.actor, action: "support.ticket_updated", entityType: "SupportTicket", entityId: t.id, gymId: t.gymId, before: { status: t.status, priority: t.priority }, after: b });
  return after;
});

export const POST = adminRoute({ permission: "support.manage" }, async (ctx, req, params) => {
  const t = await prisma.supportTicket.findUnique({ where: { id: String(params.id) } });
  if (!t) throw notFound();
  const b = await parseJson(req, z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) }));
  const m = await prisma.supportMessage.create({ data: { ticketId: t.id, authorType: "ADMIN", authorId: ctx.admin.id, authorName: ctx.admin.name, body: b.body, internal: b.internal } });
  if (!b.internal) await prisma.supportTicket.update({ where: { id: t.id }, data: { firstResponseAt: t.firstResponseAt ?? new Date(), status: t.status === "OPEN" ? "IN_PROGRESS" : t.status } });
  return m;
});
