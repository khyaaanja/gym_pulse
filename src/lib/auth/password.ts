import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(hashValue: string | null | undefined, password: string): Promise<boolean> {
  if (!hashValue) {
    // Burn comparable time so a missing account isn't distinguishable by timing.
    await hash(password, OPTIONS);
    return false;
  }
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12",
  "gympulse123", "welcome123", "nepal12345", "kathmandu1", "admin12345", "letmein123", "football12",
]);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "That password is too long.")
  .refine((p) => !COMMON.has(p.toLowerCase()), "That password is too common. Choose something less guessable.")
  .refine((p) => new Set(p).size >= 5, "Use a less repetitive password.");
