import { z } from "zod";
import { gymRoute, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { rangeFor } from "@/services/analytics";
import { buildReport, REPORTS, type ReportKey } from "@/services/reports";

export const GET = gymRoute({ permission: "reports.view", rateLimit: { limit: 30, windowSeconds: 300 } }, async (ctx, req, params) => {
  const key = String(params.key) as ReportKey;
  if (!(key in REPORTS)) throw notFound();
  if ((key === "payments" || key === "revenue") && !ctx.can("payments.view")) throw notFound();
  const q = parseQuery(req, z.object({ range: z.enum(["today", "7d", "30d", "90d", "custom"]).default("30d"), from: z.string().optional(), to: z.string().optional() }));
  const { filename, csv } = await buildReport(ctx.gym.id, key, rangeFor(q.range, ctx.gym.timezone, q));
  await audit({ actor: ctx.actor, action: "reports.exported", entityType: "Report", entityId: key, gymId: ctx.gym.id, metadata: q });
  return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
});
