import { z } from "zod";
import { gymRoute, parseJson } from "@/lib/api";
import { forbidden, notFound } from "@/lib/errors";
import { addNote, logContact, markLost, markRecovered, sendRecoveryMessage } from "@/services/recovery";

export const GET = gymRoute({ permission: "recovery.manage" }, async (ctx, _req, params) => {
  const task = await ctx.db.recoveryTask.findUnique({ where: { id: String(params.id) }, include: { member: true, events: { orderBy: { createdAt: "asc" } } } });
  if (!task) throw notFound();
  return task;
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("contact"), method: z.enum(["CALL", "SMS", "WHATSAPP", "EMAIL", "IN_PERSON", "IN_APP"]), result: z.string().max(200).optional(), note: z.string().max(1000).optional(), followUpAt: z.string().datetime().optional().nullable() }),
  z.object({ action: z.literal("message"), channel: z.enum(["SMS", "EMAIL", "WHATSAPP", "IN_APP"]), body: z.string().trim().min(5).max(640) }),
  z.object({ action: z.literal("returned") }),
  z.object({ action: z.literal("lost"), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("note"), note: z.string().trim().min(1).max(1000) }),
]);

export const POST = gymRoute({ permission: "recovery.manage" }, async (ctx, req, params) => {
  const id = String(params.id);
  const body = await parseJson(req, actionSchema);
  switch (body.action) {
    case "contact":
      return logContact(ctx.gym.id, id, ctx.user.id, { method: body.method, result: body.result, note: body.note, followUpAt: body.followUpAt ? new Date(body.followUpAt) : null });
    case "message":
      if (!ctx.can("notifications.send")) throw forbidden();
      return sendRecoveryMessage(ctx.gym.id, id, { userId: ctx.user.id, name: ctx.user.name }, { channel: body.channel, body: body.body });
    case "returned":
      return markRecovered(ctx.gym.id, id, ctx.user.id);
    case "lost":
      return markLost(ctx.gym.id, id, ctx.user.id, body.note);
    case "note":
      return addNote(ctx.gym.id, id, ctx.user.id, body.note);
  }
});
