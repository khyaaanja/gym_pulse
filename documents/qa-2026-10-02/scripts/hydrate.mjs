import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const host of ["localhost","192.168.100.77"]) for (const rate of [1, 6]) for (const path of ["/signup", "/login"]) {
  const ctx = await b.newContext(); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto(`http://${host}:3000${path}`, { waitUntil: "commit" });
  const sel = path === "/signup" ? 'input[name="gymName"]' : 'input[name="identifier"]';
  await page.locator(sel).waitFor({ state: "attached" });
  await page.locator(sel).fill("typed-early");
  const early = await page.evaluate(() => performance.now() | 0);
  await page.waitForLoadState("load"); await page.waitForTimeout(4000);
  const v = await page.locator(sel).inputValue();
  // Then: weak-password submit on signup, see if fields survive the error
  let afterErr = "";
  if (path === "/signup") {
    for (const [n, val] of [["gymName","G"],["city","Ktm"],["ownerName","O N"],["email",`x${Date.now()}@qa.demo`],["phone","98"+String(Date.now()).slice(-8)],["password","123"]]) await page.locator(`input[name="${n}"]`).fill(val);
    await page.locator('button[type=submit]').click(); await page.waitForTimeout(2500);
    afterErr = await page.locator('input[name="gymName"]').inputValue();
  }
  console.log(`${host} cpu×${rate} ${path}: typed at ${early}ms, value after hydration="${v}" ${path==="/signup"?`gymName after 400="${afterErr}"`:""}`);
  await ctx.close();
}
await b.close();
