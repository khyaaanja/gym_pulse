import { z } from "zod";
import { adminRoute, parseJson } from "@/lib/api";
import { prisma } from "@/db/client";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { enqueue } from "@/services/jobs";
import { reprocessImport } from "@/services/imports/pipeline";

/**
 * A fixed list of safe, idempotent operations. There is deliberately no way to run
 * arbitrary SQL or code from the control center.
 */
const schema = z.object({
  op: z.enum(["recalculate_streaks", "recalculate_risk", "recalculate_revenue", "retry_notification", "reprocess_import", "rebuild_search_index", "evaluate_predictions"]),
  gymId: z.string().optional(),
  targetId: z.string().optional(),
});

export const POST = adminRoute({ permission: "system.manage" }, async (ctx, req) => {
  const b = await parseJson(req, schema);
  const needsGym = ["recalculate_streaks", "recalculate_risk", "recalculate_revenue", "reprocess_import"];
  if (needsGym.includes(b.op)) {
    if (!b.gymId || !(await prisma.gym.findUnique({ where: { id: b.gymId } }))) throw badRequest("Choose a gym.");
  }
  let result: unknown;
  switch (b.op) {
    case "recalculate_streaks":
      result = await enqueue("streaks.recalculate", { gymId: b.gymId }, { gymId: b.gymId, priority: 10 });
      break;
    case "recalculate_risk":
      result = await enqueue("risk.recalculate", { gymId: b.gymId }, { gymId: b.gymId, priority: 10 });
      break;
    case "recalculate_revenue":
      result = await enqueue("prediction.generate", { gymId: b.gymId, source: "SCHEDULED" }, { gymId: b.gymId, priority: 10 });
      break;
    case "retry_notification": {
      const n = await prisma.notification.findUnique({ where: { id: b.targetId ?? "" } });
      if (!n) throw notFound("Notification not found.");
      if (n.status !== "FAILED") throw badRequest("Only failed notifications can be retried.");
      await prisma.notification.update({ where: { id: n.id }, data: { status: "QUEUED", error: null } });
      result = await enqueue("notification.send", { notificationId: n.id }, { gymId: n.gymId, priority: 5 });
      break;
    }
    case "reprocess_import":
      await reprocessImport(b.gymId!, b.targetId ?? "", ctx.actor);
      result = { ok: true };
      break;
    case "rebuild_search_index":
      await prisma.$executeRawUnsafe('REINDEX INDEX CONCURRENTLY "Member_fullName_trgm"');
      await prisma.$executeRawUnsafe('REINDEX INDEX CONCURRENTLY "Member_memberCode_trgm"');
      result = { ok: true };
      break;
    case "evaluate_predictions":
      result = await enqueue("prediction.evaluate", {}, { priority: 5 });
      break;
  }
  await audit({ actor: ctx.actor, action: `system.${b.op}`, entityType: "Operation", entityId: b.targetId ?? null, gymId: b.gymId ?? null });
  return { ok: true, result };
});
