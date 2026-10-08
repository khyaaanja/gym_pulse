import { safeNext } from "@/lib/safe-next";
import { NextResponse, type NextRequest } from "next/server";
import { getUserSession } from "@/lib/auth/session";
import { prisma } from "@/db/client";

/**
 * Opens a notification: marks it read and goes to its link. Used by push taps and the bell, so reading
 * a notification anywhere clears it everywhere. Only the owner's rows are touched; links must be in-app paths.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const to = req.nextUrl.clone();
  to.search = "";
  const s = await getUserSession();
  if (!s) {
    to.pathname = "/login";
    to.searchParams.set("next", `/app/n/${id}`);
    return NextResponse.redirect(to, 303);
  }
  const n = await prisma.notification.findFirst({ where: { id, userId: s.userId, channel: "IN_APP" }, select: { id: true, link: true, readAt: true } });
  if (n && !n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const link = safeNext(n?.link) ?? "/app/notifications";
  const [path, query = ""] = link.split("?");
  to.pathname = path!;
  to.search = query ? `?${query}` : "";
  return NextResponse.redirect(to, 303);
}
