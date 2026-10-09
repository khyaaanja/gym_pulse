# GymPulse: Go-Live Runbook

*Written 2026-10-08 against commit `1d7f767` plus the uncommitted Safari fix in `gym-scene.tsx`.*

This is the single ordered list of **everything still left** before GymPulse can take real gyms and real money.
Work through it top to bottom. Each step says **why** it matters, **exactly what to do**, and **how to prove it is done**.

Legend:
- 🔴 **Blocker.** Do not launch without it.
- 🟠 **Before real customers.** Do it before the first paying gym.
- 🟡 **Before scaling.** Can wait a few weeks, but not forever.
- ✅ **Verified today** means I ran the command on 2026-10-08 and saw the result.
- ⚠️ **UNVERIFIED** means the instructions are correct to the best of my knowledge but have never been run in this repo.

Companion document: `documents/production-and-cicd-guide.md` has the full GitHub Actions YAML (`ci.yml`, `deploy.yml`),
Dependabot config, CODEOWNERS, and the migration/rollback rules. This runbook points to it rather than copying it.

---

## 0. Where things stand today (verified)

| Check | Command | Result on 2026-10-08 |
|---|---|---|
| Types | `npm run typecheck` | ✅ clean (app + e2e) |
| Lint | `npm run lint` | ✅ 0 errors, 37 warnings |
| Unit/integration tests | `npm test` | ✅ **486 / 486 passed** (103 s, real Postgres) |
| Dependency vulnerabilities | `npm audit --omit=dev` | ❌ **7 high**: `next`, `sharp`, `source-map-js`, and `prisma`→`mysql2` chain |
| Git remote | `git remote -v` | ❌ none |
| Working tree | `git status` | ❌ 1 modified + 25 untracked files |
| `.env.example` | `ls .env.example` | ❌ missing (`.gitignore` already allows it) |
| Production bootstrap (first admin, SaaS plans) | read `prisma/seed.ts` | ❌ **no way to do it**: see step 1.4 |
| Docker | `which docker` | not installed on this machine, so no Dockerfile has been built here |

QA report `documents/qa-2026-10-02/QA-TEST-REPORT.md`: I re-checked every finding against the current code.

| # | Finding | Status today |
|---|---|---|
| 1 | Form dialogs crash over plain-HTTP IP (`crypto.randomUUID`) | ✅ fixed (no `randomUUID` left in `.tsx`; `src/lib/uuid.ts` exists) |
| 2 | Desk payment 500s when DB is slow (5 s transaction timeout) | ❌ **open**: the 4 `$transaction` calls in `src/services/payments/service.ts` (lines 69, 223, 273, 423) pass no timeout |
| 3 | Renew page silently shows only 60 due members | ❌ **open**: `src/components/app/staff-renew.tsx:23` still `take: 60`, header still prints `due.length` |
| 4 | Invite/reset links use `APP_URL` even on LAN | ⚪ fine in production (APP_URL is the real domain); only matters for LAN installs |
| 5 | `TRUSTED_PROXY_HOPS` guard can never fire | ❌ **open**: default is `1` and `client-ip.ts:16` clamps to ≥ 1 |
| 6 | Copy buttons claim false success | ✅ fixed (`src/components/app/copy-button.tsx` awaits inside try/catch) |
| 7 | Receipt number uses UTC date, currency shows ₹ | ◐ currency is now selectable per gym in Settings; **receipt number still UTC** (`service.ts:294–296`) |

---

## Phase 1: Code changes in the repo

> **Status on 2026-10-09:** done on branch `chore/go-live`, except where marked.
>
> | Step | State |
> |---|---|
> | 1.1 commit + clean tree | ✅ scratch files moved to `~/gympulse-notes/` |
> | 1.2 dependencies | ✅ next 16.4.0, sharp 0.35.5. The 4 Prisma-chain advisories remain (accepted; waiting for upstream) |
> | 1.3 `.env.example` | ✅ comments on their own lines |
> | 1.4 bootstrap | ✅ see below |
> | 1.5 money transaction headroom | ✅ all 7 money transactions use `MONEY_TX` (15 s) |
> | 1.6 Renew page | ✅ filtering happens in the query, the header shows the true total; the owner dashboard's expiring list uses the same rule |
> | 1.7 proxy guard | ✅ production requires an explicit `TRUSTED_PROXY_HOPS`; `0` = no proxy (local development only) |
> | 1.8 gym-local dates | ✅ receipt and order numbers, the receipt page, gym pages and CSV exports (both the date window and the printed dates). Super-admin pages still show the server's time zone |
> | 1.9 e2e | ✅ headless, credentials from `E2E_OWNER_PASSWORD`, 4/4 passing locally |
> | 1.10 runtime deps | ✅ `tsx`, `dotenv` in dependencies |
> | 1.11 OCR data | ⏳ **your decision**: launch with `OCR_PROVIDER=none`, or bundle `eng.traineddata` |
> | 1.12 key rotation script | ⏳ not started (🟡, before scaling) |
> | 1.13 error webhook | ✅ sends `text`/`content`; a rejected webhook is logged |
> | 1.14 push | ⏳ needs the GitHub remote (Phase 2.1) |

Do all of Phase 1 on your laptop. After each step run:
```bash
npm run typecheck && npm run lint && npm test
```
Only move on when it's green.

### 1.1 🔴 Commit the Safari fix and clean the working tree

**Why:** you can't deploy what isn't committed, and the CI pipeline only sees git.

```bash
cd ~/gym
git switch -c chore/go-live                       # work on a branch, not master
git add src/components/three/gym-scene.tsx
git commit -m "Recover Safari video loop stalls without refetching"
```

Then decide about each untracked file:

| Keep and commit | Delete or move out of the repo |
|---|---|
| `documents/production-and-cicd-guide.md`, `documents/GO-LIVE-RUNBOOK.md` (this file) | `demo-tmp.mjs`, `measure-trace.mjs` (scratch scripts) |
| `documents/growth-and-diet-features.md`, `documents/qa-2026-10-02/` (if you want the history) | `PRODUCTION_GUIDE.md`: **wrong for this app** (mentions Clerk, Sentry, Vercel) |
| | `ANIMATION_*`, `GYMPULSE_*`, `SOLUTION_SUMMARY.md`, `*-sales-*`, `pack*`, `three-gym-owners-report.md`, `sample-homepage-content.json`: sales/notes, move to a separate folder outside the repo |
| | `e2e/import-*.test.ts` (6 scratch tests): delete, or finish them in step 1.9 |

```bash
mkdir -p ~/gympulse-notes
mv ANIMATION_*.md GYMPULSE_*.md SOLUTION_SUMMARY.md gympulse-*.md pack*.md \
   three-gym-owners-report.md sample-homepage-content.json ~/gympulse-notes/
mv PRODUCTION_GUIDE.md demo-tmp.mjs measure-trace.mjs ~/gympulse-notes/   # untracked: rm would be unrecoverable
git add documents/
git commit -m "Add go-live runbook and CI/CD guide"
git status          # should list only the e2e/import-* files until step 1.9
```

**Done when:** `git status` is empty.

### 1.2 🔴 Fix the high-severity dependency vulnerabilities

**Why:** six of the `next` advisories affect *self-hosted* apps (cache poisoning, SSRF in image optimisation). That's exactly your setup.

```bash
npm install next@16.4.0 eslint-config-next@16.4.0
npm audit fix                                # sharp → 0.35.5+, source-map-js
npm audit --omit=dev                         # see what's left
npm run typecheck && npm run lint && npm test && npm run build
```

- `next` 16.3.6 → 16.4.0 is a minor bump, but `AGENTS.md` warns this Next.js has breaking changes. **Read the
  16.4 upgrade notes in `node_modules/next/dist/docs/` after installing**, then click through the landing page,
  login, owner dashboard, and member home in `npm run build && npm start` before committing.
- The remaining `prisma` → `@prisma/config` → `mysql2` / `deepmerge-ts` findings: npm's only offer is a
  **downgrade to Prisma 6. Do not accept it.** `mysql2` is only pulled in by Prisma's tooling, and this app talks
  to Postgres. Record it as an accepted risk and take the Prisma 7 patch when Dependabot opens it.

**Done when:** `npm audit --omit=dev` lists only the Prisma-chain items, and tests and build are green.

### 1.3 🔴 Add `.env.example`

**Why:** whoever sets up the server (future you) needs the list of variables, without any real values.

Create `.env.example` in the repo root:
```bash
# ── Core ─────────────────────────────────────────────
APP_ENV=development                 # development | test | staging | production
APP_URL=http://localhost:3000       # production: https://your-domain (http is refused)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gympulse
TEST_DB_SCHEMA=gympulse_test         # tests run in this schema of DATABASE_URL (tests/setup/env.ts)
DB_POOL_SIZE=10

# ── Secrets: generate fresh per environment, never reuse ──
DATA_ENCRYPTION_KEY=                # openssl rand -base64 32
FILE_ENCRYPTION_KEY=                # openssl rand -base64 32
SIGNING_SECRET=                     # openssl rand -base64 48

# ── Files / worker ───────────────────────────────────
STORAGE_DIR=./.storage
RUN_WORKER_IN_PROCESS=false
WORKER_CONCURRENCY=2
MAX_UPLOAD_MB=10
OCR_PROVIDER=none                   # tesseract | none
TESSERACT_LANG_PATH=
CLAMAV_HOST=
CLAMAV_PORT=3310

# ── Security switches ────────────────────────────────
ALLOW_ADMIN_WITHOUT_MFA=false       # must be false in production
ENABLE_TEST_GATEWAY=false           # must be false in production
TRUSTED_PROXY_HOPS=1                # number of reverse proxies in front

# ── Email / push / login ─────────────────────────────
EMAIL_TRANSPORT=none                # smtp | console | none (console refused in production)
SMTP_URL=                           # smtps://user:pass@smtp.provider.com:465
EMAIL_FROM="GymPulse <no-reply@your-domain>"
VAPID_PUBLIC_KEY=                   # npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@your-domain
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ── Ops ──────────────────────────────────────────────
# ERROR_WEBHOOK_URL=https://...     # leave commented when unused: an empty value fails the URL check and the app won't boot
LOG_LEVEL=info
```
**Leave optional URL variables out entirely rather than empty.** `ERROR_WEBHOOK_URL=` (empty) fails
`z.string().url()` in `env.ts:37`, and `src/instrumentation.ts` calls `env()` at boot, so the server refuses to start.

This list covers every variable in `src/config/env.ts`, plus the four read directly elsewhere
(`DB_POOL_SIZE`, `WORKER_CONCURRENCY`, `TEST_DB_SCHEMA`, `SEED_DEMO_PASSWORD`). I left `SEED_DEMO_PASSWORD`
out on purpose because it is demo-only.

**Done when:** `git add .env.example && git commit -m "Add .env.example"`, and `git show --stat HEAD` shows it.

### 1.4 🔴 Production bootstrap script (first admin + platform data) ✅ done

**Why it was needed:** on a fresh production database the demo seed refuses to run, and the only way to create a
platform admin was an endpoint that needs an admin who is already signed in. The SaaS plans, notification templates,
automation rules and legal content were also created only by the demo seed.

**What exists now:**
- `prisma/reference-data.ts`: the platform reference data, shared by the demo seed and the bootstrap. It has no demo
  admins and no test gateway.
- `npm run db:bootstrap` (`prisma/bootstrap.ts`) takes `BOOTSTRAP_SUPPORT_EMAIL`, `BOOTSTRAP_ADMIN_EMAIL` and
  `BOOTSTRAP_ADMIN_PASSWORD`, and refuses placeholder addresses and passwords under 16 characters.
  - The first run writes the reference data **once** and creates the first SUPER_ADMIN, who must reset the password
    and enrol MFA at first sign-in.
  - Later runs need none of the variables and change nothing. They never re-create a row a super-admin deleted, and
    never overwrite one they edited.
  - It runs under an advisory lock, so two runs at the same time still produce exactly one admin.
- The demo seed (`npm run db:seed`) now runs **only** with `APP_ENV=development` or `test`, so staging can't get
  demo admins either.
- Tests: `tests/bootstrap.test.ts` (fresh schema built from the migrations; race, idempotency, deletions, validation).

### 1.5 🔴 Payment transactions: give them headroom (QA #2)

**Why:** a slow database moment turns "record cash payment" into a 500 while the member stands at the desk.

In `src/services/payments/service.ts`, pass options to each of the four interactive transactions
(currently at lines 69, 223, 273 and 423):
```ts
const PAYMENT_TX = { timeout: 15_000, maxWait: 5_000 } as const;
// ...
const payment = await prisma.$transaction(async (tx) => { ... }, PAYMENT_TX);
```
Then **grep for siblings**. Any other money path using `$transaction` without options needs the same:
```bash
grep -rn '\$transaction(async' src/services src/app/api | grep -v PAYMENT_TX
```
(billing, marketplace orders, refunds, `platform-finance.ts`.) Apply the constant to every money-moving one.

**Proof:** add a test that runs `confirmPayment` with a `tx` that sleeps 6 s (e.g. `await tx.$executeRaw\`SELECT pg_sleep(6)\``
in a test-only hook) and asserts it succeeds. Before the change it should fail with the "expired transaction" error.

### 1.6 🟠 Renew page shows everyone who is due (QA #3)

**Why:** right now 23 of 83 due members never appear on the desk's renewal list. That's lost revenue.

In `src/components/app/staff-renew.tsx`:
- Remove `take: 60` (the window is already bounded to ~14 days + grace), **or** keep a cap but add a
  `ctx.db.membership.count({ where: <same where> })` and print "Showing 60 of N" with a link to the full list.
- Apply the "already renewed" filter **in the query** (`NOT: { member: { memberships: { some: { startDate: { gt: today } } } } }`)
  instead of after `take`, so the cap can't hide rows.

**Proof:** a test that seeds 83 due memberships and asserts the page data contains 83 (or shows "60 of 83").

### 1.7 🟠 Make the reverse-proxy guard real (QA #5)

**Why:** if the app is ever reachable without a proxy (wrong firewall rule, platform change), anyone can spoof
`X-Forwarded-For` and bypass every per-IP login limit. Today the "production refuses to start" check can't fire.

- `src/config/env.ts`: in production, require `TRUSTED_PROXY_HOPS` to be **explicitly set** (check
  `process.env.TRUSTED_PROXY_HOPS !== undefined` before applying the default) and throw if it's missing.
- Allow `0` to mean "no proxy, ignore X-Forwarded-For entirely", and make `src/lib/client-ip.ts:16` honour 0
  (return `null` → fall back to account-keyed limits) instead of clamping to 1. Keep refusing `0` in production.

**Proof:** a unit test for `env()` with `APP_ENV=production` and no `TRUSTED_PROXY_HOPS` → throws; and a
`clientIp` test with hops = 2 and a spoofed left-most entry → returns the second-from-right address.

### 1.8 🟡 Receipt numbers in gym time (QA #7)

`receiptNumber()` at `src/services/payments/service.ts:294` uses `toISOString()` (UTC). A payment at 05:00 in
Kathmandu gets yesterday's date. Format the date with the gym's timezone (`formatInTimeZone` from `date-fns-tz`,
already a dependency). Proof: a test with `paidAt = 2026-10-01T20:00:00Z` and timezone `Asia/Kathmandu` → `R261002-…`.

### 1.9 🔴 Make the browser (e2e) tests CI-ready

**Why:** CI machines have no screen and no Google Chrome, and passwords don't belong in source.

1. `playwright.config.ts` lines 16–17: remove `channel: 'chrome'` and set `headless: true`
   (or `headless: !!process.env.CI` if you like watching it locally).
2. Three files hardcode `GymPulse!Demo2026`:
   `e2e/owner-login.test.ts`, `e2e/owner-dashboard-v2.test.ts`, `e2e/owner-dashboard-comprehensive.test.ts`.
   Replace with:
   ```ts
   const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@pulsefitness.demo";
   const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD!;
   if (!OWNER_PASSWORD) throw new Error("Set E2E_OWNER_PASSWORD");
   ```
3. The six untracked `e2e/import-*.test.ts`: either finish **one** solid import test (upload CSV → map → commit →
   member appears) and delete the rest, or delete all six. Don't commit flaky tests.
4. Run locally against a seeded dev DB:
   ```bash
   npm run build && npm start &
   E2E_OWNER_PASSWORD='GymPulse!Demo2026' npx playwright test
   ```

**Done when:** `npx playwright test` is green headless, and `grep -rn "Demo2026" e2e` returns nothing.

### 1.10 🔴 Worker must run from the production image

`npm run worker` uses `tsx` (`package.json:78`), and both the worker (`src/workers/index.ts:2`) and the Prisma CLI
config (`prisma.config.ts:3`) import `dotenv` (`package.json:71`). **Both are devDependencies.** If the image is ever
pruned of dev dependencies, the worker and `db:migrate` stop working. Either:
- move `tsx` **and** `dotenv` to `dependencies` (`npm install --save tsx dotenv`), **or**
- don't prune dev dependencies in the image (the Dockerfile in Phase 4 doesn't prune, so it works as written).

Moving both is the safer choice.

### 1.11 🟠 OCR language data (only if you enable OCR imports)

With `OCR_PROVIDER=tesseract` and no `TESSERACT_LANG_PATH`, `tesseract.js` downloads `eng.traineddata` from a
public CDN at runtime. In production that's a third-party dependency on every import. Download the file once,
commit it under `ocr/` (about 4 MB for `eng.traineddata` fast), and set `TESSERACT_LANG_PATH=/app/ocr` in production.
If you don't offer photo/PDF imports at launch, set `OCR_PROVIDER=none` and skip this.

### 1.12 🟡 Encryption-key rotation script

`DATA_ENCRYPTION_KEY` and `FILE_ENCRYPTION_KEY` encrypt data at rest. There's **no tool to rotate them**. If one
leaks, you'd have to write it under pressure. Before you have many customers, write `scripts/rotate-keys.ts` that
decrypts with the old key and re-encrypts with the new one, in batches, resumably. Test it on a copy of staging.

### 1.13 🟠 Make error alerts reach Slack/Discord

`reportError` in `src/lib/logger.ts:37` posts `{msg, meta, env, at}`. Slack needs a `text` field and Discord needs
`content`, so both reject that body, and the logger ignores the response. Add `text: msg` and `content: msg` to the
JSON body (or format per provider), and add a test that stubs `fetch` and asserts the body has them. Until then,
point `ERROR_WEBHOOK_URL` at an endpoint that accepts arbitrary JSON.

### 1.14 Push the branch

```bash
git push -u origin chore/go-live     # after Phase 2.1 creates the remote
```
Open a PR, let CI run (Phase 2), and merge to `main`.

---

## Phase 2: GitHub and CI

### 2.1 🔴 Create the private repository and push

```bash
gh auth login                                   # once
gh repo create gympulse --private --source . --remote origin
git branch -M master main                       # standardise on "main"
git push -u origin main
```

### 2.2 🔴 Repository settings

Follow **`production-and-cicd-guide.md` → Part 3, Step 1** exactly: branch ruleset on `main` (PR + green checks
required, no force pushes, no bypass), secret scanning + push protection, Dependabot, read-only Actions token,
`staging` and `production` environments (production requires your approval).

### 2.3 🔴 Add CI

Copy `ci.yml` from **guide Part 3, Step 3** to `.github/workflows/ci.yml`, plus `dependabot.yml` and `CODEOWNERS`
(guide Step 7). Notes for this repo:
- The `e2e` job needs step 1.9 done first.
- The `security` job's `npm audit --audit-level=high` will fail on the Prisma chain (step 1.2). Add
  `continue-on-error: true` **to that one step only**, with a comment linking the advisory, and remove it when
  Prisma ships the fix.
- ⚠️ **UNVERIFIED:** whether `npm run build` needs any env var beyond those the job sets. The first CI run will tell
  you. Fix and re-push.

**Done when:** a PR shows green `verify`, `e2e` and `security` checks, and those three are set as required in the ruleset.

---

## Phase 3: Infrastructure (accounts and machines)

### 3.1 🔴 Choose hosting: a server with a disk, not serverless

The app writes encrypted uploads to local disk (`STORAGE_DIR`), runs a long-lived background worker, and uses
native modules (`sharp`, `@node-rs/argon2`, Tesseract). That rules out Vercel-style serverless functions.

Recommended for launch: **one VPS** (2 vCPU / 4 GB RAM minimum; Hetzner, DigitalOcean, Linode) running Docker,
plus **managed Postgres** from the same provider/region. Create **two** of everything: `staging` and `production`.

### 3.2 🔴 Domain and DNS

- Buy the domain. Create `A` records: `app.your-domain` → production VPS IP, `staging.your-domain` → staging VPS IP.
- Keep DNS TTL at 300 s until launch so mistakes are quick to fix.

### 3.3 🔴 Harden the server (one-time, per VPS)

```bash
# as root, once
adduser --disabled-password deploy
usermod -aG docker deploy
mkdir -p /srv/gympulse && chown deploy:deploy /srv/gympulse
# SSH: key only, no root login
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
# Firewall: only SSH + web
ufw default deny incoming && ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
# Automatic security updates
apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
# Docker
curl -fsSL https://get.docker.com | sh
```
Make sure you can log in as `deploy` with your SSH key **before** you close the root session.

### 3.4 🔴 Managed Postgres

- Postgres 16 or 17. Enable **automated daily backups** and **point-in-time recovery**.
- Confirm the provider allows the `pg_trgm` extension (used by migration `20260924105454_constraints_and_search`).
- Restrict access to the VPS's private IP only. Postgres must **never** be reachable from the internet.
- `DATABASE_URL` must end with `?sslmode=require`. **TLS gotcha:** the installed `pg` driver
  (`pg-connection-string` 2.14) treats `require` like `verify-full`, so the app's connection (`src/db/client.ts`)
  **rejects a certificate signed by the provider's private CA**. Migrations still succeed (Prisma's own engine), but
  `/api/health` returns 503. If your provider uses a private CA (DigitalOcean, AWS RDS and others do), download its CA
  certificate, put it on the server (e.g. `/srv/gympulse/db-ca.crt`), mount it into `web` and `worker`, and set
  `NODE_EXTRA_CA_CERTS=/certs/db-ca.crt` (compose snippet in 4.3). Never "fix" this with `rejectUnauthorized: false`.
  Also use the provider's **private hostname** (the name on its certificate) in `DATABASE_URL`, not a raw IP:
  `verify-full` checks the hostname too, so a bare IP fails even with the right CA.
- Connection budget: `(web instances + worker) × DB_POOL_SIZE` must stay below the plan's connection limit.
  With 1 web + 1 worker and `DB_POOL_SIZE=10`, you need ≥ 25 connections (leave headroom for migrations/psql).

### 3.5 🔴 Prove you can restore

A backup you have never restored hasn't been proven to work. Before launch:
1. Put a few rows in staging. Take a backup (or note a PITR timestamp).
2. Restore it into a **new** database. Point a local app at it and log in.
3. Write down the exact steps and how long they took in this file, under **Phase 7.4**.

### 3.6 🔴 Uploaded-file backups

`STORAGE_DIR` (the Docker volume `storage`) holds encrypted member files. Back it up on the same schedule as the DB,
e.g. nightly `restic` or `rclone` to object storage (Backblaze B2 / S3), with 30-day retention. The files are
already encrypted with `FILE_ENCRYPTION_KEY`, so the backup is useless without that key, and the key must not
live in the same place as the backup.

### 3.7 🟠 Email, SMS, payments, push: real accounts

| Service | What to set up | Where it's configured |
|---|---|---|
| Email (SMTP) | Postmark / Amazon SES / Brevo. Verify your domain (SPF, DKIM, DMARC records) | `EMAIL_TRANSPORT=smtp`, `SMTP_URL`, `EMAIL_FROM` |
| SMS | Sparrow SMS and/or Aakash SMS account; get token and sender ID | Platform-wide: **Super-admin → Notifications** (stored encrypted in DB) |
| eSewa | Merchant account; get `productCode` + `secretKey` | Enable it in **Super-admin → Payments**. Each gym then enters its own merchant credentials and picks SANDBOX/LIVE in **Settings → Payments** |
| Khalti | Merchant account; get live `secretKey` | Same as eSewa |
| Web Push | `npx web-push generate-vapid-keys` (once per environment) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Google sign-in (optional) | Google Cloud OAuth client; redirect URI `https://app.your-domain/api/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Errors | A webhook that accepts **any JSON** (see note below) | `ERROR_WEBHOOK_URL` |
| Uptime | UptimeRobot / Better Stack monitor on `https://app.your-domain/api/health` | their dashboard |

**Error webhook caveat:** `src/lib/logger.ts:37` posts `{"msg","meta","env","at"}`. Slack and Discord webhooks
**reject** that body (they need `text` / `content`), and the logger ignores the response, so nothing arrives and
nothing complains. Either change `reportError` to also send `text: msg` (Slack) / `content: msg` (Discord), with a test,
or point it at something that accepts arbitrary JSON (a small relay, Better Stack, a Zapier/Make hook).

Use **sandbox** credentials on staging (eSewa `rc-epay.esewa.com.np`, Khalti `dev.khalti.com`) and **live** ones only in production.

---

## Phase 4: Package the app

⚠️ **UNVERIFIED:** Docker isn't installed on the development machine, so none of these files have been built yet.
Build them on staging first.

### 4.1 `Dockerfile` (repo root)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# next.config.ts reads APP_ENV when it builds the header table: production adds HSTS.
# Build with the environment you deploy to, or the HSTS header is silently missing.
ARG APP_ENV=production
ENV APP_ENV=$APP_ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
# Prisma's migration engine needs libssl3, which the slim image may not include.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STORAGE_DIR=/data/storage
RUN groupadd --system app && useradd --system --gid app --home /app app \
 && mkdir -p /data/storage && chown app:app /data/storage
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
```

### 4.2 `.dockerignore` (repo root)

```
.git
.env
.env.*
!.env.example
node_modules
.next
.pgdata
.storage
.perf-tmp
playwright-report
test-results
documents
*.pdf
*.docx
*.zip
```
(Don't ignore `*.md` blindly: `public/models/README.md` is served from `public/`.)

### 4.3 Server files in `/srv/gympulse/` (not in git)

`docker-compose.yml`:
```yaml
services:
  web:
    image: gympulse:${TAG:-latest}
    env_file: .env.production
    environment: { RUN_WORKER_IN_PROCESS: "false" }
    volumes: ["storage:/data/storage"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped
  worker:
    image: gympulse:${TAG:-latest}
    command: ["npm", "run", "worker"]
    env_file: .env.production
    healthcheck: { disable: true }       # the image's HEALTHCHECK probes HTTP; the worker has no HTTP server
    volumes: ["storage:/data/storage"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data", "caddy_config:/config"]
    restart: unless-stopped
volumes: { storage: {}, caddy_data: {}, caddy_config: {} }
```

`Caddyfile` (Caddy gets and renews the HTTPS certificate automatically):
```
app.your-domain {
    encode zstd gzip
    reverse_proxy web:3000
}
```
Caddy is the only proxy, so `TRUSTED_PROXY_HOPS=1`. If you later put Cloudflare in front, **first** configure
Caddy's `trusted_proxies` with Cloudflare's IP ranges (by default Caddy ignores the incoming X-Forwarded-For), **then**
set `TRUSTED_PROXY_HOPS=2`. Setting it to 2 without the Caddy change makes every user's IP look like a Cloudflare IP.

**Per environment:** the site name in the `Caddyfile` and `APP_URL` must match that server: `staging.your-domain`
on staging, `app.your-domain` on production. DNS (step 3.2) must already point at the server **before** Caddy
starts, or it can't get a certificate.

If your database needs a private CA (step 3.4), add to both `web` and `worker`:
```yaml
    volumes: ["storage:/data/storage", "./db-ca.crt:/certs/db-ca.crt:ro"]
    environment: { NODE_EXTRA_CA_CERTS: /certs/db-ca.crt }     # merge with the existing environment block on web
```

`.env.production` (`chmod 600`, owned by `deploy`, **never in git**):
```bash
APP_ENV=production
APP_URL=https://app.your-domain
DATABASE_URL=postgresql://USER:PASS@PRIVATE-HOST:5432/gympulse?sslmode=require
DB_POOL_SIZE=10
DATA_ENCRYPTION_KEY=<openssl rand -base64 32>
FILE_ENCRYPTION_KEY=<openssl rand -base64 32>
SIGNING_SECRET=<openssl rand -base64 48>
STORAGE_DIR=/data/storage
RUN_WORKER_IN_PROCESS=false
WORKER_CONCURRENCY=2
ALLOW_ADMIN_WITHOUT_MFA=false
ENABLE_TEST_GATEWAY=false
TRUSTED_PROXY_HOPS=1
EMAIL_TRANSPORT=smtp
SMTP_URL=smtps://USER:PASS@smtp.provider.com:465
EMAIL_FROM="GymPulse <no-reply@your-domain>"
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:support@your-domain
OCR_PROVIDER=none
MAX_UPLOAD_MB=10
ERROR_WEBHOOK_URL=https://<endpoint that accepts any JSON, or Slack/Discord after step 1.13>
LOG_LEVEL=info
# Only for the first bootstrap run. Delete these three lines afterwards (step 5.4):
BOOTSTRAP_SUPPORT_EMAIL=support@your-domain
BOOTSTRAP_ADMIN_EMAIL=you@your-domain
BOOTSTRAP_ADMIN_PASSWORD=<long random one-time password, 16+ characters>
```

### 4.4 🔴 Generate and safeguard the keys

```bash
openssl rand -base64 32   # DATA_ENCRYPTION_KEY   (separate run for each)
openssl rand -base64 32   # FILE_ENCRYPTION_KEY
openssl rand -base64 48   # SIGNING_SECRET
```
- **Different keys for staging and production.** Never reuse the keys from your laptop's `.env`.
- Store every production key in a password manager (Bitwarden/1Password) **and** one offline copy.
  **If `DATA_ENCRYPTION_KEY` or `FILE_ENCRYPTION_KEY` is lost, encrypted member data can't be recovered.**

---

## Phase 5: First deploy (staging, then production)

Do this entire phase on **staging** first. Then repeat on production with production values.

### 5.1 Get the code onto the server and build

For the very first launch, building on the server is acceptable. Phase 6 moves this into CI.
```bash
ssh deploy@staging.your-domain
git clone git@github.com:<you>/gympulse.git ~/src && cd ~/src
git checkout main
docker build --build-arg APP_ENV=production -t gympulse:$(git rev-parse --short HEAD) -t gympulse:latest .
```
(On staging, `APP_ENV=staging` is also allowed by `env.ts`, but then the build has no HSTS. Building staging
with `production` mirrors prod exactly; your choice, just be consistent.)

### 5.2 Migrate the database

```bash
cd /srv/gympulse
docker compose run --rm web npm run db:migrate
```
Expected: "All migrations have been successfully applied". If `pg_trgm` errors, enable it in the provider's dashboard.
**Never run `npm run db:seed` here.** It refuses anything but `APP_ENV=development`/`test`, because the demo admins'
password is published in the repo.

### 5.3 Bootstrap platform data and the first admin (needs step 1.4)

```bash
docker compose run --rm web npm run db:bootstrap
```

### 5.4 Start everything and remove the bootstrap password

```bash
sed -i '/^BOOTSTRAP_/d' .env.production   # remove the one-time password BEFORE the long-running containers start
grep -c BOOTSTRAP_ .env.production              # must print 0
docker compose up -d
docker compose ps                       # web "healthy"; worker and caddy "running" (worker has no healthcheck)
docker compose logs --tail=50 web       # no "Invalid environment configuration"
docker compose logs --tail=50 worker    # no crash loop
```

### 5.5 Smoke test (by hand, about 20 minutes)

```bash
curl -sS https://staging.your-domain/api/health        # 200 with JSON, not 503
curl -sSI https://staging.your-domain | grep -iE 'strict-transport|x-frame|x-content-type'
```
Expect all three headers. If `strict-transport-security` is missing, the image was built without `APP_ENV=production` (step 4.1).

Then in a browser:
1. `/super-admin`: log in with the bootstrap admin. You must be forced to change the password and enrol MFA.
2. Check **Platform settings**: support email is yours, not `gympulse.example`.
3. Sign up a test gym from the public site. It gets the Starter plan with **1 free month** (Starter's `freeMonths: 1` wins over `platform.trialDays`; see `trialEndFor` in `src/services/gyms.ts`).
4. In that gym: add a plan, add a member, check them in, record a cash payment, print the receipt.
5. Invite a staff member. The email **arrives** (check spam), the link opens on `https://`, and signup works.
6. In Super-admin → Payments, enable eSewa/Khalti. In the test gym's Settings → Payments, enter **sandbox** creds. Pay as a member, then confirm the membership extended
   and the webhook was recorded in the audit log.
7. Configure SMS in Super-admin → Notifications; trigger a renewal reminder (or wait for the worker); the SMS arrives.
8. Upload a member photo/file. Then restart the stack (`docker compose restart`) and confirm the file still opens
   (proves the volume persists).
9. Worker: `docker compose logs --tail=50 worker` shows it polling jobs without errors. Note that `/api/health` only checks the **database**, not the worker, so a dead worker won't trip the uptime monitor. `restart: unless-stopped` covers crashes. For a real alert, add a worker heartbeat to the health route (🟡 follow-up).
10. Check the error webhook with an **unhandled server error (500)**, not a 404. Only `log.error` reports (`src/lib/api.ts`), and failures to deliver are swallowed silently (`src/lib/logger.ts:33–41`).

### 5.6 Production

Repeat 5.1–5.5 on the production server with production values and **live** payment/SMS credentials. Then:
- Do **one real low-value payment** each with eSewa and Khalti (e.g. Rs. 10), and refund/void it.
- Send one real SMS.
- Turn on the uptime monitor. (DNS was already pointed in step 3.2. Caddy needs it before 5.4 to issue the certificate.)
- Confirm there are **no demo accounts**:
  in `psql`: `SELECT email FROM "User" WHERE email LIKE '%.demo';` and `SELECT email FROM "PlatformAdmin" WHERE email LIKE '%@gympulse.local';` → both 0 rows.

---

## Phase 6: Automate deploys (after you're live)

Once the manual deploy works, replace 5.1 with the pipeline in **guide Part 3, Step 5** (`deploy.yml` +
`scripts/deploy.sh`): CI builds the image once, pushes to GHCR, deploys to staging, waits for your approval, and
deploys the *same* image to production. Adjust:
- the compose `image:` lines to `ghcr.io/<you>/gympulse:${TAG}`
- the `docker build` step to pass `--build-arg APP_ENV=production` (`build-args:` in `docker/build-push-action`)

Then pin actions to SHAs (guide Step 8) and rehearse a rollback on staging once.

---

## Phase 7: Operations from day one

### 7.1 🟠 Monitoring
- Uptime check on `/api/health` every 1 min, alerting by SMS/push to you.
- `ERROR_WEBHOOK_URL` to a channel you actually read.
- Disk alert at 80 % on the VPS (`STORAGE_DIR` and Docker images grow). Prune old images monthly: `docker image prune -a --filter "until=720h"`.

### 7.2 🟠 Updating the app (until Phase 6 is done)
```bash
cd ~/src && git pull
docker build --build-arg APP_ENV=production -t gympulse:$(git rev-parse --short HEAD) -t gympulse:latest .
cd /srv/gympulse
docker compose run --rm web npm run db:migrate     # migrate first
docker compose up -d                                # then roll web + worker
curl -fsS https://app.your-domain/api/health
```
Rollback: `TAG=<previous-sha> docker compose up -d`. Keep the last 3 images. Migrations must be backward
compatible (guide Part 4), because the database doesn't roll back.

### 7.3 🟠 If a secret leaks
Rotate it at the provider, update `.env.production`, `docker compose up -d`. For the encryption keys you need
the rotation script from step 1.12. That's why it's on the list.

### 7.4 Restore drill log
*(Fill in after step 3.5: date, backup used, steps, time taken, problems.)*

---

## Phase 8: 🟡 Before scaling

- **Real-device Safari.** Test on an iPhone and a Mac. The Safari loop-stall fix was only tested in Playwright WebKit on Linux.
- **Load test.** Use `k6` against staging: 50 concurrent logins, check-ins, and owner dashboards. Watch DB connections and p95 latency.
- **Lint warnings.** 37 warnings, mostly `<img>` instead of `next/image`. Clean them up gradually.
- **External security review / pen test** before processing significant payment volume.
- **MFA flows.** Never exercised end to end in QA (`ALLOW_ADMIN_WITHOUT_MFA=true` in dev). Step 5.5 #1 covers the
  first pass, so also test lost-device recovery.
- **Legal.** Have a lawyer review the Terms/Privacy text in `src/content/legal.ts` for Nepal (data protection,
  payment terms, refunds).

---

## Launch checklist (tick in order)

**Code (Phase 1)**
- [ ] 1.1 Safari fix committed; tree clean; `PRODUCTION_GUIDE.md` and scratch files removed
- [ ] 1.2 `next@16.4.0`, `npm audit fix`; only the Prisma-chain advisories remain; tests + build green
- [ ] 1.3 `.env.example` committed
- [ ] 1.4 `db:bootstrap` script + test; first admin forced to reset password and enrol MFA
- [ ] 1.5 Payment transactions have `timeout: 15000`, and all money-moving siblings too
- [ ] 1.6 Renew page shows every due member (or "N of M")
- [ ] 1.7 `TRUSTED_PROXY_HOPS` must be explicit in production; tests added
- [ ] 1.9 Playwright headless; no passwords in `e2e/`; scratch import tests resolved
- [ ] 1.10 `tsx` and `dotenv` in `dependencies` (or documented no-prune)
- [ ] 1.11 OCR: `OCR_PROVIDER=none` **or** bundled language data
- [ ] 1.13 Error webhook body includes `text`/`content`; test added

**GitHub (Phase 2)**
- [ ] Private repo, `main` protected, secret scanning + push protection on
- [ ] CI green on a PR with `verify`, `e2e`, `security` required

**Infrastructure (Phase 3–4)**
- [ ] Staging and production VPS hardened (deploy user, key-only SSH, ufw, auto-updates)
- [ ] Managed Postgres, private network only, PITR on, **restore tested and logged**
- [ ] `STORAGE_DIR` volume backed up off-server
- [ ] Fresh keys per environment, stored in a password manager plus an offline copy
- [ ] SMTP domain verified (SPF/DKIM/DMARC); VAPID keys generated
- [ ] Docker image builds; HSTS header present

**Deploy (Phase 5)**
- [ ] Staging: migrate → bootstrap → up → full smoke test (5.5, all 10 items)
- [ ] Production: same, with live creds; one real eSewa + Khalti payment and one real SMS
- [ ] Bootstrap password removed from `.env.production`
- [ ] Zero `*.demo` accounts in production
- [ ] Uptime monitor and error webhook delivering

**After launch (Phase 6–8)**
- [ ] Deploy pipeline in GitHub Actions; rollback rehearsed
- [ ] Key-rotation script written and tested on staging
- [ ] Real-device Safari, load test, security review

---

## What this runbook doesn't prove

- **Nothing in Phases 2–6 has been executed.** There's no remote, no server, and no Docker on this machine.
  The commands are standard, but expect small fixes on the first real run.
- That `next build` works with only the env vars shown. The app reads config lazily through `env()`, which
  suggests the build doesn't need secrets, but that's **unverified**.
- That `headers()` in `next.config.ts` is evaluated at **build** time, so `APP_ENV` must be set during
  `docker build` for HSTS. This is how Next.js has historically worked, but **check it with the `curl -I` in step 5.5**,
  don't assume it.
- eSewa, Khalti, Sparrow and Aakash adapters have **never run against live credentials**.
- Phase 1 code fixes are written and tested (see the status table at the top of Phase 1), except 1.11 (a decision) and 1.12 (not started).
