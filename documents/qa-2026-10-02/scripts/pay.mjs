import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const host of ["localhost", "192.168.100.77"]) {
  const BASE = `http://${host}:3000`;
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", e => errs.push(e.message));
  const nav = []; page.on("framenavigated", f => f === page.mainFrame() && nav.push(f.url()));
  await page.goto(BASE + "/login"); await page.fill('input[name=identifier]', "member@pulsefitness.demo"); await page.fill('input[name=password]', "GymPulse!Demo2026"); await page.click('button[type=submit]'); await page.waitForURL(/\/app/);
  await page.goto(BASE + "/app/renew", { waitUntil: "load" }); await page.waitForTimeout(800);
  const before = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160);
  await page.getByRole("button", { name: /pay|renew/i }).first().click();
  await page.waitForURL(/\/pay\/sandbox\//, { timeout: 30000 });
  const t0 = Date.now();
  await page.getByRole("button", { name: /Approve payment/ }).click();
  await page.waitForTimeout(6000);
  console.log(`${host}: before="${before}"`);
  console.log(`${host}: after approve (${Date.now() - t0}ms) → ${page.url()}`);
  console.log(`${host}: nav chain: ${nav.slice(-4).join(" → ")}`);
  console.log(`${host}: page: ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
  console.log(`${host}: exceptions: ${[...new Set(errs)].join("|") || "none"}`);
  await page.screenshot({ path: `out/${host}/pay-after-approve.png` });
  await ctx.close();
}
await b.close();
