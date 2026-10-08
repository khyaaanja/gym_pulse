import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBuffer, encryptBuffer } from "@/lib/crypto";

/** Import files live outside the web root, encrypted with AES-256-GCM. Paths are never user-controlled. */
function root() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./.storage");
}

function resolveKey(key: string) {
  if (!/^[a-z]+\/[a-z0-9]+\/[a-z0-9]+\.bin$/i.test(key)) throw new Error("Invalid storage key");
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Storage path escape");
  return full;
}

export async function putEncrypted(area: "imports" | "public", gymId: string, id: string, data: Buffer) {
  const key = `${area}/${gymId.replace(/[^a-z0-9]/gi, "")}/${id.replace(/[^a-z0-9]/gi, "")}.bin`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, area === "imports" ? encryptBuffer(data) : data, { mode: 0o600 });
  return key;
}

export async function getDecrypted(key: string) {
  return decryptBuffer(await readFile(/*turbopackIgnore: true*/ resolveKey(key)));
}

export async function getPlain(key: string) {
  return readFile(/*turbopackIgnore: true*/ resolveKey(key));
}

export async function deleteStored(key: string) {
  await rm(resolveKey(key), { force: true });
}
