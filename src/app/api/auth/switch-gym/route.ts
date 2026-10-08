import { z } from "zod";
import { parseJson, userRoute } from "@/lib/api";
import { prisma } from "@/db/client";
import { forbidden } from "@/lib/errors";

export const POST = userRoute({}, async (ctx, req) => {
  const { gymId } = await parseJson(req, z.object({ gymId: z.string().min(1) }));
  const [staff, member] = await Promise.all([
    prisma.staffMember.findFirst({ where: { userId: ctx.user.id, gymId, active: true } }),
    prisma.member.findFirst({ where: { userId: ctx.user.id, gymId, archivedAt: null } }),
  ]);
  if (!staff && !member) throw forbidden();
  await prisma.session.update({ where: { id: ctx.session.id }, data: { activeGymId: gymId } });
  return { ok: true };
});
