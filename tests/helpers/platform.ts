import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/db/client";
import { json, params as routeParams } from "./route";
import type { AllowedExt } from "@/services/imports/detect";

/** Import files are encrypted into STORAGE_DIR; tests use a throwaway directory instead of the app's .storage. */
export function useTempStorage() {
  process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "gympulse-test-storage-"));
}

let ip = 0;
/** Multipart upload to POST /api/gym/imports (its own address, so the per-IP limits don't couple tests). */
export function uploadReq(name: string, data: Buffer | string, type: string, field = "file") {
  const form = new FormData();
  form.set(field, new File([typeof data === "string" ? Buffer.from(data) : new Uint8Array(data)], name, { type }));
  return new NextRequest("http://localhost:3000/api/gym/imports", {
    method: "POST",
    body: form,
    headers: { origin: "http://localhost:3000", "x-forwarded-for": `10.88.${(ip >> 8) & 255}.${ip++ & 255}` },
  });
}

export const CSV_TYPE = "text/csv";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const extOf = (name: string) => name.toLowerCase().split(".").pop() as AllowedExt;

/**
 * Runs the queued background job of `type` for a gym the way the worker would (the app enqueues; a worker
 * calls the handler). Returns the handler result, or null when nothing was queued.
 */
export async function runQueued(type: "import.process" | "import.commit", jobId: string, gymId: string) {
  const { processImport, commitImport } = await import("@/services/imports/pipeline");
  const queued = await prisma.job.findMany({ where: { type, gymId } });
  const mine = queued.filter((j) => (j.payload as { jobId?: string }).jobId === jobId);
  if (mine.length === 0) return null;
  const payload = mine[0]!.payload as { ext?: AllowedExt };
  return type === "import.process" ? processImport(jobId, gymId, payload.ext!) : commitImport(jobId, gymId);
}

export { json, routeParams };

/** A one-page PDF with text placed in columns (no ruling lines), so the parser has to infer the table from positions. */
export function makeTextPdf(rows: string[][], colX = [50, 200, 350]): Buffer {
  const ops: string[] = ["BT", "/F1 11 Tf"];
  rows.forEach((cells, r) => {
    cells.forEach((text, c) => {
      ops.push(`1 0 0 1 ${colX[c]} ${760 - r * 24} Tm (${text.replace(/[()\\]/g, "")}) Tj`);
    });
  });
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
