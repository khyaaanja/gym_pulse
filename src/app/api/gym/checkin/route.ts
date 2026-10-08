import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { badRequest, notFound } from "@/lib/errors";
import { checkIn, verifyMemberPass } from "@/services/attendance";
import { resolveLocation } from "@/services/locations";
import { memberScope } from "@/lib/scope";

const schema = z.union([
  z.object({ memberId: z.string().min(1) }),
  z.object({ passToken: z.string().min(10).max(500) }),
  z.object({ memberCode: z.string().min(1).max(40) }),
]).and(z.object({ locationId: z.string().max(40).optional() }));

export const POST = gymRoute({ permission: "attendance.create", feature: "attendance" }, async (ctx, req) => {
  const body = await parseJson(req, schema);
  let memberId: string | null = null;
  if ("memberId" in body) memberId = body.memberId;
  if ("passToken" in body) {
    memberId = verifyMemberPass(ctx.gym.id, body.passToken);
    if (!memberId) throw badRequest("This member pass has expired. Ask the member to refresh their QR code.");
  }
  if ("memberCode" in body) {
    const m = await ctx.db.member.findFirst({ where: { OR: [{ memberCode: body.memberCode }, { credentialUid: body.memberCode }] } });
    memberId = m?.id ?? null;
  }
  if (!memberId) throw notFound("Member not found.");
  const member = await ctx.db.member.findFirst({ where: { id: memberId, ...memberScope(ctx) }, select: { fullName: true } });
  if (!member) throw notFound("Member not found.");
  const locationId = (await resolveLocation(ctx.gym.id, body.locationId)) ?? undefined;
  const res = await checkIn(ctx.gym, memberId, "STAFF", { recordedById: ctx.user.id, locationId });
  return { ...res, memberName: member?.fullName };
});
