// Phase 4: cross-tenant & cross-member object access (IDOR). Property: no identity can read or write an object it doesn't own.
import fs from "node:fs";
const HOST = process.argv[2] ?? "localhost";
const BASE = `http://${HOST}:3000`;
const H = { origin: BASE, "content-type": "application/json" };
const PW = "GymPulse!Demo2026";
async function login(id, admin = false) {
  const r = await fetch(BASE + (admin ? "/api/admin/auth/login" : "/api/auth/login"), { method: "POST", headers: H, body: JSON.stringify(admin ? { email: id, password: PW } : { identifier: id, password: PW }) });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const call = async (cookie, m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { ...H, cookie }, body: m === "GET" ? undefined : JSON.stringify(b ?? {}), redirect: "manual" }); return { s: r.status, b: await r.text() }; };
const pulse = await login("owner@pulsefitness.demo");
const yoga = await login("owner@yoganest.demo");
const member = await login("member@pulsefitness.demo");

const ids = (txt) => { try { const j = JSON.parse(txt); const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? []; return arr.map((x) => x.id).filter(Boolean); } catch { return []; } };
const res = [];
const check = (label, r, okStatuses = [401, 403, 404]) => { const pass = okStatuses.includes(r.s); res.push({ label, status: r.s, pass, body: r.b.slice(0, 160) }); console.log(`[${HOST}] ${pass ? "PASS" : "FAIL"} ${label} → ${r.s} ${pass ? "" : r.b.slice(0, 160)}`); };

const lists = { members: "/api/gym/members?pageSize=3", announcements: "/api/gym/announcements", bookings: "/api/gym/bookings", coupons: "/api/gym/coupons", locations: "/api/gym/locations", plans: "/api/gym/plans", products: "/api/gym/products", staff: "/api/gym/staff", recovery: "/api/gym/recovery", predictions: "/api/gym/predictions", orders: "/api/gym/orders", imports: "/api/gym/imports", devices: "/api/gym/devices", payments: "/api/gym/payments" };
const pulseIds = {};
for (const [k, p] of Object.entries(lists)) { const r = await call(pulse, "GET", p); pulseIds[k] = ids(r.b).slice(0, 2); }
console.log(`[${HOST}] pulse ids:`, JSON.stringify(Object.fromEntries(Object.entries(pulseIds).map(([k, v]) => [k, v.length]))));

const reads = { members: ["GET"], recovery: ["GET"], predictions: ["GET"], imports: ["GET"] };
const writes = { members: "PATCH", announcements: "PATCH", bookings: "PATCH", coupons: "PATCH", locations: "PATCH", plans: "PATCH", products: "PATCH", staff: "PATCH", orders: "POST", recovery: "POST" };
for (const [k, list] of Object.entries(pulseIds)) for (const id of list) {
  for (const m of reads[k] ?? []) check(`yoga owner ${m} pulse ${k}/${id}`, await call(yoga, m, `/api/gym/${k}/${id}`));
  if (writes[k]) check(`yoga owner ${writes[k]} {} pulse ${k}/${id}`, await call(yoga, writes[k], `/api/gym/${k}/${id}`, k === "members" ? { notes: "QA cross-tenant write" } : {}), [401, 403, 404, 400]);
  if (k === "members") {
    check(`yoga owner POST invite pulse member ${id}`, await call(yoga, "POST", `/api/gym/members/${id}/invite`, {}));
    check(`yoga owner check-in pulse member ${id}`, await call(yoga, "POST", "/api/gym/checkin", { memberId: id }), [400, 403, 404]);
    check(`yoga owner manual payment for pulse member ${id}`, await call(yoga, "POST", "/api/gym/payments/manual", { memberId: id, planId: pulseIds.plans[0], method: "CASH", idempotencyKey: "qa-xt-" + Date.now() }), [400, 403, 404]);
  }
}
// A 400 on a cross-tenant PATCH means the body was validated before the object lookup: confirm nothing changed.
const m0 = pulseIds.members[0];
if (m0) { const r = await call(pulse, "GET", `/api/gym/members/${m0}`); const leaked = r.b.includes("QA cross-tenant write"); res.push({ label: "pulse member notes unchanged after yoga PATCH", pass: !leaked }); console.log(`[${HOST}] ${leaked ? "FAIL" : "PASS"} pulse member notes unchanged after yoga PATCH`); }

// Mass assignment: create a member in Yoga while smuggling Pulse's gymId.
const pulseMe = JSON.parse((await call(pulse, "GET", "/api/auth/me")).b);
const pulseGymId = pulseMe.gym?.id ?? pulseMe.gymId ?? pulseMe.activeGym?.id ?? JSON.stringify(pulseMe).match(/"gymId":"([a-z0-9]+)"/)?.[1];
const mk = await call(yoga, "POST", "/api/gym/members", { fullName: `QA smuggle ${Date.now()}`, gymId: pulseGymId });
const newId = ids(`[${mk.b}]`)[0] ?? JSON.parse(mk.b).id ?? JSON.parse(mk.b).member?.id;
const seenByPulse = newId ? (await call(pulse, "GET", `/api/gym/members/${newId}`)).s : "n/a";
res.push({ label: "mass-assigned gymId ignored on member create", pass: seenByPulse !== 200, status: `create ${mk.s}, pulse sees ${seenByPulse}` });
console.log(`[${HOST}] ${seenByPulse !== 200 ? "PASS" : "FAIL"} mass-assigned gymId ignored (create ${mk.s}, pulse GET → ${seenByPulse}) pulseGymId=${pulseGymId}`);

// Switch-gym into a gym you're not staff of.
check("pulse owner switch-gym into a foreign gym id", await call(pulse, "POST", "/api/auth/switch-gym", { gymId: "qa-not-my-gym-0000" }), [400, 403, 404]);

// Cross-tenant DELETE: Yoga deletes a QA announcement owned by Pulse.
const ann = await call(pulse, "POST", "/api/gym/announcements", { title: "QA delete-target", body: "QA cross-tenant delete target", audience: "EVERYONE" });
const annId = JSON.parse(ann.b).id ?? JSON.parse(ann.b).announcement?.id;
if (annId) {
  check(`yoga owner DELETE pulse announcement ${annId}`, await call(yoga, "DELETE", `/api/gym/announcements/${annId}`));
  const still = await call(pulse, "GET", "/api/gym/announcements");
  res.push({ label: "pulse announcement survives yoga DELETE", pass: still.b.includes(annId) }); console.log(`[${HOST}] ${still.b.includes(annId) ? "PASS" : "FAIL"} pulse announcement survives`);
  await call(pulse, "DELETE", `/api/gym/announcements/${annId}`);
} else console.log(`[${HOST}] could not create announcement: ${ann.s} ${ann.b.slice(0, 200)}`);

// Member → other members' receipts / orders.
const pays = JSON.parse((await call(pulse, "GET", "/api/gym/payments?pageSize=50")).b);
const payArr = Array.isArray(pays) ? pays : Object.values(pays).find(Array.isArray) ?? [];
const myMe = JSON.parse((await call(member, "GET", "/api/auth/me")).b);
const foreign = payArr.find((p) => p.status === "SUCCEEDED" && !JSON.stringify(p).includes("Aarav"));
if (foreign) {
  const r = await fetch(`${BASE}/app/receipts/${foreign.id}`, { headers: { cookie: member }, redirect: "manual" });
  const t = await r.text();
  const leak = r.status === 200 && /Receipt|Invoice/i.test(t) && t.includes(foreign.member?.fullName ?? "@@");
  res.push({ label: `member opens another member's receipt ${foreign.id}`, pass: !leak, status: r.status }); console.log(`[${HOST}] ${leak ? "FAIL" : "PASS"} member opens foreign receipt → ${r.status}`);
}
const orders = JSON.parse((await call(pulse, "GET", "/api/gym/orders")).b);
const ordArr = Array.isArray(orders) ? orders : Object.values(orders).find(Array.isArray) ?? [];
const fo = ordArr.find((o) => !JSON.stringify(o).includes("Aarav"));
if (fo) check(`member pays someone else's order ${fo.id}`, await call(member, "POST", `/api/me/orders/${fo.id}/pay`, {}), [400, 403, 404, 409]);
fs.writeFileSync(`out/${HOST}/tenant.json`, JSON.stringify(res, null, 1));
console.log(`[${HOST}] tenant probes: ${res.filter((r) => r.pass).length}/${res.length} passed`);
