import { publicRoute } from "@/lib/api";
import { logoutUser } from "@/lib/auth/session";

export const POST = publicRoute({ rateLimit: { limit: 60, windowSeconds: 60 } }, async () => {
  await logoutUser();
  return { ok: true };
});
