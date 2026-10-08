import { userRoute } from "@/lib/api";
import { prisma } from "@/db/client";

export const GET = userRoute({ allowSetup: true }, async (ctx) => {
  const [staff, members] = await Promise.all([
    prisma.staffMember.findMany({ where: { userId: ctx.user.id, active: true }, include: { gym: { select: { id: true, name: true } } } }),
    prisma.member.findMany({ where: { userId: ctx.user.id, archivedAt: null }, include: { gym: { select: { id: true, name: true } } } }),
  ]);
  return {
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, phone: ctx.user.phone, mfaEnabled: ctx.user.mfaEnabled },
    gyms: [...staff.map((s) => ({ gymId: s.gymId, name: s.gym.name, role: s.role })), ...members.map((m) => ({ gymId: m.gymId, name: m.gym.name, role: "MEMBER" }))],
    activeGymId: ctx.session.activeGymId,
  };
});
