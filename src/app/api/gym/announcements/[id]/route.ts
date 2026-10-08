import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { ANNOUNCEMENT_AUDIENCES as AUDIENCES } from "@/services/announcements";

const schema = z.object({
  title: z.string().trim().min(3).max(100).optional(),
  body: z.string().trim().min(3).max(1000).optional(),
  audience: z.enum(["MEMBERS", "STAFF", "EVERYONE"]).optional(),
  status: z.enum(["PUBLISHED", "DRAFT", "EXPIRED"]).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

async function own(gymId: string, id: string) {
  const a = await prisma.announcement.findFirst({ where: { id, gymId, target: "GYM" } });
  if (!a) throw notFound();
  return a;
}

export const PATCH = gymRoute({ permission: "settings.manage" }, async (ctx, req, params) => {
  const before = await own(ctx.gym.id, String(params.id));
  const { audience, ...b } = await parseJson(req, schema);
  const after = await prisma.announcement.update({
    where: { id: before.id },
    data: {
      ...b,
      ...(audience ? { roles: [...AUDIENCES[audience]] } : {}),
      // Publishing stamps the time members see it; ending it keeps the record for the audit trail.
      ...(b.status === "PUBLISHED" && before.status !== "PUBLISHED" ? { publishAt: new Date() } : {}),
      ...(b.status === "EXPIRED" ? { expiresAt: new Date() } : {}),
    },
  });
  await audit({ actor: ctx.actor, action: "announcement.updated", entityType: "Announcement", entityId: before.id, gymId: ctx.gym.id, before, after });
  return after;
});

export const DELETE = gymRoute({ permission: "settings.manage" }, async (ctx, _req, params) => {
  const before = await own(ctx.gym.id, String(params.id));
  await prisma.announcement.delete({ where: { id: before.id } });
  await audit({ actor: ctx.actor, action: "announcement.deleted", entityType: "Announcement", entityId: before.id, gymId: ctx.gym.id, before });
  return { deleted: true };
});
