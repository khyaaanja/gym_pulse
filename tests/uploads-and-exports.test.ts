import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readUploadForm } from "@/lib/api";
import { csvCell } from "@/services/reports";

const MB = 1024 * 1024;

/** A request body that streams `total` bytes in 64 KB chunks and records how much the server actually pulled. */
function streamingUpload(total: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= total) return controller.close();
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const req = new NextRequest("http://localhost:3000/api/gym/imports", { method: "POST", body, headers: { "content-type": "multipart/form-data; boundary=x", ...headers }, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
  return { req, pulled: () => pulled };
}

describe("uploads are refused before they're read into memory", () => {
  it("a declared size over the limit is rejected without reading the body", async () => {
    const { req, pulled } = streamingUpload(50 * MB, { "content-length": String(50 * MB) });
    await expect(readUploadForm(req, 10 * MB)).rejects.toMatchObject({ status: 413 });
    expect(pulled()).toBeLessThanOrEqual(128 * 1024);
  });

  it("an undeclared (chunked) body is cut off once it passes the limit", async () => {
    const { req, pulled } = streamingUpload(50 * MB);
    await expect(readUploadForm(req, 1 * MB)).rejects.toMatchObject({ status: 413 });
    expect(pulled()).toBeLessThan(2 * MB);
  });

  it("a normal upload still parses", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(1000)], "members.csv", { type: "text/csv" }));
    const req = new NextRequest("http://localhost:3000/api/gym/imports", { method: "POST", body: form });
    const parsed = await readUploadForm(req, 1 * MB);
    expect((parsed.get("file") as File).size).toBe(1000);
  });
});

describe("CSV export cells", () => {
  it("keep negative amounts as numbers", () => {
    expect(csvCell(-1500)).toBe("-1500");
    expect(csvCell("-15.5")).toBe("-15.5");
  });

  it("still neutralise formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});
