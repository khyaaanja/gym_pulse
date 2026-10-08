import { publicRoute } from "@/lib/api";
import { logoutAdmin } from "@/lib/auth/session";

export const POST = publicRoute({ rateLimit: { limit: 60, windowSeconds: 60 } }, async () => {
  await logoutAdmin();
  return { ok: true };
});
