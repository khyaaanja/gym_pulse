import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext(); const page = await ctx.newPage();
await page.goto("http://localhost:3000/login"); await page.fill('input[name=identifier]', "owner@pulsefitness.demo"); await page.fill('input[name=password]', "GymPulse!Demo2026"); await page.click('button[type=submit]'); await page.waitForURL(/\/app/);
for (const p of ["/app", "/app/members", "/app/reports", "/app/settings", "/app/renew", "/app/pulse", "/app/attendance"]) {
  const p2 = await ctx.newPage(); const cdp = await ctx.newCDPSession(p2); await cdp.send("Performance.enable");
  await p2.goto("http://localhost:3000" + p, { waitUntil: "load" }); await p2.waitForTimeout(1500);
  const n = await p2.evaluate(() => ({ dom: document.querySelectorAll("*").length, depth: (() => { let m = 0; for (const e of document.querySelectorAll("*")) { let d = 0, x = e; while (x = x.parentElement) d++; m = Math.max(m, d); } return m; })(), rows: document.querySelectorAll("tr").length }));
  const { metrics } = await cdp.send("Performance.getMetrics"); const M = Object.fromEntries(metrics.map(x => [x.name, x.value]));
  const lcp = await p2.evaluate(() => new Promise(r => { new PerformanceObserver(l => { const e = l.getEntries().at(-1); r(Math.round(e.startTime)); }).observe({ type: "largest-contentful-paint", buffered: true }); setTimeout(() => r(null), 1500); }));
  const cls = await p2.evaluate(() => new Promise(r => { let s = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) s += e.value; }).observe({ type: "layout-shift", buffered: true }); setTimeout(() => r(+s.toFixed(3)), 1000); }));
  console.log(`${p.padEnd(16)} DOM=${n.dom} depth=${n.depth} tr=${n.rows} heap=${(M.JSHeapUsedSize / 1e6).toFixed(1)}MB LCP=${lcp}ms CLS=${cls}`);
  await p2.close();
}
await b.close();
