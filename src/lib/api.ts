import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { prisma } from "@/db/client";
import { tenantDb, TenantViolation, type TenantDb } from "@/db/tenant";
import { AppError, describeUniqueViolation, featureDisabled, forbidden, unauthorized } from "./errors";
import { effectivePermissions, adminCan, type Permission, type AdminPermission } from "./rbac";
import { resolveFlags, type FlagKey } from "./flags";
import { adminSetupStep, getAdminSession, getUserSession, pendingSetup, SETUP_PATH, type AdminSessionWithAdmin, type RequestMeta, type UserSession } from "./auth/session";
import type { AuditActor } from "./audit";
import { log } from "./logger";
import { rateLimit } from "./rate-limit";
import { clientIp } from "./client-ip";
import type { Gym, MarketplaceVendor, Member, StaffMember } from "@/generated/prisma/client";

// ─────────────────────────────── Shared plumbing ───────────────────────────────

type Params = Record<string, string | string[] | undefined>;
type RouteCtx = { params: Promise<Params> };
type Handler<C> = (ctx: C, req: NextRequest, params: Params) => Promise<unknown>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function meta(req: NextRequest): RequestMeta {
  return { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") };
}

const first = (v: string | null) => v?.split(",")[0]?.trim() || null;

/** Origins the browser used to reach us: the proxy's forwarded host first, then Host. */
function requestOrigins(req: NextRequest): string[] {
  const proto = first(req.headers.get("x-forwarded-proto")) ?? new URL(req.url).protocol.replace(":", "");
  return [first(req.headers.get("x-forwarded-host")), req.headers.get("host")].filter((h): h is string => !!h).map((h) => `${proto}://${h}`);
}

/** Base URL for links the requesting device will open itself (e.g. the kiosk QR): the address it used. */
export function requestOrigin(req: NextRequest): string {
  return requestOrigins(req)[0] ?? process.env.APP_URL ?? new URL(req.url).origin;
}

/** Rejects cross-site mutations. SameSite=Lax cookies are the first line; this is the second. */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (origin) {
    // req.url uses the server's own hostname (localhost under `next start`), so also accept the host
    // the browser addressed (e.g. http://192.168.x.x:3000 on the LAN). Origin can't be forged cross-site.
    const allowed = new Set([new URL(req.url).origin, ...requestOrigins(req)]);
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
    if (!allowed.has(origin)) throw forbidden("Cross-site request blocked.");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden("Cross-site request blocked.");
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true });
}

export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message: err.issues[0]?.message ?? "Please check the highlighted fields.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  if (err instanceof TenantViolation) {
    log.error("tenant.violation", { err, requestId });
    return NextResponse.json({ error: { code: "forbidden", message: "You don't have access to that." } }, { status: 403 });
  }
  const code = (err as { code?: string })?.code;
  if (code === "P2002") {
    const c = describeUniqueViolation(err as { meta?: unknown });
    return NextResponse.json({ error: { code: c.code, message: c.message, details: c.details } }, { status: 409 });
  }
  if (code === "P2025") {
    return NextResponse.json({ error: { code: "not_found", message: "We couldn't find that." } }, { status: 404 });
  }
  log.error("api.unhandled", { err, requestId });
  return NextResponse.json(
    { error: { code: "internal", message: "Something went wrong. Please try again.", requestId } },
    { status: 500 },
  );
}

async function run<C>(req: NextRequest, rc: RouteCtx | undefined, build: () => Promise<C>, handler: Handler<C>) {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  let status = 200;
  try {
    assertSameOrigin(req);
    const ctx = await build();
    const params = rc ? await rc.params : {};
    const res = toResponse(await handler(ctx, req, params));
    status = res.status;
    return res;
  } catch (err) {
    const res = errorResponse(err, requestId);
    status = res.status;
    return res;
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms > 1500 || status >= 500) {
      void prisma.metricSample
        .create({ data: { name: status >= 500 ? "api.error" : "api.slow", value: ms, tags: { path: new URL(req.url).pathname, method: req.method, status } } })
        .catch(() => undefined);
    }
  }
}

export async function parseJson<T extends ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "bad_json", "We couldn't read that request.");
  }
  return schema.parse(body);
}

/**
 * Reads a multipart upload without ever holding more than `maxFileBytes` (plus form overhead) in memory: a declared
 * Content-Length over the limit is refused before reading, and the body is counted as it arrives because the
 * header can be missing (chunked) or wrong. `req.formData()` alone would buffer the whole body first.
 */
export async function readUploadForm(req: NextRequest, maxFileBytes: number): Promise<FormData> {
  const cap = maxFileBytes + 256 * 1024;
  const tooLarge = () => new AppError(413, "too_large", `Files can be up to ${Math.round((maxFileBytes / 1024 / 1024) * 10) / 10} MB.`);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "bad_request", "Choose a file to upload.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  try {
    return await new Response(new Blob(chunks as BlobPart[]), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new AppError(400, "bad_request", "Choose a file to upload.");
  }
}

export function parseQuery<T extends ZodType>(req: NextRequest, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * The signed-in user for an API call. Accounts with setup pending (see pendingSetup) get a 403 that tells the client
 * where to go, unless the route is one of the setup endpoints (`allowSetup`).
 */
async function userSessionOrThrow(opts: { requireMfa?: boolean; allowSetup?: boolean }) {
  const session = await getUserSession({ requireMfa: opts.requireMfa ?? true, allowSetup: true });
  if (!session) throw unauthorized();
  const step = pendingSetup(session.user);
  if (step && !opts.allowSetup) {
    throw new AppError(403, "account_setup_required", step === "mfa_enrollment" ? "Set up two-step verification to continue." : "Choose a new password to continue.", { step, path: SETUP_PATH[step] });
  }
  return session;
}

// ─────────────────────────────── Gym staff routes ───────────────────────────────

export type GymContext = {
  user: UserSession["user"];
  session: UserSession;
  staff: StaffMember;
  gym: Gym;
  db: TenantDb;
  perms: Set<Permission>;
  flags: Record<FlagKey, boolean>;
  actor: AuditActor;
  meta: RequestMeta;
  can: (p: Permission) => boolean;
};

export async function resolveStaffContext(session: UserSession, m: RequestMeta): Promise<GymContext | null> {
  const roles = await prisma.staffMember.findMany({
    where: { userId: session.userId, active: true },
    include: { gym: true },
    orderBy: { createdAt: "asc" },
  });
  let staff = roles.find((r) => r.gymId === session.activeGymId);
  // The remembered gym wins only while the user still belongs to it (e.g. as a member there). A gym they were
  // removed from must not lock them out of the gyms they still work at.
  if (!staff && roles.length && !(session.activeGymId && (await prisma.member.count({ where: { userId: session.userId, gymId: session.activeGymId, archivedAt: null } })))) staff = roles[0];
  if (!staff) return null;
  const perms = effectivePermissions(staff);
  const flags = await resolveFlags(staff.gym);
  return {
    user: session.user,
    session,
    staff,
    gym: staff.gym,
    db: tenantDb(staff.gymId),
    perms,
    flags,
    meta: m,
    actor: { type: "USER", id: session.userId, name: session.user.name, role: staff.role, ...m },
    can: (p) => perms.has(p),
  };
}

type GymRouteOptions = {
  permission?: Permission | Permission[];
  feature?: FlagKey;
  allowSuspended?: boolean;
  rateLimit?: { limit: number; windowSeconds: number };
};

export function assertGymUsable(gym: Gym, allowSuspended = false) {
  if (gym.status === "ARCHIVED") throw forbidden("This gym account has been closed.");
  if (gym.status === "SUSPENDED" && !allowSuspended) {
    throw new AppError(403, "gym_suspended", "This gym's GymPulse account is suspended. Please contact GymPulse support.");
  }
}

export function gymRoute(opts: GymRouteOptions, handler: Handler<GymContext>) {
  return (req: NextRequest, rc?: RouteCtx) =>
    run(
      req,
      rc,
      async () => {
        const session = await userSessionOrThrow({});
        const ctx = await resolveStaffContext(session, meta(req));
        if (!ctx) throw forbidden("You're not a staff member of this gym.");
        assertGymUsable(ctx.gym, opts.allowSuspended);
        const needed = opts.permission ? (Array.isArray(opts.permission) ? opts.permission : [opts.permission]) : [];
        for (const p of needed) if (!ctx.perms.has(p)) throw forbidden();
        if (opts.feature && !ctx.flags[opts.feature]) throw featureDisabled(opts.feature.replace(/_/g, " "));
        if (opts.rateLimit) await rateLimit(`api:${req.nextUrl.pathname}:${ctx.user.id}`, opts.rateLimit.limit, opts.rateLimit.windowSeconds);
        return ctx;
      },
      handler,
    );
}

// ─────────────────────────────── Member routes (self-service) ───────────────────────────────

export type MemberContext = {
  user: UserSession["user"];
  session: UserSession;
  member: Member;
  gym: Gym;
  db: TenantDb;
  flags: Record<FlagKey, boolean>;
  actor: AuditActor;
  meta: RequestMeta;
};

export async function resolveMemberContext(session: UserSession, m: RequestMeta): Promise<MemberContext | null> {
  const profiles = await prisma.member.findMany({
    where: { userId: session.userId, archivedAt: null },
    include: { gym: true },
    orderBy: { createdAt: "asc" },
  });
  let member = profiles.find((p) => p.gymId === session.activeGymId);
  // Same rule as staff: fall back to a gym they're still a member of when the remembered one no longer applies.
  if (!member && profiles.length && !(session.activeGymId && (await prisma.staffMember.count({ where: { userId: session.userId, gymId: session.activeGymId, active: true } })))) member = profiles[0];
  if (!member) return null;
  const { gym, ...rest } = member;
  return {
    user: session.user,
    session,
    member: rest as Member,
    gym,
    db: tenantDb(member.gymId),
    flags: await resolveFlags(gym),
    meta: m,
    actor: { type: "USER", id: session.userId, name: session.user.name, role: "MEMBER", ...m },
  };
}

export function memberRoute(opts: { feature?: FlagKey }, handler: Handler<MemberContext>) {
  return (req: NextRequest, rc?: RouteCtx) =>
    run(
      req,
      rc,
      async () => {
        const session = await userSessionOrThrow({});
        const ctx = await resolveMemberContext(session, meta(req));
        if (!ctx) throw forbidden("You don't have a membership at this gym.");
        assertGymUsable(ctx.gym);
        if (ctx.member.status === "SUSPENDED") throw forbidden("Your membership is suspended. Please contact the gym.");
        if (opts.feature && !ctx.flags[opts.feature]) throw featureDisabled(opts.feature.replace(/_/g, " "));
        return ctx;
      },
      handler,
    );
}

// ─────────────────────────────── Vendor routes ───────────────────────────────

export type VendorContext = { user: UserSession["user"]; vendor: MarketplaceVendor; actor: AuditActor; meta: RequestMeta };

export function vendorRoute(opts: { requireApproved?: boolean }, handler: Handler<VendorContext>) {
  return (req: NextRequest, rc?: RouteCtx) =>
    run(
      req,
      rc,
      async () => {
        const session = await userSessionOrThrow({});
        const link = await prisma.vendorUser.findFirst({ where: { userId: session.userId }, include: { vendor: true } });
        if (!link) throw forbidden("This account isn't linked to a vendor.");
        if ((opts.requireApproved ?? true) && link.vendor.status !== "APPROVED") {
          throw forbidden("Your vendor account is not approved yet.");
        }
        const m = meta(req);
        return { user: session.user, vendor: link.vendor, meta: m, actor: { type: "USER" as const, id: session.userId, name: session.user.name, role: "VENDOR", ...m } };
      },
      handler,
    );
}

// ─────────────────────────────── Authenticated user (any role) ───────────────────────────────

export type UserContext = { user: UserSession["user"]; session: UserSession; actor: AuditActor; meta: RequestMeta };

/** Setup endpoints (MFA enrollment, password change, account info) pass `allowSetup`; everything else is blocked until setup is done. */
export function userRoute(opts: { requireMfa?: boolean; allowSetup?: boolean }, handler: Handler<UserContext>) {
  return (req: NextRequest, rc?: RouteCtx) =>
    run(
      req,
      rc,
      async () => {
        const session = await userSessionOrThrow(opts);
        const m = meta(req);
        return { user: session.user, session, meta: m, actor: { type: "USER" as const, id: session.userId, name: session.user.name, ...m } };
      },
      handler,
    );
}

// ─────────────────────────────── Platform admin routes ───────────────────────────────

export type AdminContext = {
  admin: AdminSessionWithAdmin["admin"];
  session: AdminSessionWithAdmin;
  actor: AuditActor;
  meta: RequestMeta;
};

export function adminRoute(opts: { permission: AdminPermission; stage?: "full" | "partial" }, handler: Handler<AdminContext>) {
  return (req: NextRequest, rc?: RouteCtx) =>
    run(
      req,
      rc,
      async () => {
        const session = await getAdminSession(opts.stage ?? "full");
        if (!session) {
          const partial = await getAdminSession("partial");
          const path = partial && adminSetupStep(partial);
          if (path) throw new AppError(403, "account_setup_required", "Finish signing in to continue.", { path });
          throw unauthorized("Please sign in to the GymPulse control center.");
        }
        if (!adminCan(session.admin.role, opts.permission)) throw forbidden();
        const m = meta(req);
        return {
          admin: session.admin,
          session,
          meta: m,
          actor: { type: "PLATFORM_ADMIN" as const, id: session.adminId, name: session.admin.name, role: session.admin.role, ...m },
        };
      },
      handler,
    );
}

// ─────────────────────────────── Public / webhook routes ───────────────────────────────

export type PublicContext = { meta: RequestMeta };

/** For unauthenticated endpoints (login, signup, webhooks, health). Always rate-limited per IP. */
export function publicRoute(
  opts: { rateLimit: { limit: number; windowSeconds: number } | false; skipOriginCheck?: boolean },
  handler: Handler<PublicContext>,
) {
  return (req: NextRequest, rc?: RouteCtx) => {
    const exec = async () => {
      const m = meta(req);
      if (opts.rateLimit) await rateLimit(`public:${req.nextUrl.pathname}:${m.ip ?? "unknown"}`, opts.rateLimit.limit, opts.rateLimit.windowSeconds);
      return { meta: m };
    };
    if (opts.skipOriginCheck) {
      const requestId = crypto.randomUUID();
      return (async () => {
        try {
          const ctx = await exec();
          return toResponse(await handler(ctx, req, rc ? await rc.params : {}));
        } catch (err) {
          return errorResponse(err, requestId);
        }
      })();
    }
    return run(req, rc, exec, handler);
  };
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
