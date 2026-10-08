import type { ImportFileKind } from "@/generated/prisma/enums";

export const ALLOWED = {
  csv: { kind: "CSV", mimes: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"] },
  xlsx: { kind: "SPREADSHEET", mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", "application/zip"] },
  xls: { kind: "SPREADSHEET", mimes: ["application/vnd.ms-excel", "application/octet-stream"] },
  pdf: { kind: "PDF", mimes: ["application/pdf"] },
  jpg: { kind: "IMAGE", mimes: ["image/jpeg"] },
  jpeg: { kind: "IMAGE", mimes: ["image/jpeg"] },
  png: { kind: "IMAGE", mimes: ["image/png"] },
  heic: { kind: "IMAGE", mimes: ["image/heic", "image/heif", "application/octet-stream"] },
} as const satisfies Record<string, { kind: ImportFileKind; mimes: readonly string[] }>;

export type AllowedExt = keyof typeof ALLOWED;

/** Identify a file by its first bytes; the extension and browser-supplied MIME type are only hints. */
export function sniff(buf: Buffer): AllowedExt | "text" | null {
  const hex = buf.subarray(0, 12).toString("hex");
  if (hex.startsWith("504b0304")) return "xlsx"; // zip container (OOXML)
  if (hex.startsWith("d0cf11e0a1b11ae1")) return "xls"; // OLE2 compound file
  if (hex.startsWith("25504446")) return "pdf";
  if (hex.startsWith("ffd8ff")) return "jpg";
  if (hex.startsWith("89504e470d0a1a0a")) return "png";
  if (buf.subarray(4, 12).toString("latin1").match(/^ftyp(heic|heix|hevc|mif1|msf1|heif)/)) return "heic";
  // Plain text: no NUL bytes in the first 4KB and mostly printable.
  const head = buf.subarray(0, 4096);
  if (!head.includes(0)) {
    const printable = [...head].filter((b) => b === 9 || b === 10 || b === 13 || b >= 32).length;
    if (printable / Math.max(1, head.length) > 0.95) return "text";
  }
  return null;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  return base.normalize("NFKC").replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\.{2,}/g, ".").slice(0, 120) || "upload";
}

export type Validated = { ext: AllowedExt; kind: ImportFileKind };

/** Extension, declared MIME type and magic bytes must all agree. */
export function validateUpload(filename: string, declaredMime: string, buf: Buffer): Validated | { error: string } {
  const ext = filename.toLowerCase().split(".").pop() as AllowedExt;
  const spec = ALLOWED[ext];
  if (!spec) return { error: "That file type isn't supported. Upload CSV, Excel (XLSX/XLS), PDF, JPG, PNG or HEIC." };
  if (declaredMime && !(spec.mimes as readonly string[]).includes(declaredMime) && declaredMime !== "") {
    return { error: "The file's type doesn't match its extension." };
  }
  const actual = sniff(buf);
  const ok =
    (ext === "csv" && actual === "text") ||
    (ext === "xlsx" && actual === "xlsx") ||
    (ext === "xls" && (actual === "xls" || actual === "text")) ||
    (ext === "pdf" && actual === "pdf") ||
    ((ext === "jpg" || ext === "jpeg") && actual === "jpg") ||
    (ext === "png" && actual === "png") ||
    (ext === "heic" && actual === "heic");
  if (!ok) return { error: "The file's contents don't match its type. Please re-export and try again." };
  return { ext, kind: spec.kind };
}
