import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = adminRoute({ permission: "support.manage" }, async (_ctx, req) => {
  const q = parseQuery(req, z.object({ status: z.enum(["OPEN_ALL", "OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED", "ALL"]).default("OPEN_ALL") }));
  const where = q.status === "ALL" ? {} : q.status === "OPEN_ALL" ? { status: { in: ["OPEN" as const, "IN_PROGRESS" as const, "WAITING" as const] } } : { status: q.status };
  const tickets = await prisma.supportTicket.findMany({ where, include: { assignedAdmin: { select: { name: true } }, _count: { select: { messages: true } } }, orderBy: [{ slaDueAt: "asc" }], take: 200 });
  const gyms = await prisma.gym.findMany({ where: { id: { in: tickets.map((t) => t.gymId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const now = Date.now();
  return tickets.map((t) => ({ ...t, gymName: gyms.find((g) => g.id === t.gymId)?.name ?? null, slaBreached: !["RESOLVED", "CLOSED"].includes(t.status) && t.slaDueAt.getTime() < now }));
});
