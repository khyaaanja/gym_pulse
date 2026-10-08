import net from "node:net";
import type { ScanStatus } from "@/generated/prisma/enums";

/**
 * Malware scan via ClamAV's clamd INSTREAM protocol when CLAMAV_HOST is configured.
 * Without a scanner the status is NOT_CONFIGURED (shown to admins) — never a fake "clean".
 */
export async function scanBuffer(buf: Buffer): Promise<{ status: ScanStatus; detail?: string }> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return { status: "NOT_CONFIGURED" };
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let reply = "";
    socket.setTimeout(20_000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (d) => (reply += d.toString()));
    socket.on("end", () => {
      if (/OK/.test(reply) && !/FOUND/.test(reply)) resolve({ status: "CLEAN" });
      else if (/FOUND/.test(reply)) resolve({ status: "INFECTED", detail: reply.replace(/\0/g, "").trim() });
      else resolve({ status: "ERROR", detail: reply.slice(0, 200) });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ status: "ERROR", detail: "Scanner timeout" });
    });
    socket.on("error", (e) => resolve({ status: "ERROR", detail: e.message }));
  });
}
