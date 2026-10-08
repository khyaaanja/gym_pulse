import { adminRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { retryJob } from "@/services/jobs";

export const POST = adminRoute({ permission: "system.manage" }, async (ctx, _req, params) => {
  const j = await retryJob(String(params.id));
  await audit({ actor: ctx.actor, action: "system.job_retried", entityType: "Job", entityId: j.id, gymId: j.gymId });
  return j;
});
