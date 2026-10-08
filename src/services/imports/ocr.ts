import path from "node:path";
import { mkdir } from "node:fs/promises";

export class OcrUnavailable extends Error {}
export class UnreadableImage extends Error {}

export type Word = { text: string; conf: number; x0: number; x1: number; y0: number; y1: number };
export type OcrGrid = { rows: string[][]; confidence: number[][]; meanConfidence: number };

/** Image → preprocessed PNG → Tesseract words (with boxes + confidence) → reconstructed table. */
export async function ocrImage(buf: Buffer): Promise<OcrGrid> {
  if ((process.env.OCR_PROVIDER ?? "none") === "none") throw new OcrUnavailable("OCR service unavailable");
  const sharp = (await import("sharp")).default;
  let png: Buffer;
  try {
    png = await sharp(buf, { failOn: "error" })
      .rotate() // honour EXIF orientation from phone cameras
      .resize({ width: 2400, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
  } catch (err) {
    throw new UnreadableImage(
      /heif|heic/i.test(String((err as Error).message))
        ? "This HEIC photo couldn't be read on this server. Please export it as JPG (iPhone: Settings → Camera → Formats → Most Compatible) and upload again."
        : "We couldn't read this image. Please upload a clear JPG or PNG photo.",
    );
  }

  const { createWorker } = await import("tesseract.js");
  const cachePath = path.resolve(process.env.STORAGE_DIR ?? "./.storage", "tessdata");
  await mkdir(cachePath, { recursive: true });
  const worker = await createWorker("eng", 1, {
    cachePath,
    ...(process.env.TESSERACT_LANG_PATH ? { langPath: process.env.TESSERACT_LANG_PATH } : {}),
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6" as never, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const words: Word[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          for (const w of l.words) {
            const text = w.text.trim();
            if (text) words.push({ text, conf: w.confidence, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
          }
    if (words.length < 4) throw new UnreadableImage("We couldn't find a table in this photo. Make sure the sheet fills the frame and is in focus.");
    return reconstructTable(words);
  } finally {
    await worker.terminate();
  }
}

/**
 * Groups words into rows by vertical position, then finds column boundaries from vertical
 * whitespace that runs through the whole table. Exported for testing without OCR.
 */
export function reconstructTable(words: Word[]): OcrGrid {
  const heights = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 20;

  // Rows: cluster by vertical centre.
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: Word[][] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const row = rows.at(-1);
    const rowCy = row ? row.reduce((a, x) => a + (x.y0 + x.y1) / 2, 0) / row.length : -Infinity;
    if (row && Math.abs(cy - rowCy) < medianH * 0.6) row.push(w);
    else rows.push([w]);
  }

  // Columns: x-ranges that (almost) no row has text in are gaps; wide gaps become column separators.
  // Rows vote rather than any word vetoing, so a title or note spanning the page can't merge columns.
  const minX = Math.min(...words.map((w) => w.x0));
  const maxX = Math.max(...words.map((w) => w.x1));
  const covered = new Uint16Array(Math.ceil(maxX - minX) + 2);
  for (const r of rows) {
    const mine = new Uint8Array(covered.length);
    for (const w of r) for (let x = Math.floor(w.x0 - minX); x <= Math.ceil(w.x1 - minX); x++) mine[x] = 1;
    mine.forEach((v, x) => (covered[x]! += v));
  }
  const tolerance = Math.floor(rows.length * 0.2);
  const minGap = Math.max(12, medianH * 0.9);
  const separators: number[] = [];
  let gapStart = -1;
  for (let x = 0; x < covered.length; x++) {
    const open = covered[x]! <= tolerance;
    if (open && gapStart < 0) gapStart = x;
    if (!open && gapStart >= 0) {
      if (x - gapStart >= minGap) separators.push(minX + (gapStart + x) / 2);
      gapStart = -1;
    }
  }
  const colOf = (w: Word) => {
    const cx = (w.x0 + w.x1) / 2;
    let c = 0;
    while (c < separators.length && cx > separators[c]!) c++;
    return c;
  };
  const nCols = separators.length + 1;
  const outRows: string[][] = [];
  const outConf: number[][] = [];
  for (const r of rows) {
    const cells: Word[][] = Array.from({ length: nCols }, () => []);
    for (const w of r.sort((a, b) => a.x0 - b.x0)) cells[colOf(w)]!.push(w);
    outRows.push(cells.map((c) => c.map((w) => w.text).join(" ")));
    outConf.push(cells.map((c) => (c.length ? Math.min(...c.map((w) => w.conf)) : 100)));
  }
  const mean = words.reduce((a, w) => a + w.conf, 0) / words.length;
  return { rows: outRows, confidence: outConf, meanConfidence: Math.round(mean * 10) / 10 };
}
