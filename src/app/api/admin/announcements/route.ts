import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const GET = adminRoute({ permission: "announcements.manage" }, async () => prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }));

export const POST = adminRoute({ permission: "announcements.manage" }, async (ctx, req) => {
  const b = await parseJson(req, z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), target: z.enum(["ALL", "PLAN", "GYM"]), planId: z.string().nullable().optional(), gymId: z.string().nullable().optional(), roles: z.array(z.enum(["OWNER", "MANAGER", "STAFF", "TRAINER", "MEMBER"])).default([]), publishAt: z.string().datetime().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), publishNow: z.boolean().default(false) }));
  if (b.target === "PLAN" && !b.planId) throw badRequest("Choose a plan.");
  if (b.target === "GYM" && !b.gymId) throw badRequest("Choose a gym.");
  const publishAt = b.publishNow ? new Date() : b.publishAt ? new Date(b.publishAt) : null;
  const a = await prisma.announcement.create({
    data: { title: b.title, body: b.body, target: b.target, planId: b.planId, gymId: b.gymId, roles: b.roles, publishAt, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null, status: b.publishNow ? "PUBLISHED" : publishAt ? "SCHEDULED" : "DRAFT", createdById: ctx.admin.id },
  });
  await audit({ actor: ctx.actor, action: "announcements.created", entityType: "Announcement", entityId: a.id, after: a });
  return a;
});
