import { globSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/client";
import { ADMIN_PERMISSIONS, PERMISSIONS, type AdminPermission } from "@/lib/rbac";
import type { PlatformRole } from "@/generated/prisma/client";
import { makeGym } from "./helpers/fixtures";
import { jar, makeUser, req, signInAdmin, signInStaff, signInUser, signOut } from "./helpers/route";

vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);

/**
 * Property sweep over every API handler: the guard each wrapper promises has to hold for all of them, not just the
 * ones somebody remembered to test. Options are read from the source so a new route is covered the day it lands.
 */
type Wrapper = "gymRoute" | "adminRoute" | "memberRoute" | "vendorRoute" | "userRoute" | "publicRoute";
type Handler = (req: Request, rc?: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Entry = { file: string; method: string; wrapper: Wrapper; options: string; path: string; params: Record<string, string> };

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
// Routes that are deliberately unauthenticated (they check credentials or signatures themselves, or are public).
const NOT_WRAPPED = new Set(["src/app/api/health/route.ts GET"]);

function balancedObject(src: string, start: number) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced options");
}

function enumerate(): Entry[] {
  const out: Entry[] = [];
  for (const file of globSync("src/app/api/**/route.ts").sort()) {
    const src = readFileSync(file, "utf8");
    const dir = file.replace(/^src\/app/, "").replace(/\/route\.ts$/, "");
    const params: Record<string, string> = {};
    const path = dir.replace(/\[(\w+)\]/g, (_, k: string) => ((params[k] = `missing${k}`), `missing${k}`));
    for (const method of METHODS) {
      const m = new RegExp(`export (?:const|async function) ${method}\\b`).exec(src);
      if (!m) continue;
      const w = /^\s*=\s*(\w+Route)\(\s*/.exec(src.slice(m.index + m[0].length));
      if (!w) {
        if (!NOT_WRAPPED.has(`${file} ${method}`)) throw new Error(`${file} ${method} is not wrapped in a route guard`);
        continue;
      }
      const optStart = m.index + m[0].length + w[0].length;
      out.push({ file, method, wrapper: w[1] as Wrapper, options: balancedObject(src, optStart), path, params });
    }
  }
  return out;
}

const ENTRIES = enumerate();
const modules = new Map<string, Record<string, Handler>>();
async function call(e: Entry, headers: Record<string, string> = {}) {
  if (!modules.has(e.file)) modules.set(e.file, await import(/* @vite-ignore */ `../${e.file}`));
  const handler = modules.get(e.file)![e.method]!;
  const body = e.method === "GET" || e.method === "DELETE" ? undefined : {};
  return handler(req(e.path, { method: e.method, body, headers }), { params: Promise.resolve(e.params) });
}

const permissionsOf = (opts: string) => {
  const m = /permission:\s*("[\w.]+"|\[[^\]]*\])/.exec(opts);
  return m ? [...m[1]!.matchAll(/"([\w.]+)"/g)].map((x) => x[1]!) : [];
};
const by = (w: Wrapper) => ENTRIES.filter((e) => e.wrapper === w);
const label = (e: Entry) => `${e.method} ${e.path}`;

let gymId: string;
beforeAll(async () => {
  gymId = (await makeGym()).gym.id;
}, 120_000);
beforeEach(() => signOut());
afterAll(() => signOut());

describe("route inventory", () => {
  it("finds every handler and knows its wrapper", () => {
    expect(ENTRIES.length).toBeGreaterThan(190);
    for (const w of ["gymRoute", "adminRoute", "memberRoute", "vendorRoute", "userRoute", "publicRoute"] as const) expect(by(w).length).toBeGreaterThan(0);
  });

  it("names only real permissions", () => {
    const staffPerms = new Set<string>(PERMISSIONS);
    const adminPerms = new Set(Object.keys(ADMIN_PERMISSIONS));
    for (const e of by("gymRoute")) for (const p of permissionsOf(e.options)) expect(staffPerms.has(p), `${label(e)}: ${p}`).toBe(true);
    for (const e of by("adminRoute")) {
      const perms = permissionsOf(e.options);
      expect(perms.length, `${label(e)} has no admin permission`).toBe(1);
      expect(adminPerms.has(perms[0]!), `${label(e)}: ${perms[0]}`).toBe(true);
    }
  });

  it("every gym write route names a permission (or is on the reviewed list)", () => {
    // Reviewed: support tickets are open to every active staff member of the gym.
    const OPEN_TO_ALL_STAFF = new Set(["GET /api/gym/support", "POST /api/gym/support"]);
    const unguarded = by("gymRoute").filter((e) => permissionsOf(e.options).length === 0 && !OPEN_TO_ALL_STAFF.has(label(e)));
    expect(unguarded.map(label)).toEqual([]);
  });
});

describe("signed out", () => {
  it("every authenticated handler answers 401 and never runs", async () => {
    const wrong: string[] = [];
    for (const e of ENTRIES.filter((x) => x.wrapper !== "publicRoute")) {
      const res = await call(e);
      if (res.status !== 401) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);
});

describe("cross-site requests", () => {
  it("every mutating handler refuses a foreign Origin before doing anything", async () => {
    // Device check-ins and payment webhooks come from machines, not browsers, and authenticate by key/signature.
    const wrong: string[] = [];
    for (const e of ENTRIES.filter((x) => x.method !== "GET" && !/skipOriginCheck:\s*true/.test(x.options))) {
      const res = await call(e, { origin: "https://evil.example" });
      if (res.status !== 403) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("only machine endpoints skip the origin check", () => {
    const skipping = ENTRIES.filter((x) => /skipOriginCheck:\s*true/.test(x.options)).map(label).sort();
    expect(skipping).toEqual(["POST /api/devices/checkin", "POST /api/webhooks/payments/missingprovider"]);
  });
});

describe("signed in with no role anywhere", () => {
  it("is refused by every staff, member and vendor handler", async () => {
    const user = await makeUser("Nobody");
    const wrong: string[] = [];
    for (const e of ENTRIES.filter((x) => x.wrapper === "gymRoute" || x.wrapper === "memberRoute" || x.wrapper === "vendorRoute")) {
      await signInUser(user.id, gymId);
      const res = await call(e);
      if (res.status !== 403) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("a user session never opens an admin handler", async () => {
    const user = await makeUser("Not an admin");
    await signInUser(user.id, gymId);
    const wrong: string[] = [];
    for (const e of by("adminRoute")) {
      const res = await call(e);
      if (res.status !== 401) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);
});

describe("staff permissions", () => {
  it("a staff member with every permission revoked is refused by every permissioned gym handler", async () => {
    await signInStaff(gymId, "MANAGER", { revokedPermissions: [...PERMISSIONS] });
    const token = jar.user;
    const wrong: string[] = [];
    for (const e of by("gymRoute").filter((x) => permissionsOf(x.options).length)) {
      jar.user = token;
      const res = await call(e);
      if (res.status !== 403) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("each permission alone is not enough for a handler that needs a different one", async () => {
    // For every handler, grant exactly the permissions it does NOT need: it must still refuse.
    const wrong: string[] = [];
    for (const e of by("gymRoute").filter((x) => permissionsOf(x.options).length)) {
      const need = new Set(permissionsOf(e.options));
      for (const missing of need) {
        // Revocation beats grants, so this staff member holds everything except `missing`.
        await signInStaff(gymId, "STAFF", { grantedPermissions: PERMISSIONS.filter((p) => p !== missing), revokedPermissions: [missing] });
        const res = await call(e);
        if (res.status !== 403) wrong.push(`${label(e)} without ${missing} -> ${res.status}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 600_000);

  it("a suspended gym's staff are locked out except where the route allows it", async () => {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    await prisma.gym.update({ where: { id: gym.id }, data: { status: "SUSPENDED" } });
    const token = jar.user;
    const wrong: string[] = [];
    for (const e of by("gymRoute").filter((x) => !/allowSuspended:\s*true/.test(x.options))) {
      jar.user = token;
      const res = await call(e);
      if (res.status !== 403) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);
});

describe("platform admin roles", () => {
  it("every admin handler refuses each role that lacks its permission", async () => {
    const roles: PlatformRole[] = ["SUPER_ADMIN", "SUPPORT_ADMIN", "FINANCE_ADMIN"];
    const tokens = new Map<PlatformRole, string>();
    for (const r of roles) {
      await signInAdmin(r);
      tokens.set(r, jar.admin);
    }
    const wrong: string[] = [];
    let checked = 0;
    for (const e of by("adminRoute")) {
      const perm = permissionsOf(e.options)[0] as AdminPermission;
      for (const r of roles.filter((x) => !(ADMIN_PERMISSIONS[perm] as readonly PlatformRole[]).includes(x))) {
        jar.admin = tokens.get(r)!;
        const res = await call(e);
        checked++;
        if (res.status !== 403) wrong.push(`${label(e)} as ${r} -> ${res.status}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(wrong).toEqual([]);
  }, 300_000);

  it("an admin session whose MFA isn't verified is refused", async () => {
    const admin = await signInAdmin("SUPER_ADMIN");
    await prisma.adminSession.updateMany({ where: { adminId: admin.id }, data: { mfaVerifiedAt: null } });
    const wrong: string[] = [];
    for (const e of by("adminRoute").filter((x) => !/stage:\s*"partial"/.test(x.options))) {
      const res = await call(e);
      if (res.status !== 403 && res.status !== 401) wrong.push(`${label(e)} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);
});
