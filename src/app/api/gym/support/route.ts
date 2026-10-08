import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";

const SLA_HOURS = { LOW: 72, NORMAL: 24, HIGH: 8, URGENT: 2 } as const;

export const GET = gymRoute({ allowSuspended: true }, async (ctx) =>
  prisma.supportTicket.findMany({ where: { gymId: ctx.gym.id }, include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 30 }),
);

export const POST = gymRoute({ allowSuspended: true, rateLimit: { limit: 10, windowSeconds: 3600 } }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ subject: z.string().trim().min(4).max(140), body: z.string().trim().min(5).max(4000), category: z.enum(["general", "billing", "imports", "payments", "bug", "plan_change"]).default("general"), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL") }));
  return prisma.supportTicket.create({
    data: {
      gymId: ctx.gym.id, requesterUserId: ctx.user.id, requesterEmail: ctx.user.email ?? "", subject: b.subject, category: b.category, priority: b.priority,
      slaDueAt: new Date(Date.now() + SLA_HOURS[b.priority] * 3_600_000),
      messages: { create: { authorType: "USER", authorId: ctx.user.id, authorName: ctx.user.name, body: b.body } },
    },
  });
});
