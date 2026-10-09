import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const host of ["localhost", "192.168.100.77"]) {
  const BASE = `http://${host}:3000`;
  const ctx = await b.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto(BASE + "/login"); await page.fill('input[name=identifier]', "owner@pulsefitness.demo"); await page.fill('input[name=password]', "GymPulse!Demo2026"); await page.click('button[type=submit]'); await page.waitForURL(/\/app/);
  // create a member through the API (the dialog is broken on IP), then use the Invite button UI
  const m = await page.evaluate(async () => (await (await fetch("/api/gym/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "QA Invitee " + Date.now().toString(36), phone: "98" + String(Date.now()).slice(-8) }) })).json()));
  const id = m.id ?? m.member?.id;
  await page.goto(`${BASE}/app/members/${id}`, { waitUntil: "load" }); await page.waitForTimeout(1500);
  const crashed = (await page.locator("body").innerText()).includes("couldn’t load");
  console.log(`${host}: member page crashed=${crashed} exceptions=${[...new Set(errs)].join("|")}`);
  // Directly exercise clipboard availability in this origin
  const clip = await page.evaluate(() => ({ secure: window.isSecureContext, clipboard: typeof navigator.clipboard, randomUUID: typeof crypto.randomUUID, getRandomValues: typeof crypto.getRandomValues }));
  console.log(`${host}: secureContext/API availability`, JSON.stringify(clip));
  const r = await page.evaluate(async (id) => { const res = await fetch(`/api/gym/members/${id}/invite`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return res.json(); }, id);
  console.log(`${host}: invite link = ${r.link} (matches host: ${r.link?.startsWith(BASE)})`);
  if (!crashed) {
    await page.getByRole("button", { name: /Invite to app/ }).click();
    await page.getByRole("dialog").locator("button:has(svg.lucide-copy)").click(); await page.waitForTimeout(800);
    console.log(`${host}: clipboard now = ${await page.evaluate(() => navigator.clipboard.readText())}`);
  }
  // accept invite in a fresh context
  const c2 = await b.newContext(); const p2 = await c2.newPage();
  await p2.goto(r.link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "load" });
  const labels = await p2.locator("form input").evaluateAll(els => els.map(e => e.name + ":" + e.type));
  for (const el of await p2.locator("form input").all()) { const t = await el.getAttribute("type"); const n = await el.getAttribute("name"); if (t === "password") await el.fill("QaInvitee!Pass2026"); else if (!(await el.inputValue())) await el.fill(n === "email" ? `inv${Date.now()}@qa.demo` : "QA Invitee"); }
  await p2.click('button[type=submit]');
  await p2.waitForURL(/\/app/, { timeout: 30000 }).catch(() => {});
  console.log(`${host}: invite accept fields=${labels} → ${p2.url().replace(BASE, "")} | ${(await p2.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 120)}`);
  const reuse = await p2.evaluate(async (tok) => { const res = await fetch(`/api/auth/invite/${tok}`); return res.status; }, r.link.split("/invite/")[1]);
  console.log(`${host}: GET invite token after use → ${reuse}`);
  await c2.close(); await ctx.close();
}
await b.close();
