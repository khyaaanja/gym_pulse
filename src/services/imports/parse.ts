import Papa from "papaparse";
import type { AllowedExt } from "./detect";
import path from "node:path";
import { ocrImage, reconstructTable, type Word } from "./ocr";
import { excelSerialToDate } from "./normalize";

export const MAX_ROWS = 5000;

export type Grid = {
  rows: unknown[][];
  confidence?: number[][];
  sheetName?: string;
  ocrUsed: boolean;
  ocrConfidence?: number;
  notes: string[];
};

export class ParseError extends Error {}

/** Drops empty rows and pads every row to the same width, keeping OCR confidences aligned. */
function trimGrid(rows: unknown[][], confidence?: number[][]): { rows: unknown[][]; confidence?: number[][] } {
  const keep = rows.map((r, i) => (r.some((c) => String(c ?? "").trim() !== "") ? i : -1)).filter((i) => i >= 0);
  const width = Math.max(0, ...keep.map((i) => rows[i]!.length));
  const pad = <T,>(r: T[], fill: T) => Array.from({ length: width }, (_, i) => r[i] ?? fill);
  return {
    rows: keep.map((i) => pad(rows[i]!, "" as unknown).map((c) => (typeof c === "string" ? c.trim() : c))),
    confidence: confidence ? keep.map((i) => pad(confidence[i] ?? [], 100)) : undefined,
  };
}

/** Text laid out in columns without ruling lines: rebuild the table from each text item's position, page by page. */
async function pdfTextColumns(buf: Buffer): Promise<string[][]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Only used for glyph metrics; text extraction works without it, so a missing folder just logs a warning.
  const standardFontDataUrl = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;
  const doc = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, standardFontDataUrl }).promise;
  try {
    const out: string[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 50); n++) {
      const page = await doc.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const words: Word[] = [];
      for (const item of (await page.getTextContent()).items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const size = Math.abs(item.transform[3]) || item.height || 10;
        const x0 = item.transform[4];
        const y0 = height - item.transform[5] - size;
        words.push({ text: item.str.trim(), conf: 100, x0, x1: x0 + Math.max(item.width, 1), y0, y1: y0 + size });
      }
      if (words.length >= 4) out.push(...reconstructTable(words).rows.filter((r) => r.filter(Boolean).length >= 2));
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

export async function parseToGrid(ext: AllowedExt, buf: Buffer): Promise<Grid> {
  const notes: string[] = [];
  let grid: Grid;
  if (ext === "csv") {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    grid = { rows: res.data, ocrUsed: false, notes };
  } else if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    // Parse only — formulas are never evaluated, macros are never run. Date cells are read from
    // their serial number + number format, which avoids any timezone shifting of calendar dates.
    const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellNF: true, cellFormula: false, cellHTML: false, sheetRows: MAX_ROWS + 20 });
    let best: { name: string; rows: unknown[][] } | null = null;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]!;
      if (!ws["!ref"]) continue;
      const range = XLSX.utils.decode_range(ws["!ref"]);
      const rows: unknown[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: unknown[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as { t: string; v: unknown; z?: string; w?: string } | undefined;
          if (!cell) row.push("");
          else if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) row.push(excelSerialToDate(cell.v as number) ?? cell.w ?? cell.v);
          else if (cell.t === "d") row.push(String(cell.w ?? cell.v));
          else row.push(cell.v ?? "");
        }
        rows.push(row);
      }
      const filled = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== "")).length;
      if (!best || filled > best.rows.filter((r) => r.some((c) => String(c ?? "").trim() !== "")).length) best = { name, rows };
    }
    if (!best) throw new ParseError("This workbook has no sheets with data.");
    if (wb.SheetNames.length > 1) notes.push(`Used sheet "${best.name}" (the one with the most rows).`);
    grid = { rows: best.rows, sheetName: best.name, ocrUsed: false, notes };
  } else if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      // Ruled tables: single-page tables are only in pages[].tables; mergedTables holds tables that continue across pages.
      const tables = await parser.getTable();
      const all = [...tables.mergedTables, ...tables.pages.flatMap((p) => p.tables)];
      const biggest = all.sort((a, b) => b.length - a.length)[0];
      if (biggest && biggest.length >= 2 && Math.max(...biggest.map((r) => r.length)) >= 2) {
        grid = { rows: biggest, ocrUsed: false, notes: [...notes, "Read the largest table in the PDF."] };
      } else {
        const rows = await pdfTextColumns(buf);
        if (rows.length < 2) throw new ParseError("We couldn't find a table in this PDF. If it's a scanned document, upload a photo instead.");
        grid = { rows, ocrUsed: false, notes: [...notes, "This PDF has no table lines, so we guessed the columns from where the text sits. Please check the result."] };
      }
    } finally {
      await parser.destroy();
    }
  } else {
    const ocr = await ocrImage(buf);
    grid = { rows: ocr.rows, confidence: ocr.confidence, ocrUsed: true, ocrConfidence: ocr.meanConfidence, notes };
  }
  const { rows, confidence } = trimGrid(grid.rows, grid.confidence);
  if (rows.length > MAX_ROWS + 1) throw new ParseError(`This file has more than ${MAX_ROWS} rows. Please split it into smaller files.`);
  if (rows.length < 2) throw new ParseError("We couldn't find any data rows in this file.");
  return { ...grid, rows, confidence };
}
