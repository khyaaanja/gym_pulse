import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true });
const login = async (ctx, BASE, id) => { const p = await ctx.newPage(); await p.goto(BASE + "/login"); await p.fill('input[name=identifier]', id); await p.fill('input[name=password]', "GymPulse!Demo2026"); await p.click('button[type=submit]'); await p.waitForURL(/\/app/); return p; };
for (const host of ["localhost", "192.168.100.77"]) {
  const BASE = `http://${host}:3000`;
  const oc = await b.newContext(); const op = await login(oc, BASE, "owner@pulsefitness.demo");
  const k = await op.evaluate(async () => (await fetch("/api/gym/kiosk-token")).json());
  console.log(`${host}: kiosk url=${k.url} (host ok: ${k.url?.startsWith(BASE)}) ttl=${k.expiresInSeconds}s`);
  const mc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); const mp = await login(mc, BASE, "member@pulsefitness.demo");
  const errs = []; mp.on("pageerror", e => errs.push(e.message));
  await mp.goto(k.url, { waitUntil: "load" }); await mp.waitForTimeout(3000);
  console.log(`${host}: member scan → ${mp.url().replace(BASE, "")} | ${(await mp.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160)} | exc=${errs.join("|") || "none"}`);
  await mp.reload({ waitUntil: "load" }); await mp.waitForTimeout(2500);
  console.log(`${host}: rescan → ${(await mp.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 140)}`);
  const tampered = k.url.replace(/.$/, c => c === "a" ? "b" : "a");
  const r = await mp.evaluate(async (t) => { const res = await fetch("/api/me/checkin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }) }); return res.status + " " + (await res.text()).slice(0, 120); }, tampered.split("/checkin/")[1]);
  console.log(`${host}: tampered token → ${r}`);
  // owner sees the check-in on attendance
  await op.goto(BASE + "/app/attendance", { waitUntil: "load" }); await op.waitForTimeout(1500);
  console.log(`${host}: desk sees Aarav today: ${(await op.locator("main").innerText()).includes("Aarav")}`);
  await mp.screenshot({ path: `out/${host}/kiosk-member.png` });
  await oc.close(); await mc.close();
}
await b.close();
