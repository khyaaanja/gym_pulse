import { z } from "zod";
import { gymRoute, parseQuery } from "@/lib/api";
import { bookingScope } from "@/lib/scope";

export const GET = gymRoute({ permission: "bookings.manage" }, async (ctx, req) => {
  const q = parseQuery(req, z.object({ status: z.enum(["ALL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"]).default("ALL") }));
  return ctx.db.booking.findMany({
    where: { ...(q.status === "ALL" ? {} : { status: q.status }), ...bookingScope(ctx) },
    include: { member: { select: { fullName: true, phone: true } }, trainer: { include: { user: { select: { name: true } } } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
});
