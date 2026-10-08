import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit, type AuditActor } from "@/lib/audit";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { assertWithinLimit } from "@/lib/limits";
import { hashPassword } from "@/lib/auth/password";
import type { Gym, InviteRole } from "@/generated/prisma/client";
import { notify } from "./notifications";

export async function createInvite(gym: Gym, role: InviteRole, target: { email?: string | null; phone?: string | null; memberId?: string | null }, actor: AuditActor & { id?: string | null }) {
  if (!target.email && !target.phone) throw badRequest("Add an email or phone number to send the invite.");
  if (role !== "MEMBER") await assertWithinLimit(gym.id, "staff", gym.timezone);
  if (role === "OWNER") throw badRequest("Ownership can't be transferred by invite. Contact GymPulse support.");
  if (target.memberId && !(await tenantDb(gym.id).member.findUnique({ where: { id: target.memberId } }))) throw notFound("Member not found.");
  const token = randomToken();
  const invite = await tenantDb(gym.id).invite.create({
    data: { gymId: gym.id, role, email: target.email?.toLowerCase() ?? null, phone: target.phone ?? null, memberId: target.memberId ?? null, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), createdById: actor.id ?? null },
  });
  const link = `${process.env.APP_URL}/invite/${token}`;
  const vars = { inviterName: actor.name ?? gym.name, role: role === "MEMBER" ? "a member" : role.toLowerCase(), link };
  const sent = [];
  if (target.memberId) {
    if (target.phone) sent.push(await notify({ gymId: gym.id, memberId: target.memberId, channel: "SMS", category: "SECURITY", template: "INVITE", vars, essential: true }));
    if (target.email) sent.push(await notify({ gymId: gym.id, memberId: target.memberId, channel: "EMAIL", category: "SECURITY", template: "INVITE", vars, essential: true }));
  }
  await audit({ actor, action: "invites.created", entityType: "Invite", entityId: invite.id, gymId: gym.id, after: { role, email: target.email, phone: target.phone, memberId: target.memberId } });
  // The link is returned so staff can share it directly (e.g. WhatsApp) when SMS/email isn't configured.
  return { invite, link, delivery: sent.map((n) => ({ channel: n.channel, status: n.status, error: n.error })) };
}

export async function inviteByToken(token: string) {
  const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { gym: { select: { id: true, name: true } } } });
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

/**
 * Accepting the link proves control of the email/phone it was sent to, which marks it verified.
 *
 * An invite for an address that already has an account is accepted by signing in to that account, never by typing
 * its password here: anyone can open a gym and invite any address, so a password check on this endpoint would be a
 * password-guessing oracle that sidesteps login's lockout.
 */
export async function acceptInvite(token: string, input: { name?: string; password?: string }, sessionUserId: string | null) {
  const invite = await inviteByToken(token);
  if (!invite) throw badRequest("This invitation has expired or was already used. Ask your gym for a new one.");
  const existing = await prisma.user.findFirst({ where: { OR: [...(invite.email ? [{ email: invite.email }] : []), ...(invite.phone ? [{ phone: invite.phone }] : [])] } });
  let userId: string;
  if (existing) {
    if (existing.id !== sessionUserId) {
      throw new AppError(409, "sign_in_required", "You already have a GymPulse account with this email or phone. Sign in to it, then open this invitation again.");
    }
    userId = existing.id;
  } else {
    if (!input.name || !input.password) throw badRequest("Enter your name and a password to create your account.");
    const u = await prisma.user.create({
      data: {
        name: input.name,
        email: invite.email,
        phone: invite.phone,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: invite.email ? new Date() : null,
        phoneVerifiedAt: invite.phone ? new Date() : null,
      },
    });
    userId = u.id;
  }
  await prisma.$transaction(async (tx) => {
    // Claim the invite first, conditionally, so two concurrent submits can't both use it.
    const claimed = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count === 0) throw badRequest("This invitation has expired or was already used. Ask your gym for a new one.");
    if (invite.role === "MEMBER") {
      if (!invite.memberId) throw badRequest("This member invite is incomplete.");
      await tx.member.update({ where: { id: invite.memberId, gymId: invite.gymId }, data: { userId } });
    } else {
      const current = await tx.staffMember.findUnique({ where: { gymId_userId: { gymId: invite.gymId, userId } } });
      if (current?.role === "OWNER") throw badRequest("You already own this gym, so this invitation isn't needed.");
      await tx.staffMember.upsert({
        where: { gymId_userId: { gymId: invite.gymId, userId } },
        create: { gymId: invite.gymId, userId, role: invite.role as "MANAGER" | "STAFF" | "TRAINER" },
        update: { role: invite.role as "MANAGER" | "STAFF" | "TRAINER", active: true },
      });
    }
  });
  await audit({ actor: { type: "USER", id: userId, name: input.name ?? existing?.name }, action: "invites.accepted", entityType: "Invite", entityId: invite.id, gymId: invite.gymId, after: { role: invite.role } });
  return { userId, gymId: invite.gymId };
}
