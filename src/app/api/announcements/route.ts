import { userRoute } from "@/lib/api";
import { visibleAnnouncements } from "@/services/announcements";

export const GET = userRoute({}, async (ctx) => visibleAnnouncements(ctx.user.id, ctx.session.activeGymId));
