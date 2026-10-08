import { prisma } from "@/db/client";

/** Who a gym announcement is for, as stored in Announcement.roles (empty = everyone at the gym). */
export const ANNOUNCEMENT_AUDIENCES = { MEMBERS: ["MEMBER"], STAFF: ["OWNER", "MANAGER", "STAFF", "TRAINER"], EVERYONE: [] } as const;

/** Announcements targeted at this user's gym(s), plan(s) and role(s), within their publish window. */
export async function visibleAnnouncements(userId: string, activeGymId: string | null) {
  const [staff, members] = await Promise.all([
    prisma.staffMember.findMany({ where: { userId, active: true }, include: { gym: { select: { id: true, planId: true } } } }),
    prisma.member.findMany({ where: { userId, archivedAt: null }, include: { gym: { select: { id: true, planId: true } } } }),
  ]);
  const memberships = [...staff.map((s) => ({ gym: s.gym, role: s.role as string })), ...members.map((m) => ({ gym: m.gym, role: "MEMBER" }))].filter((x) => !activeGymId || x.gym.id === activeGymId);
  if (!memberships.length) return [];
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: { status: { in: ["PUBLISHED", "SCHEDULED"] }, OR: [{ publishAt: null }, { publishAt: { lte: now } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
    orderBy: { publishAt: "desc" },
    take: 20,
  });
  return rows.filter((a) =>
    memberships.some((m) => {
      const targetOk = a.target === "ALL" || (a.target === "GYM" && a.gymId === m.gym.id) || (a.target === "PLAN" && a.planId === m.gym.planId);
      const roleOk = a.roles.length === 0 || a.roles.includes(m.role);
      return targetOk && roleOk;
    }),
  ).map((a) => ({ id: a.id, title: a.title, body: a.body, publishAt: a.publishAt }));
}
