import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { ANNOUNCEMENT_AUDIENCES as AUDIENCES } from "@/services/announcements";

/** A gym's own announcements: always targeted at this gym, never at other gyms or plans. */
export const GET = gymRoute({ permission: "settings.manage" }, async (ctx) =>
  prisma.announcement.findMany({ where: { target: "GYM", gymId: ctx.gym.id }, orderBy: { createdAt: "desc" }, take: 100 }),
);

const schema = z.object({
  title: z.string().trim().min(3).max(100),
  body: z.string().trim().min(3).max(1000),
  audience: z.enum(["MEMBERS", "STAFF", "EVERYONE"]).default("MEMBERS"),
  publish: z.boolean().default(true),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const POST = gymRoute({ permission: "settings.manage" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  if (b.expiresAt && b.expiresAt <= new Date()) throw badRequest("Choose an end date in the future.");
  const a = await prisma.announcement.create({
    data: {
      title: b.title, body: b.body, target: "GYM", gymId: ctx.gym.id, roles: [...AUDIENCES[b.audience]],
      status: b.publish ? "PUBLISHED" : "DRAFT", publishAt: b.publish ? new Date() : null, expiresAt: b.expiresAt ?? null, createdById: ctx.user.id,
    },
  });
  await audit({ actor: ctx.actor, action: "announcement.created", entityType: "Announcement", entityId: a.id, gymId: ctx.gym.id, after: a });
  return a;
});
