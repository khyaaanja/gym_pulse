import { describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { acceptInvite, createInvite } from "@/services/invites";
import { deskActor, makeGym } from "./helpers/fixtures";

const PASSWORD = "Correct-Horse-9";
const email = () => `invitee-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

async function existingUser(addr: string) {
  return prisma.user.create({ data: { name: "Existing", email: addr, passwordHash: await hashPassword(PASSWORD) } });
}

async function inviteFor(addr: string, role: "STAFF" | "TRAINER" | "MANAGER" = "STAFF") {
  const { gym } = await makeGym();
  const { link } = await createInvite(gym, role, { email: addr }, deskActor);
  return { gym, token: link.split("/invite/")[1]! };
}

describe("accepting an invite", () => {
  it("never checks an existing account's password: it asks the person to sign in instead", async () => {
    const addr = email();
    const user = await existingUser(addr);
    const { gym, token } = await inviteFor(addr);
    // Even the right password is refused, so the endpoint can't be used to guess one.
    await expect(acceptInvite(token, { name: "x", password: PASSWORD }, null)).rejects.toMatchObject({ code: "sign_in_required" });
    await expect(acceptInvite(token, { name: "x", password: "wrong-password-1" }, null)).rejects.toMatchObject({ code: "sign_in_required" });
    expect(await prisma.staffMember.count({ where: { gymId: gym.id, userId: user.id } })).toBe(0);
  });

  it("links an existing account when that account is signed in", async () => {
    const addr = email();
    const user = await existingUser(addr);
    const { gym, token } = await inviteFor(addr);
    await acceptInvite(token, {}, user.id);
    expect(await prisma.staffMember.count({ where: { gymId: gym.id, userId: user.id, role: "STAFF" } })).toBe(1);
  });

  it("refuses when someone else is signed in", async () => {
    const addr = email();
    await existingUser(addr);
    const other = await existingUser(email());
    const { token } = await inviteFor(addr);
    await expect(acceptInvite(token, {}, other.id)).rejects.toMatchObject({ code: "sign_in_required" });
  });

  it("creates a new account when none exists", async () => {
    const addr = email();
    const { gym, token } = await inviteFor(addr);
    const { userId } = await acceptInvite(token, { name: "New Person", password: PASSWORD }, null);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(addr);
    expect(await prisma.staffMember.count({ where: { gymId: gym.id, userId } })).toBe(1);
  });

  it("can be used only once, even when submitted twice at the same moment", async () => {
    const addr = email();
    const user = await existingUser(addr);
    const { token } = await inviteFor(addr);
    const res = await Promise.allSettled([acceptInvite(token, {}, user.id), acceptInvite(token, {}, user.id)]);
    expect(res.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("never demotes a gym's owner", async () => {
    const addr = email();
    const owner = await existingUser(addr);
    const { gym, token } = await inviteFor(addr, "TRAINER");
    await prisma.staffMember.create({ data: { gymId: gym.id, userId: owner.id, role: "OWNER" } });
    await expect(acceptInvite(token, {}, owner.id)).rejects.toThrow(/already/i);
    expect((await prisma.staffMember.findFirstOrThrow({ where: { gymId: gym.id, userId: owner.id } })).role).toBe("OWNER");
  });
});
