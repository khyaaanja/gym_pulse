# GymPulse — Full App Test Report (Chrome DevTools, localhost + LAN IP)

**Date:** 2026-10-02 · **Build under test:** production build, `next start` on port 3000 (Next 16.3.6), dev seed database
**Hosts:** `http://localhost:3000` and `http://192.168.100.77:3000`
**Browser:** real Google Chrome (`channel: "chrome"`, headless), driven through Playwright, instrumented over the Chrome DevTools Protocol (CDP sessions: `Network`, `Performance.getMetrics`, `Emulation.setCPUThrottlingRate`, console/exception/request-failure capture, PerformanceObserver for LCP/CLS).

## Verdict

On **localhost**, the app works end to end. Every role's pages load with no runtime errors. Authorization holds across all 186 API handlers, tenants are isolated, and the money flows are idempotent.

On the **LAN IP**, the app is **broken for day-to-day staff work**. Any page with a form dialog crashes ("This page couldn't load"), including members, member detail, bookings, settings, security, every super-admin console page, and the vendor portal. The cause is a single line of code (finding #1).

Seven defects were confirmed with reproductions. Severity: 1 critical, 3 medium, 3 low.

---

## Findings (confirmed, ranked)

### 1. CRITICAL: every page with a form dialog crashes when the app is opened by IP address
- **Where:** `src/components/ui/form-dialog.tsx:44` (also `:47`, `:73`), `useState(() => crypto.randomUUID())`.
- **Why:** `crypto.randomUUID` only exists in a *secure context* (https, or `localhost`). Over `http://192.168.100.77:3000`, `window.isSecureContext === false`, so it is `undefined`. The render throws and the whole route falls to the error boundary. This was verified in the browser: `{"secure":false,"clipboard":"undefined","randomUUID":"undefined","getRandomValues":"function"}`.
- **Blast radius (crawl):** 82 page visits crashed on IP vs **0** on localhost:
  - owner: `/app/announcements`, `/app/bookings`, `/app/marketplace`, `/app/members`, `/app/members/:id`, `/app/renew`, `/app/security`, `/app/settings`
  - manager: `/app/bookings`, `/app/marketplace`, `/app/members`, `/app/members/:id`, `/app/security`
  - staff: `/app/members`, `/app/members/:id`, `/app/security`
  - trainer: `/app/bookings`, `/app/security`
  - member: `/app/security`
  - vendor: `/vendor`
  - super-admin: 17 console pages (gyms, gym detail, subscriptions, plans, automations, notifications, marketplace, vendors, payments, content, announcements, prediction, security, system, settings, support tickets)
- **UI flows on IP:** add member, edit member, add plan, new announcement and invite-to-app all fail (`flows`: 25/35 on IP).
- **Fix:** `crypto.getRandomValues` *is* available in insecure contexts. Add a helper such as `randomId()` that falls back to it, and use it in all three call sites. The long-term answer is HTTPS on the LAN (e.g. `next dev --experimental-https` or a local reverse proxy). Without it, push notifications, the service worker, camera QR scanning (`BarcodeDetector`) and clipboard copy also stay unavailable.
- Screenshots: `screenshots/ip-members-page-crash.png`, `screenshots/ip-add-member-crash.png`.

### 2. MEDIUM: recording a desk payment can fail with HTTP 500 when the DB is slow (5 s Prisma transaction timeout)
- **Repro:** `POST /api/gym/payments/manual` (CASH, full price) returned **500 after 7.9 s**. The server log shows `Transaction API error: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6383 ms passed` (requestId `0ed11e1f-98ea-487c-a27b-3c0a4c5611bb`, and earlier `2a0b0879-…` at `prisma.ledgerEntry.createMany`).
- **What the user sees:** the dialog sits on "Saving…" and then shows the generic "Something went wrong". The payment row is left as `FAILED`. Data stays consistent: no membership extension and no double charge. But the cash was taken and the desk has to retry.
- **Root cause / context:** `confirmPayment` → `fulfil()` runs about 10 queries inside a default 5 s interactive transaction. On this machine the host was swapping (2.3 GB swap used, swap disk at 100 % util, 80 ms reads), and even `CREATE TEMP TABLE` took 6.2 s. So the trigger here is environmental. The defect is that there is no headroom: a slow DB turns money operations into 500s.
- **Fix:** pass `{ timeout: 15000, maxWait: 5000 }` to the payment `$transaction` calls in `src/services/payments/service.ts` (lines 67, 221, 271, 419), and retry the confirmation once on `P2028`/expired-transaction.
- Re-tested when the machine was calmer: UI double-click on *Record payment* sent **exactly one** POST, which returned 200 in 4.2 s with "Payment recorded and membership renewed". The member left the due list and the new membership was chained correctly (10-02 → 10-31).

### 3. MEDIUM: Renew page silently hides due members (shows 60 of 83)
- **Where:** `src/components/app/staff-renew.tsx:23`, `take: 60`. The header prints `due.length` ("60 members"), and there is no pagination or "showing 60 of N".
- **Evidence:** SQL count of due, un-renewed, non-archived Pulse Fitness memberships = **83**. The page shows **60 members**. Twenty-three members never appear on the desk's renewal list. Also, `take` is applied *before* the "already renewed" filter, so the visible count can drop further.
- **Fix:** paginate or raise the cap, and show the true total (`count()` query).
- The same `take: N` + `.length` pattern appears on `/super-admin/gyms` (`take: 100`). Not verified there: only a few gyms are seeded.

### 4. MEDIUM: invite links created while using the LAN IP point to `http://localhost:3000`
- **Where:** `src/services/invites.ts:20`, ``${process.env.APP_URL}/invite/${token}``. Same pattern in `src/app/api/auth/password/forgot/route.ts:21` (reset links) and `src/services/automation.ts:188` (renewal reminder links).
- **Evidence:** owner on `192.168.100.77` → *Invite to app* → link = `http://localhost:3000/invite/o8U2…`. A member's phone cannot open that. The kiosk QR already does this correctly via `requestOrigin(req)`; it returned `http://192.168.100.77:3000/checkin/…`.
- **Note:** in production, `APP_URL` is the real https domain, so this only bites LAN/dev use. Decide whether LAN use is a supported mode. If it is, use the request origin for links shown in the UI.

### 5. LOW (security hardening): the "production refuses to start without a proxy" guard never fires
- **Where:** `src/config/env.ts:21` defaults `TRUSTED_PROXY_HOPS` to `1`, and `:54` only rejects `< 1`. `src/lib/client-ip.ts:16` also clamps to ≥ 1.
- **Evidence (LAN IP, direct to `next start`):** wrong passwords against a QA account:
  - with no `X-Forwarded-For`: `401×5, 429, 429` (throttled correctly);
  - with a **rotating spoofed** `X-Forwarded-For`: **12× 401, never throttled**.
  - The per-account ceiling (50 per 15 min) still applies.
- **Impact:** if the app is ever exposed without a reverse proxy, the per-IP limits are bypassable. The comment in `client-ip.ts:10` claims a protection the config check can't provide. Consider requiring an explicit `TRUSTED_PROXY_HOPS` in production, or `0` = "no proxy, ignore XFF".

### 6. LOW: copy-to-clipboard buttons fail silently or claim false success
- **Where:** `src/components/app/invite-button.tsx:27`, `src/components/app/settings-widgets.tsx:15`, `void navigator.clipboard.writeText(...); toast.success(...)`.
- Over the IP, `navigator.clipboard` is `undefined`, so the click throws a TypeError and no toast appears. When the write is *denied* (seen in headless Chrome: `Write permission denied`), the promise rejects unhandled, **but "Link copied" is still shown**.
- **Fix:** `await` it inside try/catch, and fall back to selecting the text plus a "Press Ctrl+C" hint.

### 7. LOW: currency and receipt cosmetics
- The gym currency renders as **"NPR (₹)"** and prices as **₹1,500** across the owner app, member app and test gateway. `₹` is the Indian-rupee sign; the super-admin payments page uses **"Rs. 1,500"**. Pick one (`Rs.`/`रु`) for the Nepal market.
- A receipt dated **"2 October 2026"** (Kathmandu time) is numbered `R261001-…` (UTC date). Generate the number from the gym-timezone date.

### Observations (not defects, or by design)
- No `Content-Security-Policy` header on pages (only `/sw.js` has one). The other headers are good: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`. Adding a CSP is worthwhile hardening.
- On the IP, Chrome logs "Cross-Origin-Opener-Policy header has been ignored… untrustworthy origin" on every page (346/346). This is expected over plain http and harmless.
- `/app`, `/app/members`, `/vendor` → `/login` redirects drop the destination. Only `/checkin/*` keeps `?next=`, so after login, users land on `/app` instead of where they were going.
- The trainer sees the due-for-renewal list (scoped to their members) on `/app/renew`. Payment controls are permission-gated. This matches the role design.
- Validation messages on dialogs don't name the field (e.g. "Too big: expected number to be <=100" for *Sort order*).
- Member attendance page logs `THREE.Clock: This module has been deprecated` (three.js) and a WebGL "GPU stall due to ReadPixels" perf warning.
- Tampered kiosk QR token → "This QR code has expired" (an "invalid" message would be more accurate).

---

## What was tested (and how)

| # | Area | Method | localhost | LAN IP |
|---|---|---|---|---|
| 1 | **Page crawl**: every reachable page for 8 identities (anon, owner, manager, staff, trainer, member, vendor, super-admin), desktop 1366×800 + phone 390×844 | Chrome + CDP: console errors, uncaught exceptions, 4xx/5xx, failed requests, visible error text, horizontal overflow, nested `<a>`, unlabeled inputs, `<img>` without alt, empty buttons/links, duplicate ids, CDP perf metrics, screenshot per page | 356 visits / 61 routes, **0 exceptions** | 346 visits / 61 routes, **82 crashes (#1)** |
| 2 | **API authorization sweep**: all **186** route handlers, enumerated from source, with each route's declared permission parsed and compared with live responses | 11 identities × 186 handlers = **1,515 requests per host**; mutations only sent where refusal was expected | **0 violations** | **0 violations** |
| 3 | **CSRF**: foreign `Origin`, and `Sec-Fetch-Site: cross-site` without Origin, on 4 mutating endpoints with a valid owner session | | all 403 | — |
| 4 | **Cross-tenant / IDOR**: Yoga Nest owner reads/writes/deletes Pulse Fitness members, plans, bookings, locations, products, staff, recovery, predictions, orders, imports, announcements; invite/check-in/payment for a foreign member; `gymId` mass-assignment; switch-gym into a foreign gym; member opens another member's receipt / pays another member's order (also with **valid** bodies) | | **37/37 pass** | **38/38 pass** |
| 5 | **UI flows** (37 steps): login errors, no account enumeration, forgot/reset password, signup (weak password, success, duplicate email), add/edit member, XSS in member name, search, check-in desk, plan, negative price, announcement, record payment, invite + copy, kiosk, CSV export, Ctrl+K search, sign-out invalidates session, trainer blocked from owner pages, member pass/renew, member blocked from staff API | | **34/37**: the 3 failures were rate-limit 429 from repeated runs (correct behaviour) + headless clipboard denial (#6) | **25/35**: every failure is #1 |
| 6 | **Money**: manual payment, double-click idempotency, member online renewal → sandbox approve → receipt; renewal chaining | | ✅ one POST per double-click; ⚠ #2 under load | ✅ sandbox return stays on IP host |
| 7 | **Kiosk QR check-in**: owner token → member scans → repeat scan → tampered token → desk sees check-in | | ✅ | ✅ |
| 8 | **Invite → member account**: create invite, open link in a fresh phone browser, set password, land in member app; token single-use | | ✅ (token 404 after use) | ✅ / ⚠ link host (#4) |
| 9 | **Marketplace**: vendor UI creates listing → super-admin approves → gym API + member marketplace show it; vendor listing into an **unlinked** gym; negative price/stock | | ✅ / 403 / 400 | — |
| 10 | **Brute force**: per address+account throttle, XFF spoofing | | — | ✅ / ⚠ #5 |
| 11 | **Hydration race**: type before hydration at 1× and 6× CPU throttle (CDP `Emulation.setCPUThrottlingRate`), form state after a 400 | | ✅ values kept | ✅ values kept |
| 12 | **Performance** (fresh tab per page, PerformanceObserver) | | LCP 112–1,308 ms, CLS ≤ 0.001, DOM 256–1,456 nodes, heap 5–9 MB; load p50 150 ms / p90 289 ms | load p50 147 ms / p90 349 ms |
| 13 | **Project suites** | `vitest run`, `tsc --noEmit`, `eslint src` | 98/98 tests ✅ · tsc clean ✅ · eslint 0 errors, 9 `<img>` warnings | — |

**Note:** none of the 98 unit tests catch #1 (browser secure context), #2 (tx timeout under load) or #3 (list truncation).

---

## Corrections to my own interim results (for honesty)
- My crawl first reported 30k+ DOM nodes and 200 MB heaps. That was cumulative CDP counters across navigations. Fresh-tab measurement shows 256–1,456 nodes and 5–9 MB (row 12).
- Localhost transfer sizes initially looked 5× larger than on IP. That was a measurement artifact: `curl` shows identical gzip responses (53,477 B for `/login`) on both hosts.
- One localhost flow run was contaminated by a ~1-minute server stall (signup and owner login hit 30 s timeouts). It was re-run cleanly. In that run, the "duplicate email accepted" result was a false alarm: the first signup never completed. On the clean IP run, duplicates return `409`.
- Seen once, not reproduced: the signup form fields cleared between attempts during the stall.
- Harness bugs I fixed along the way: a check-in locator hit the sidebar search button; a JSON body truncation emptied ID lists; the plan dialog needed its tab opened first.

## Not tested / blocked
- **MFA enrolment and verification flows** (TOTP). `ALLOW_ADMIN_WITHOUT_MFA=true` in this env, and no seeded user has MFA.
- **Real payment providers** (eSewa/Khalti webhooks with real signatures). Only the sandbox gateway was exercised. Webhook endpoints were probed only for auth.
- **Record-sheet imports** (upload → OCR → mapping → commit). Pages load without errors, but no file was uploaded in this pass. Prior evidence is in `documents/health-check-proof/`.
- **Email/SMS delivery** (console transport), **push notifications** (impossible over the http IP; not tried on localhost).
- **Super-admin write actions** (suspend gym, refunds, admin creation). Only the read/permission side was covered, plus listing approval.
- **Other browsers** (Firefox/Safari) and **real phones** on the LAN. Phone coverage was Chrome mobile emulation.
- The dev server on :3100 was not tested; only the production build on :3000.

## Test data left in the dev database
All test data is prefixed `QA`: QA gyms from signup (`qa-L…@qa.demo`, `qa-IP…@qa.demo`), QA members and invitees, a QA announcement, a "QA Whey" marketplace listing (approved), and one CASH renewal for **Rohit Ghimire**. There are also two sandbox renewals for **Aarav Shrestha** (the member demo account; membership now runs to 2026-12-31), 2 `FAILED` CASH payments from finding #2, and 4 `PENDING` sandbox payments that the stale-payment job will expire. Nothing was deleted. Tell me if you want it cleaned up.

## Files
- `scripts/`: every test script used (re-runnable: `node crawl.mjs <host>`, `node api-sweep.mjs <host>`, `node flows.mjs <host>`, `node tenant.mjs <host>`, …; run from a folder with `node_modules` linked).
- `results/<host>/`: raw JSON (`crawl.json`, `api-sweep.json` with the full status matrix, `tenant.json`, `flows.json`) and logs (vitest/tsc/eslint).
- `screenshots/`: key evidence.
