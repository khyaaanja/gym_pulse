import { gymRoute } from "@/lib/api";
import { assertWithinLimit } from "@/lib/limits";
import { convertLead } from "@/services/growth";

/** Turns an enquiry into a member record; staff then add a membership or send the app invite from the profile. */
export const POST = gymRoute({ permission: ["leads.manage", "members.edit"] }, async (ctx, _req, params) => {
  await assertWithinLimit(ctx.gym.id, "members", ctx.gym.timezone);
  const member = await convertLead(ctx.gym, ctx.db, String(params.id), ctx.actor);
  return { memberId: member.id, redirect: `/app/members/${member.id}` };
});
