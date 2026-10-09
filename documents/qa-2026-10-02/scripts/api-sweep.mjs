// Phase 2: property sweep of every API route handler.
// Property A: every non-public route returns 401 to an anonymous caller (GET and mutations).
// Property B: for every gymRoute, a role lacking the declared permission gets 403; a role holding it is not refused.
// Property C: admin routes refuse every gym/member/vendor session; gym routes refuse the admin session.
// Mutations are only sent where the caller is EXPECTED to be refused, so a pass writes nothing.
import fs from "node:fs";
import { execSync } from "node:child_process";

const HOST = process.argv[2] ?? "localhost";
const BASE = `http://${HOST}:3000`;
const PW = "GymPulse!Demo2026";
const ROOT = "/home/kali-linux/Desktop/gym";
fs.mkdirSync(`out/${HOST}`, { recursive: true });

const ROLE_DEFAULTS = {
  owner: "ALL",
  manager: ["members.view", "members.edit", "attendance.view", "attendance.create", "payments.view", "reports.view", "imports.create", "imports.view", "prediction.view", "recovery.manage", "notifications.send", "marketplace.manage", "bookings.manage"],
  staff: ["members.view", "members.edit", "attendance.view", "attendance.create", "recovery.manage", "notifications.send"],
  trainer: ["members.view", "attendance.view", "attendance.create", "bookings.manage"],
};

// Static inventory.
const files = execSync(`find ${ROOT}/src/app/api -name route.ts`).toString().trim().split("\n").sort();
const routes = [];
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const path = f.replace(`${ROOT}/src/app`, "").replace("/route.ts", "");
  const re = /export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*(\w+)\(\s*(\{[\s\S]*?\})\s*,\s*(async|\()/g;
  let m; const found = new Set();
  while ((m = re.exec(s))) {
    const [, method, wrapper, opts] = m;
    const perms = [...opts.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((x) => x[1]);
    routes.push({ path, method, wrapper, perms, opts: opts.replace(/\s+/g, " ") });
    found.add(method);
  }
  for (const mm of s.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)) if (!found.has(mm[1])) routes.push({ path, method: mm[1], wrapper: "raw", perms: [], opts: "" });
}

async function req(method, path, cookie, body) {
  const headers = { origin: BASE, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}), redirect: "manual" });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, body: text.slice(0, 200), setCookie: r.headers.getSetCookie?.() ?? [] };
  } catch (e) { return { status: 0, ms: Date.now() - t0, body: String(e.message) }; }
}
const cookieFrom = (sc) => sc.map((c) => c.split(";")[0]).join("; ");

const LOGINS = {
  owner: ["/api/auth/login", { identifier: "owner@pulsefitness.demo", password: PW }],
  manager: ["/api/auth/login", { identifier: "manager@pulsefitness.demo", password: PW }],
  staff: ["/api/auth/login", { identifier: "staff@pulsefitness.demo", password: PW }],
  trainer: ["/api/auth/login", { identifier: "trainer@pulsefitness.demo", password: PW }],
  member: ["/api/auth/login", { identifier: "member@pulsefitness.demo", password: PW }],
  vendor: ["/api/auth/login", { identifier: "vendor@himalayan-nutrition.demo", password: PW }],
  yogaOwner: ["/api/auth/login", { identifier: "owner@yoganest.demo", password: PW }],
  admin: ["/api/admin/auth/login", { email: "super@gympulse.local", password: PW }],
  support: ["/api/admin/auth/login", { email: "support@gympulse.local", password: PW }],
  finance: ["/api/admin/auth/login", { email: "finance@gympulse.local", password: PW }],
};
const cookies = {};
const loginLog = {};
for (const [role, [ep, body]] of Object.entries(LOGINS)) {
  const r = await req("POST", ep, null, body);
  cookies[role] = cookieFrom(r.setCookie);
  loginLog[role] = { status: r.status, ms: r.ms, body: r.body.slice(0, 160), cookieHeaders: r.setCookie.map((c) => c.replace(/=[^;]+/, "=…")) };
  console.log(`[${HOST}] login ${role}: ${r.status} ${r.ms}ms ${r.body.slice(0, 120)}`);
}

const SKIP_MUTATE = /\/logout|\/switch-gym|\/password|\/mfa|\/auth\/login|\/auth\/signup|\/records-check|\/webhooks|\/devices\/checkin|\/push\/test/;
const fill = (p) => p.replace(/\[[^\]]+\]/g, "qa-nonexistent-0000");
const findings = [];
const matrix = [];
const gymRoles = ["owner", "manager", "staff", "trainer"];
const allRoles = ["anon", ...Object.keys(LOGINS)];

for (const r of routes) {
  const path = fill(r.path);
  const isMut = r.method !== "GET";
  const row = { route: `${r.method} ${r.path}`, wrapper: r.wrapper, perms: r.perms.join("|") };
  for (const role of allRoles) {
    let expectDeny;
    if (r.wrapper === "publicRoute" || r.wrapper === "raw") expectDeny = null; // judged by hand
    else if (role === "anon") expectDeny = 401;
    else if (r.wrapper === "adminRoute") expectDeny = ["admin", "support", "finance"].includes(role) ? null : "401/403";
    else if (["admin", "support", "finance"].includes(role)) expectDeny = "401/403";
    else if (r.wrapper === "gymRoute") {
      if (role === "member" || role === "vendor") expectDeny = "401/403";
      else if (role === "yogaOwner") expectDeny = null;
      else { const has = ROLE_DEFAULTS[role] === "ALL" || r.perms.every((p) => ROLE_DEFAULTS[role].includes(p)); expectDeny = has ? false : 403; }
    } else if (r.wrapper === "memberRoute") expectDeny = role === "member" ? false : null;
    else if (r.wrapper === "vendorRoute") expectDeny = role === "vendor" ? false : "401/403";
    else expectDeny = null;
    // Only send a mutation when it's expected to be refused (or the route is public and safe to probe with junk).
    if (isMut && !(expectDeny && expectDeny !== false)) { row[role] = "-"; continue; }
    if (isMut && SKIP_MUTATE.test(r.path)) { row[role] = "skip"; continue; }
    const res = await req(r.method, path, role === "anon" ? null : cookies[role], { __qa: true });
    row[role] = res.status;
    const denied = res.status === 401 || res.status === 403;
    if (expectDeny && !denied && !(res.status === 404 && r.path.includes("["))) findings.push({ sev: isMut ? "HIGH" : "MED", role, route: row.route, expected: expectDeny, got: res.status, body: res.body });
    if (expectDeny === false && denied) findings.push({ sev: "LOW", kind: "over-denied", role, route: row.route, perms: r.perms, got: res.status, body: res.body });
    if (res.status >= 500) findings.push({ sev: "MED", kind: "5xx", role, route: row.route, got: res.status, body: res.body });
  }
  matrix.push(row);
}

// Cross-origin: a mutating request from a foreign Origin with a valid session must be refused.
const xo = [];
for (const [method, p] of [["POST", "/api/gym/members"], ["PATCH", "/api/gym/settings"], ["POST", "/api/gym/payments/manual"], ["POST", "/api/auth/logout"]]) {
  const r = await fetch(BASE + p, { method, headers: { origin: "https://evil.example", cookie: cookies.owner, "content-type": "application/json" }, body: "{}" });
  xo.push({ method, p, status: r.status, body: (await r.text()).slice(0, 120) });
  const r2 = await fetch(BASE + p, { method, headers: { "sec-fetch-site": "cross-site", cookie: cookies.owner, "content-type": "application/json" }, body: "{}" });
  xo.push({ method, p, variant: "sec-fetch-site:cross-site, no Origin", status: r2.status, body: (await r2.text()).slice(0, 120) });
}

// Response headers on a page and an API.
const hdr = {};
for (const p of ["/", "/login", "/api/health", "/app"]) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  hdr[p] = Object.fromEntries([...r.headers].filter(([k]) => /security|frame|content-type-options|referrer|permissions|cross-origin|strict-transport|cache-control|x-powered|server|location|content-security/i.test(k)));
}

const out = { host: HOST, routeCount: routes.length, loginLog, findings, crossOrigin: xo, headers: hdr, matrix };
fs.writeFileSync(`out/${HOST}/api-sweep.json`, JSON.stringify(out, null, 1));
console.log(`[${HOST}] routes=${routes.length} findings=${findings.length}`);
for (const f of findings) console.log(JSON.stringify(f));
console.log("cross-origin:", JSON.stringify(xo));
