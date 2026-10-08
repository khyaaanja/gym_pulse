import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The stylesheet (Tailwind, ~16 KB compressed) rides in the HTML instead of a second render-blocking request:
  // one round trip less before first paint, which on a slow phone connection is most of the gap to 1.5 s.
  experimental: { inlineCss: true },
  // Let phones/laptops on the LAN load dev assets (HMR, chunks) when opening the site by IP.
  allowedDevOrigins: ["192.168.100.77", "127.0.0.1", "*.ngrok-free.dev", "*.ngrok.app"],
  // Native / wasm modules used only on the server (file parsing, OCR, hashing)
  serverExternalPackages: ["@node-rs/argon2", "sharp", "tesseract.js", "pdf-parse", "pdfjs-dist", "xlsx", "pg"],
  async headers() {
    const headers = [...securityHeaders];
    if (process.env.APP_ENV === "production") {
      headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
    }
    return [
      { source: "/:path*", headers },
      // Film posters and the lifter model: not content-hashed, so cache for a day and revalidate in the background
      // after that — repeat visits paint the stage straight from cache.
      ...["/gym/:file*", "/models/:file*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=2592000" }],
      })),
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
