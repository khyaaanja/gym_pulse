// Phase 1: per-host, per-role crawl in real Google Chrome, instrumented over the Chrome DevTools Protocol.
// Usage: node crawl.mjs <host> [roles,comma,separated]
import { chromium } from "playwright";
import fs from "node:fs";

const HOST = process.argv[2] ?? "localhost";
const BASE = `http://${HOST}:3000`;
const PW = "GymPulse!Demo2026";
const OUT = `out/${HOST}`;
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const ROLES = {
  anon: { start: ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/reset-password?token=bogus", "/super-admin/login", "/legal/terms", "/legal/privacy", "/checkin/bogus-token", "/pay/sandbox/bogus", "/invite/bogus", "/this-does-not-exist", "/app", "/vendor", "/super-admin", "/app/members"], prefix: null },
  owner: { login: "owner@pulsefitness.demo", start: ["/app"], prefix: "/app" },
  manager: { login: "manager@pulsefitness.demo", start: ["/app"], prefix: "/app" },
  staff: { login: "staff@pulsefitness.demo", start: ["/app"], prefix: "/app" },
  trainer: { login: "trainer@pulsefitness.demo", start: ["/app"], prefix: "/app" },
  member: { login: "member@pulsefitness.demo", start: ["/app"], prefix: "/app" },
  vendor: { login: "vendor@himalayan-nutrition.demo", start: ["/vendor", "/app"], prefix: "/vendor" },
  admin: { admin: "super@gympulse.local", start: ["/super-admin"], prefix: "/super-admin" },
};
// Pages every gym role is also force-visited, to learn what each role is allowed to see (not only what nav shows).
const APP_ALL = ["/app", "/app/announcements", "/app/attendance", "/app/bookings", "/app/forecast", "/app/imports", "/app/imports/new", "/app/kiosk", "/app/marketplace", "/app/marketplace/orders", "/app/members", "/app/more", "/app/notifications", "/app/onboarding", "/app/pulse", "/app/renew", "/app/reports", "/app/security", "/app/settings"];
const roleList = (process.argv[3] ?? Object.keys(ROLES).join(",")).split(",");

const pattern = (p) => p.replace(/\/[a-z0-9]{20,}|\/[0-9a-f-]{32,36}|\/\d+(?=\/|$)/gi, "/:id");
const ERROR_TEXT = /(Application error|Something went wrong|Internal Server Error|Unhandled Runtime Error|could not be loaded|failed to load|This page couldn.t load|\bFailed\b)/i;

async function login(page, role) {
  const r = ROLES[role];
  if (r.admin) {
    await page.goto(`${BASE}/super-admin/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('input[name="email"]').fill(r.admin);
  } else {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('input[name="identifier"]').fill(r.login);
  }
  await page.locator('input[name="password"]').fill(PW);
  const t0 = Date.now();
  await Promise.all([
    page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 60000 }).catch(() => {}),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  return { url: page.url().replace(BASE, ""), ms: Date.now() - t0 };
}

async function visit(page, cdp, path, role) {
  const ev = { console: [], exceptions: [], failed: [], http4xx5xx: [], aborted: [] };
  const onConsole = (m) => { if (["error", "warning"].includes(m.type())) ev.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); };
  const onErr = (e) => ev.exceptions.push(String(e.message).slice(0, 300));
  const onFail = (rq) => { const f = rq.failure()?.errorText ?? "?"; (f.includes("ERR_ABORTED") ? ev.aborted : ev.failed).push(`${f} ${rq.method()} ${rq.url().replace(BASE, "")}`); };
  const onResp = (rs) => { if (rs.status() >= 400) ev.http4xx5xx.push(`${rs.status()} ${rs.request().method()} ${rs.url().replace(BASE, "")}`); };
  page.on("console", onConsole); page.on("pageerror", onErr); page.on("requestfailed", onFail); page.on("response", onResp);
  const t0 = Date.now();
  let status = null, navErr = null;
  try {
    const resp = await page.goto(BASE + path, { waitUntil: "load", timeout: 60000 });
    status = resp?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  } catch (e) { navErr = String(e.message).split("\n")[0]; }
  const ms = Date.now() - t0;
  let dom = {};
  try {
    dom = await page.evaluate((reSrc) => {
      const re = new RegExp(reSrc, "i");
      const text = document.body?.innerText ?? "";
      const lines = text.split("\n").filter((l) => re.test(l)).slice(0, 5);
      const unlabeled = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter((el) => {
        if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label")) return false;
        return !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      }).map((el) => el.name || el.type || el.tagName).slice(0, 8);
      const noAlt = [...document.querySelectorAll("img:not([alt])")].map((i) => i.src.slice(-60)).slice(0, 5);
      const emptyBtns = [...document.querySelectorAll("button,a[href]")].filter((b) => !(b.innerText || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.querySelector("img[alt]:not([alt=''])")).length;
      const nestedA = document.querySelectorAll("a a").length;
      const dupIds = (() => { const c = {}; document.querySelectorAll("[id]").forEach((e) => (c[e.id] = (c[e.id] || 0) + 1)); return Object.keys(c).filter((k) => c[k] > 1).slice(0, 5); })();
      const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
      return {
        title: document.title, h1: document.querySelector("h1")?.innerText?.slice(0, 80) ?? null,
        errorLines: lines, overflowX: document.documentElement.scrollWidth - window.innerWidth,
        unlabeled, noAlt, emptyBtns, nestedA, dupIds, links, textLen: text.length,
      };
    }, ERROR_TEXT.source);
  } catch (e) { dom = { evalErr: String(e.message).slice(0, 200) }; }
  let perf = {};
  try {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    perf = { jsHeapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1), nodes: m.Nodes, layoutCount: m.LayoutCount, scriptS: +m.ScriptDuration.toFixed(2), taskS: +m.TaskDuration.toFixed(2) };
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const fcp = performance.getEntriesByName("first-contentful-paint")[0]; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transferKB: Math.round(n.transferSize / 1024), fcp: fcp ? Math.round(fcp.startTime) : null } : null; });
    perf.nav = nav;
  } catch {}
  const shot = `${OUT}/shots/${role}${path.replace(/[^a-z0-9]+/gi, "_")}.png`.slice(0, 200);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  page.off("console", onConsole); page.off("pageerror", onErr); page.off("requestfailed", onFail); page.off("response", onResp);
  const { links, ...rest } = dom;
  return { rec: { role, path, finalUrl: page.url().replace(BASE, ""), status, navErr, ms, ...rest, perf, ...ev, shot }, links: links ?? [] };
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-first-run"] });
const results = [];
for (const role of roleList) {
  const r = ROLES[role];
  for (const viewport of [{ name: "desktop", width: 1366, height: 800 }, { name: "phone", width: 390, height: 844, mobile: true }]) {
    if (viewport.name === "phone" && role === "anon") { /* anon covered below on phone too */ }
    const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: !!viewport.mobile, hasTouch: !!viewport.mobile, deviceScaleFactor: viewport.mobile ? 2 : 1 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    let loginInfo = null;
    if (role !== "anon") {
      try { loginInfo = await login(page, role); } catch (e) { loginInfo = { error: String(e.message).split("\n")[0] }; }
      const cookies = await ctx.cookies();
      loginInfo.cookies = cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, expiresInH: c.expires > 0 ? Math.round((c.expires - Date.now() / 1000) / 3600) : "session" }));
      console.log(`[${HOST}] ${role}/${viewport.name} login →`, JSON.stringify(loginInfo));
      results.push({ role, viewport: viewport.name, login: loginInfo });
    }
    const queue = [...r.start, ...(r.prefix === "/app" ? APP_ALL : [])];
    const seenPath = new Set(), seenPattern = {};
    const limit = viewport.name === "phone" ? 25 : 70;
    let count = 0;
    while (queue.length && count < limit) {
      const p = queue.shift();
      if (seenPath.has(p)) continue;
      const pat = pattern(p.split("?")[0]);
      seenPattern[pat] = (seenPattern[pat] ?? 0) + 1;
      if (seenPattern[pat] > 2) continue;
      seenPath.add(p); count++;
      const { rec, links } = await visit(page, cdp, p, role);
      rec.viewport = viewport.name;
      results.push(rec);
      const flag = [rec.status >= 400 && `HTTP${rec.status}`, rec.navErr && "NAVERR", rec.exceptions.length && `EXC${rec.exceptions.length}`, rec.console.length && `CON${rec.console.length}`, rec.http4xx5xx.length && `4xx5xx:${rec.http4xx5xx.length}`, rec.failed.length && `FAIL${rec.failed.length}`, rec.errorLines?.length && "ERRTEXT", rec.overflowX > 1 && `OVERFLOW${rec.overflowX}`, rec.nestedA && "NESTED_A"].filter(Boolean).join(" ");
      console.log(`[${HOST}] ${role}/${viewport.name} ${rec.status} ${rec.ms}ms ${p} → ${rec.finalUrl} ${flag}`);
      if (r.prefix) for (const h of links) {
        if (!h || !h.startsWith(r.prefix) || h.includes("/logout") || h.startsWith("/app/n/")) continue;
        const clean = h.split("#")[0];
        if (!seenPath.has(clean)) queue.push(clean);
      }
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/crawl.json`, JSON.stringify(results, null, 1));
console.log(`[${HOST}] done: ${results.length} records`);
