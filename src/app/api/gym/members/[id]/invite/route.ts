import { gymRoute } from "@/lib/api";
import { badRequest, notFound } from "@/lib/errors";
import { createInvite } from "@/services/invites";

export const POST = gymRoute({ permission: ["members.edit", "members.invite"], rateLimit: { limit: 30, windowSeconds: 3600 } }, async (ctx, _req, params) => {
  const member = await ctx.db.member.findUnique({ where: { id: String(params.id) } });
  if (!member) throw notFound();
  if (member.userId) throw badRequest("This member already has an app account.");
  const res = await createInvite(ctx.gym, "MEMBER", { email: member.email, phone: member.phone, memberId: member.id }, ctx.actor);
  return { link: res.link, delivery: res.delivery };
});
