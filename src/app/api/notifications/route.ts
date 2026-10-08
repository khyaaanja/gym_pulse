import { z } from "zod";
import { userRoute, parseJson, parseQuery } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = userRoute({}, async (ctx, req) => {
  const q = parseQuery(req, z.object({ unread: z.enum(["true", "false"]).default("false"), limit: z.coerce.number().int().min(1).max(50).default(50) }));
  const where = { userId: ctx.user.id, channel: "IN_APP" as const, ...(q.unread === "true" ? { readAt: null } : {}) };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: q.limit, select: { id: true, category: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
    prisma.notification.count({ where: { userId: ctx.user.id, channel: "IN_APP", readAt: null } }),
  ]);
  return { items, unread };
});

export const POST = userRoute({}, async (ctx, req) => {
  const b = await parseJson(req, z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() }));
  const res = await prisma.notification.updateMany({ where: { userId: ctx.user.id, channel: "IN_APP", readAt: null, ...(b.all ? {} : { id: { in: b.ids ?? [] } }) }, data: { readAt: new Date() } });
  return { updated: res.count };
});
