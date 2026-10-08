import QRCode from "qrcode";
import { memberRoute } from "@/lib/api";
import { memberPassToken } from "@/services/attendance";

/** The member's personal QR, for the front desk to scan. Rotates every few minutes. */
export const GET = memberRoute({ feature: "attendance" }, async (ctx) => {
  const token = memberPassToken(ctx.member);
  return { token, qr: await QRCode.toDataURL(token, { margin: 1, width: 260 }), expiresInSeconds: 300 };
});
