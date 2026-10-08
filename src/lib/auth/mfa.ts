import { generate, generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { decryptString, encryptString } from "@/lib/crypto";

export function newMfaSecret() {
  const secret = generateSecret();
  return { secret, secretEnc: encryptString(secret) };
}

export async function mfaQrDataUrl(label: string, secret: string) {
  return QRCode.toDataURL(generateURI({ issuer: "GymPulse", label, secret }), { margin: 1, width: 220 });
}

export async function verifyTotp(secretEnc: string | null | undefined, token: string): Promise<boolean> {
  if (!secretEnc || !/^\d{6}$/.test(token)) return false;
  try {
    const res = await verify({ secret: decryptString(secretEnc), token, epochTolerance: 30 });
    return res.valid;
  } catch {
    // A corrupt or undecryptable secret must fail closed, never crash the sign-in.
    return false;
  }
}

/** Test helper — generates the current code for a stored secret. */
export async function currentTotp(secretEnc: string) {
  return generate({ secret: decryptString(secretEnc) });
}
