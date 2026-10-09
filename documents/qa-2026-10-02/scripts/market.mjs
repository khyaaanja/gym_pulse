import { chromium } from "playwright";
const BASE = "http://localhost:3000", H = { origin: BASE, "content-type": "application/json" }, PW = "GymPulse!Demo2026";
const apiLogin = async (ep, body) => (await fetch(BASE + ep, { method: "POST", headers: H, body: JSON.stringify(body) })).headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const call = async (ck, m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { ...H, cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, t: await r.text() }; };
const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext(); const page = await ctx.newPage(); const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/login"); await page.fill('input[name=identifier]', "vendor@himalayan-nutrition.demo"); await page.fill('input[name=password]', PW); await page.click('button[type=submit]'); await page.waitForURL(/\/(vendor|app)/);
await page.goto(BASE + "/vendor", { waitUntil: "load" });
const name = "QA Whey " + Date.now().toString(36);
await page.getByRole("button", { name: "New listing" }).click();
const dlg = page.getByRole("dialog");
await dlg.locator('select[name=gymId]').selectOption({ index: 1 }).catch(async () => {});
const cat = dlg.locator('select[name=categoryId]'); const opts = await cat.locator("option").allInnerTexts(); await cat.selectOption({ index: opts.length > 1 ? 1 : 0 });
await dlg.locator('input[name=name]').fill(name); await dlg.locator('input[name=priceRupees]').fill("2500"); await dlg.locator('input[name=inventory]').fill("10");
await dlg.locator('button[type=submit]').click();
const toast = await page.locator("[data-sonner-toast]").last().innerText({ timeout: 15000 }).catch(() => "(no toast)");
console.log("vendor UI create listing →", toast.replace(/\s+/g, " "), "exc:", errs.join("|") || "none");
await ctx.close(); await b.close();

const vendor = await apiLogin("/api/auth/login", { identifier: "vendor@himalayan-nutrition.demo", password: PW });
const admin = await apiLogin("/api/admin/auth/login", { email: "super@gympulse.local", password: PW });
const pulse = await apiLogin("/api/auth/login", { identifier: "owner@pulsefitness.demo", password: PW });
const yoga = await apiLogin("/api/auth/login", { identifier: "owner@yoganest.demo", password: PW });
const yogaGym = (await call(yoga, "GET", "/api/auth/me")).t.match(/"gymId":"([a-z0-9]+)"/)?.[1] ?? JSON.parse((await call(yoga, "GET", "/api/auth/me")).t).gym?.id;
const cats = await call(admin, "GET", "/api/admin/categories"); const catId = cats.t.match(/"id":"([a-z0-9]+)"/)?.[1];
const x = await call(vendor, "POST", "/api/vendor/products", { gymId: yogaGym, categoryId: catId, name: "QA unlinked-gym listing", priceRupees: 100, inventory: 1 });
console.log(`vendor lists into UNLINKED gym ${yogaGym} → ${x.s} ${x.t.slice(0, 160)}`);
const neg = await call(vendor, "POST", "/api/vendor/products", { gymId: "x", categoryId: catId, name: "QA neg", priceRupees: -5, inventory: -1 });
console.log(`vendor negative price/stock → ${neg.s} ${neg.t.slice(0, 140)}`);
const listings = await call(admin, "GET", "/api/admin/listings?status=PENDING_APPROVAL");
const m = JSON.parse(listings.t); const arr = Array.isArray(m) ? m : Object.values(m).find(Array.isArray) ?? [];
const mine = arr.find(p => p.name === name);
console.log(`admin sees pending listing: ${!!mine} (pending total ${arr.length})`);
if (mine) {
  console.log("admin approve →", (await call(admin, "PATCH", `/api/admin/listings/${mine.id}`, { decision: "approve" })).s);
  const g = await call(pulse, "GET", "/api/gym/products"); console.log("gym products API includes it:", g.t.includes(name));
  const member = await apiLogin("/api/auth/login", { identifier: "member@pulsefitness.demo", password: PW });
  const mp = await fetch(BASE + "/app/marketplace", { headers: { cookie: member } }); console.log("member marketplace page shows it:", (await mp.text()).includes(name));
}
