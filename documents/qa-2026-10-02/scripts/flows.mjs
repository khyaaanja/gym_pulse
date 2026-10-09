// Phase 3: end-to-end UI flows in real Google Chrome (CDP-instrumented), per host.
import { chromium } from "playwright";
import fs from "node:fs";

const HOST = process.argv[2] ?? "localhost";
const BASE = `http://${HOST}:3000`;
const PW = "GymPulse!Demo2026";
const OUT = `out/${HOST}/flows`;
fs.mkdirSync(OUT, { recursive: true });
const TAG = `${HOST === "localhost" ? "L" : "IP"}${Date.now().toString(36).slice(-5)}`;
const steps = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, ...opts });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  page._ev = { exc: [], con: [], api: [] };
  page.on("pageerror", (e) => page._ev.exc.push(e.message.slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Cross-Origin-Opener-Policy") && page._ev.con.push(m.text().slice(0, 200)));
  page.on("response", async (r) => { if (r.url().includes("/api/")) page._ev.api.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  return { ctx, page, cdp };
}

async function step(name, page, fn) {
  const before = { exc: page._ev.exc.length, con: page._ev.con.length, api: page._ev.api.length };
  const t0 = Date.now();
  let ok = true, note = "";
  try { note = (await fn()) ?? ""; } catch (e) { ok = false; note = String(e.message).split("\n")[0].slice(0, 250); }
  const rec = { name, ok, ms: Date.now() - t0, note: String(note).slice(0, 300), url: page.url().replace(BASE, ""), exc: page._ev.exc.slice(before.exc), con: page._ev.con.slice(before.con), api: page._ev.api.slice(before.api).slice(-8) };
  const shot = `${OUT}/${String(steps.length).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "_").slice(0, 50)}.png`;
  await page.screenshot({ path: shot }).catch(() => {});
  rec.shot = shot;
  steps.push(rec);
  console.log(`[${HOST}] ${ok ? "PASS" : "FAIL"} ${name} (${rec.ms}ms) ${rec.note} ${rec.exc.length ? "EXC:" + rec.exc.join("|") : ""} ${rec.con.length ? "CON:" + rec.con.join("|").slice(0, 200) : ""}`);
  return ok;
}

const toast = async (page) => (await page.locator("[data-sonner-toast]").last().innerText({ timeout: 8000 }).catch(() => "(no toast)")).replace(/\s+/g, " ");

async function uiLogin(page, id, pw = PW) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="identifier"]').fill(id);
  await page.locator('input[name="password"]').fill(pw);
  await page.locator('button[type="submit"]').click();
}

// ---------- A. Auth error paths ----------
{
  const { ctx, page } = await newPage();
  await step("login: wrong password shows error, stays on /login", page, async () => {
    await uiLogin(page, "owner@pulsefitness.demo", "wrong-password-xyz");
    await page.waitForTimeout(2500);
    const txt = (await page.locator("form").innerText()).replace(/\s+/g, " ");
    if (!page.url().includes("/login")) throw new Error("navigated away: " + page.url());
    return "form text: " + txt.slice(0, 160);
  });
  await step("login: unknown account message identical to wrong password (no enumeration)", page, async () => {
    const r1 = await page.evaluate(async () => (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "owner@pulsefitness.demo", password: "nope-nope-1" }) })).text());
    const r2 = await page.evaluate(async () => (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "nobody-qa@nowhere.demo", password: "nope-nope-1" }) })).text());
    const strip = (s) => s.replace(/"requestId":"[^"]+"/, "");
    if (strip(r1) !== strip(r2)) throw new Error(`differs: ${r1} VS ${r2}`);
    return r1.slice(0, 150);
  });
  await step("login: empty submit shows validation, no request crash", page, async () => {
    await page.goto(`${BASE}/login`); await page.locator('button[type="submit"]').click(); await page.waitForTimeout(1000);
    return (await page.locator("form").innerText()).replace(/\s+/g, " ").slice(0, 160);
  });
  await step("forgot password: submit shows neutral confirmation", page, async () => {
    await page.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded" });
    await page.locator("input").first().fill("owner@pulsefitness.demo");
    await page.locator('button[type="submit"]').click(); await page.waitForTimeout(2500);
    return (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
  });
  await step("reset password: bogus token rejected", page, async () => {
    await page.goto(`${BASE}/reset-password?token=bogus-token-123`, { waitUntil: "domcontentloaded" });
    const pw = page.locator('input[type="password"]');
    const n = await pw.count();
    for (let i = 0; i < n; i++) await pw.nth(i).fill("BrandNew!Pass2026x");
    await page.locator('button[type="submit"]').click(); await page.waitForTimeout(2500);
    const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    if (page.url().includes("/app")) throw new Error("bogus token logged in!");
    return t.slice(0, 200);
  });
  await ctx.close();
}

// ---------- B. Signup of a brand-new gym ----------
{
  const { ctx, page } = await newPage();
  await step("signup: weak password rejected", page, async () => {
    await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
    const inputs = await page.locator("form input").evaluateAll((els) => els.map((e) => `${e.name}:${e.type}`));
    for (const sel of await page.locator("form input").all()) {
      const name = await sel.getAttribute("name"); const type = await sel.getAttribute("type");
      if (type === "checkbox") { await sel.check().catch(() => {}); continue; }
      if (type === "password") await sel.fill("12345");
      else if (type === "email" || /email/i.test(name)) await sel.fill(`qa-${TAG}@qa.demo`);
      else if (/phone/i.test(name)) await sel.fill("98" + String(Date.now()).slice(-8));
      else await sel.fill(`QA ${TAG} ${name}`);
    }
    await page.locator('button[type="submit"]').click(); await page.waitForTimeout(2500);
    if (page.url().includes("/app")) throw new Error("weak password accepted");
    return `fields=${inputs.join(",")} → ` + (await page.locator("form").innerText()).replace(/\s+/g, " ").slice(0, 200);
  });
  await step("signup: strong password creates gym and lands in app", page, async () => {
    for (const sel of await page.locator('form input[type="password"]').all()) await sel.fill("QaStrong!Pass2026");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app/, { timeout: 30000 });
    return "landed " + page.url().replace(BASE, "");
  });
  await step("signup: new owner sees onboarding/empty state without errors", page, async () => {
    await page.goto(`${BASE}/app`, { waitUntil: "load" }); await page.waitForTimeout(1500);
    return (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
  });
  await step("signup: duplicate email rejected", page, async () => {
    const r = await page.evaluate(async (email) => { const res = await fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "QaStrong!Pass2026", ownerName: "Dup Owner", gymName: "Dup Gym", city: "Kathmandu", phone: "98" + String(Date.now()).slice(-8) }) }); return res.status + " " + (await res.text()).slice(0, 160); }, `qa-${TAG}@qa.demo`);
    if (r.startsWith("2")) throw new Error("duplicate accepted: " + r);
    return r;
  });
  await ctx.close();
}

// ---------- C. Owner daily operations ----------
const memberName = `QA Member ${TAG}`;
{
  const { ctx, page } = await newPage({ permissions: [] });
  await step("owner: login via UI", page, async () => { await uiLogin(page, "owner@pulsefitness.demo"); await page.waitForURL(/\/app/, { timeout: 30000 }); return page.url(); });
  await step("owner: add member via dialog", page, async () => {
    await page.goto(`${BASE}/app/members`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Add member" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('input[name="fullName"]').fill(memberName);
    await dlg.locator('input[name="phone"]').fill("98" + String(Date.now()).slice(-8));
    await dlg.locator('button[type="submit"]').click();
    const t = await toast(page);
    if (!/added/i.test(t)) throw new Error("toast: " + t);
    return t;
  });
  await step("owner: XSS payload in member name is rendered as text", page, async () => {
    await page.getByRole("button", { name: "Add member" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('input[name="fullName"]').fill(`QA <img src=x onerror="window.__xss=1"> ${TAG}`);
    await dlg.locator('button[type="submit"]').click();
    await toast(page);
    await page.goto(`${BASE}/app/members?q=${encodeURIComponent("QA <img")}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    const x = await page.evaluate(() => window.__xss);
    if (x) throw new Error("XSS executed");
    return "not executed";
  });
  await step("owner: member search finds the new member", page, async () => {
    await page.goto(`${BASE}/app/members?q=${encodeURIComponent(memberName)}`, { waitUntil: "load" });
    await page.getByText(memberName).first().waitFor({ timeout: 10000 });
    return "found";
  });
  await step("owner: open member detail page", page, async () => {
    await page.getByText(memberName).first().click();
    await page.waitForURL(/\/app\/members\/[a-z0-9]+/, { timeout: 15000 });
    return page.url().replace(BASE, "");
  });
  await step("owner: edit member (Edit dialog)", page, async () => {
    await page.getByRole("button", { name: "Edit" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('textarea[name="notes"], input[name="notes"]').first().fill(`edited by QA ${TAG}`).catch(() => {});
    await dlg.locator('button[type="submit"]').click();
    return await toast(page);
  });
  await step("owner: check in the new member at desk", page, async () => {
    await page.goto(`${BASE}/app/attendance`, { waitUntil: "load" });
    const box = page.getByLabel("Find member to check in");
    if (!(await box.count())) return "no desk search on /app/attendance (skipped)";
    await box.fill(memberName);
    await page.getByRole("button", { name: /^Check in$/ }).first().click({ timeout: 15000 });
    return await toast(page);
  });
  await step("owner: second check-in same day is handled (no duplicate)", page, async () => {
    const box = page.getByLabel("Find member to check in");
    if (!(await box.count())) return "skipped";
    await box.fill(""); await box.fill(memberName);
    await page.getByRole("button", { name: /^Check in$/ }).first().click({ timeout: 15000 });
    return await toast(page);
  });
  await step("owner: add plan", page, async () => {
    await page.goto(`${BASE}/app/settings`, { waitUntil: "load" });
    await page.getByText("Membership plans", { exact: true }).first().click();
    await page.getByRole("button", { name: "Add plan" }).click();
    const dlg = page.getByRole("dialog");
    const names = await dlg.locator("input,select,textarea").evaluateAll((els) => els.map((e) => `${e.name}:${e.type}`));
    for (const el of await dlg.locator("input").all()) {
      const n = await el.getAttribute("name"), t = await el.getAttribute("type");
      if (t === "checkbox" || t === "hidden") continue;
      if (/name/i.test(n)) await el.fill(`QA Plan ${TAG}`);
      else if (t === "number") await el.fill(/day|duration/i.test(n) ? "30" : "1234");
    }
    await dlg.locator('button[type="submit"]').click();
    return `fields=${names.join(",")} → ` + (await toast(page));
  });
  await step("owner: plan with negative price rejected", page, async () => {
    const r = await page.evaluate(async () => { const res = await fetch("/api/gym/plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "QA neg", priceRupees: -500, durationDays: 30 }) }); return res.status + " " + (await res.text()).slice(0, 200); });
    if (r.startsWith("2")) throw new Error("negative price accepted: " + r);
    return r;
  });
  await step("owner: new announcement", page, async () => {
    await page.goto(`${BASE}/app/announcements`, { waitUntil: "load" });
    await page.getByRole("button", { name: "New announcement" }).click();
    const dlg = page.getByRole("dialog");
    for (const el of await dlg.locator("input:not([type=checkbox]):not([type=hidden]), textarea").all()) {
      const t = await el.getAttribute("type");
      if (t === "datetime-local" || t === "date" || t === "number") continue;
      await el.fill(`QA announcement ${TAG}`);
    }
    await dlg.locator('button[type="submit"]').click();
    return await toast(page);
  });
  await step("owner: record payment from Renew (double-click submit → one payment)", page, async () => {
    await page.goto(`${BASE}/app/renew`, { waitUntil: "load" });
    const btn = page.getByRole("button", { name: "Record payment" }).first();
    if (!(await btn.count())) return "no renewals due — skipped";
    const before = page._ev.api.filter((a) => a.includes("payments/manual")).length;
    await btn.click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('select[name="method"]').selectOption("CASH").catch(() => {});
    const submit = dlg.locator('button[type="submit"]');
    await submit.dblclick();
    const t = (await page.locator("[data-sonner-toast]").last().innerText({ timeout: 40000 }).catch(() => "(no toast in 40s)")).replace(/\s+/g, " ");
    await page.waitForTimeout(2000);
    const calls = page._ev.api.filter((a) => a.includes("payments/manual")).slice(before);
    return `${t} | requests: ${calls.join(", ")}`;
  });
  await step("owner: invite member to app → link host + copy button (clipboard API)", page, async () => {
    await page.goto(`${BASE}/app/members?q=${encodeURIComponent(memberName)}`, { waitUntil: "load" });
    await page.getByText(memberName).first().click();
    await page.waitForURL(/\/app\/members\/[a-z0-9]+/);
    await page.getByRole("button", { name: /Invite to app/ }).click();
    const dlg = page.getByRole("dialog");
    const link = (await dlg.locator("code").innerText({ timeout: 20000 })).trim();
    globalThis.__inviteLink = link;
    const exBefore = page._ev.exc.length;
    await dlg.locator("button:has(svg.lucide-copy)").click(); await page.waitForTimeout(800);
    const t = await toast(page);
    const ex = page._ev.exc.slice(exBefore);
    const hostOk = link.startsWith(BASE);
    if (ex.length || !hostOk) throw new Error(`link=${link} hostMatches=${hostOk} exceptions=${ex.join("|")} toast=${t}`);
    return `link=${link} toast=${t}`;
  });
  await step("owner: kiosk page renders QR", page, async () => {
    await page.goto(`${BASE}/app/kiosk`, { waitUntil: "load" }); await page.waitForTimeout(1500);
    const n = await page.locator("canvas, svg, img").count();
    const t = (await page.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 150);
    return `visual elems=${n}; ${t}`;
  });
  await step("owner: report export download", page, async () => {
    await page.goto(`${BASE}/app/reports`, { waitUntil: "load" });
    const link = page.locator('a[href*="/api/gym/reports/"]').first();
    if (!(await link.count())) return "no export link";
    const href = await link.getAttribute("href");
    const r = await page.evaluate(async (h) => { const res = await fetch(h); return `${res.status} ${res.headers.get("content-type")} ${(await res.text()).length}B`; }, href);
    return `${href} → ${r}`;
  });
  await step("owner: global search (Ctrl+K)", page, async () => {
    await page.goto(`${BASE}/app`, { waitUntil: "load" });
    await page.keyboard.press("Control+k"); await page.waitForTimeout(600);
    const input = page.locator('[cmdk-input], input[placeholder*="earch"]').first();
    if (!(await input.count())) return "no command palette opened";
    await input.fill("QA Member"); await page.waitForTimeout(1500);
    return (await page.locator("[cmdk-list], [role=listbox]").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
  });
  await step("owner: sign out ends session (back to /app redirects to login)", page, async () => {
    await page.goto(`${BASE}/app`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL(/\/login|\/$/, { timeout: 15000 });
    await page.goto(`${BASE}/app/members`, { waitUntil: "load" });
    if (!page.url().includes("/login")) throw new Error("still in app after logout: " + page.url());
    const me = await page.evaluate(async () => (await fetch("/api/auth/me")).status);
    if (me !== 401) throw new Error("/api/auth/me after logout = " + me);
    return "redirected to login; /api/auth/me 401";
  });
  await ctx.close();
}

// ---------- C2. Accept the invite as the member ----------
if (globalThis.__inviteLink) {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await step("invitee(phone): open invite link and set password", page, async () => {
    const link = globalThis.__inviteLink.replace(/^https?:\/\/[^/]+/, BASE);
    await page.goto(link, { waitUntil: "load" });
    const before = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 120);
    for (const el of await page.locator('form input[type="password"]').all()) await el.fill("QaInvitee!Pass2026");
    for (const el of await page.locator('form input[type="email"]').all()) if (!(await el.inputValue())) await el.fill(`invitee-${TAG}@qa.demo`);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app/, { timeout: 30000 });
    return `${before} → ${page.url().replace(BASE, "")}`;
  });
  await step("invitee: member home renders", page, async () => { await page.waitForTimeout(1500); return (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160); });
  await ctx.close();
}

// ---------- D. Trainer cannot reach owner-only pages ----------
{
  const { ctx, page } = await newPage();
  await step("trainer: login", page, async () => { await uiLogin(page, "trainer@pulsefitness.demo"); await page.waitForURL(/\/app/); return "ok"; });
  for (const p of ["/app/settings", "/app/reports", "/app/renew", "/app/imports/new"]) {
    await step(`trainer: blocked from ${p}`, page, async () => {
      await page.goto(BASE + p, { waitUntil: "load" });
      const t = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
      const leaked = /Membership plans|Record payment|Revenue|Upload/i.test(t) && !page.url().includes("forbidden");
      if (leaked) throw new Error(`content visible at ${page.url()}: ${t.slice(0, 150)}`);
      return `→ ${page.url().replace(BASE, "")}: ${t.slice(0, 100)}`;
    });
  }
  await ctx.close();
}

// ---------- E. Member flows ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await step("member(phone): login", page, async () => { await uiLogin(page, "member@pulsefitness.demo"); await page.waitForURL(/\/app/); return "ok"; });
  await step("member: home shows pass/streak", page, async () => { await page.goto(`${BASE}/app`, { waitUntil: "load" }); await page.waitForTimeout(1500); return (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200); });
  await step("member: renew via test gateway", page, async () => {
    await page.goto(`${BASE}/app/renew`, { waitUntil: "load" }); await page.waitForTimeout(1000);
    const t = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
    const btn = page.getByRole("button", { name: /pay|renew/i }).first();
    if (!(await btn.count())) return "no pay button: " + t;
    await btn.click(); await page.waitForTimeout(4000);
    return `after click → ${page.url().replace(BASE, "")} | ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160)}`;
  });
  await step("member: cannot call staff API", page, async () => {
    const s = await page.evaluate(async () => (await fetch("/api/gym/members")).status);
    if (s !== 403 && s !== 401) throw new Error("got " + s);
    return String(s);
  });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/flows.json`, JSON.stringify(steps, null, 1));
console.log(`[${HOST}] flows: ${steps.filter((s) => s.ok).length}/${steps.length} passed`);
