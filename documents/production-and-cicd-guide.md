# GymPulse: Production Readiness and CI/CD From Zero

*Written 2026-10-08 against commit `1d7f767`. Every "verified" claim below was run on that date.
Anything marked **UNVERIFIED** is advice that has not yet been tested in this repo.*

---

## Part 0: Where the project stands today

| Check | Command | Result (2026-10-08) |
|---|---|---|
| Type safety | `npm run typecheck` | ✅ clean (app + e2e) |
| Lint | `npm run lint` | ✅ 0 errors, 37 warnings (mostly `<img>` vs `next/image`) |
| Unit/integration tests | `npm test` | ✅ 486 / 486 passed, 33 files, real Postgres |
| Dependency vulnerabilities | `npm audit --omit=dev` | ❌ 7 high (details in step 3) |
| Secrets in git history | `git log -p` scan | ✅ none found; `.env` is gitignored |
| Git remote | `git remote -v` | ❌ none, so CI/CD can't run yet |

**Bottom line:** the code passes its gates. Infrastructure, configuration and process are what block a launch.

---

## Part 1: Things to do before production (in order)

### 🔴 Blockers: do not launch without these

**1. Put the code on GitHub (private repo).**
```bash
git branch -M main                       # you're on "master"; standardise on "main"
git remote add origin git@github.com:<you>/gympulse.git
git push -u origin main
```

**2. Clean the working tree.**
- `src/components/three/gym-scene.tsx` has the Safari watchdog fix uncommitted. Commit it.
- About 25 untracked files: commit the real code and tests (`e2e/*.test.ts`). Delete or move the scratch files
  (`demo-tmp.mjs`, `measure-trace.mjs`, the many `*_GUIDE.md` / `*_REPORT.md` files).
- **Do not trust `PRODUCTION_GUIDE.md`.** It mentions Clerk, Sentry and "start on Vercel", and this app uses none of those.

**3. Fix the high-severity vulnerabilities.**
```bash
npm install next@16.4.0 eslint-config-next@16.4.0   # fixes the next advisory (not a major bump)
npm audit fix                                       # sharp, source-map-js
npm test && npm run build                           # re-verify afterwards
```
For the `prisma` / `mysql2` / `deepmerge-ts` / `@prisma/config` findings, npm's suggested "fix" **downgrades to
Prisma 6. Do not do this.** Wait for an upstream Prisma 7 patch (Dependabot will open the PR, see Part 4).

**4. Choose a host with a persistent disk and long-running processes. Not serverless.**
The app depends on things serverless platforms (e.g. Vercel functions) don't provide:
- encrypted uploads written to local disk (`STORAGE_DIR`)
- a background job worker (`npm run worker`)
- Tesseract OCR and native modules (`sharp`, `@node-rs/argon2`)

Good fits: a VPS (Hetzner, DigitalOcean, Linode) running Docker, or Fly.io / Railway with a mounted volume.

**5. Production environment variables.** `src/config/env.ts` refuses to start on unsafe values, but you still have
to set them:

| Variable | Production value |
|---|---|
| `APP_ENV` | `production` |
| `APP_URL` | `https://your-domain` (http is refused) |
| `DATABASE_URL` | managed Postgres, with `?sslmode=require` |
| `DATA_ENCRYPTION_KEY`, `FILE_ENCRYPTION_KEY` | **new** keys: `openssl rand -base64 32` (never reuse dev keys) |
| `SIGNING_SECRET` | **new**: `openssl rand -base64 48` |
| `ALLOW_ADMIN_WITHOUT_MFA` | `false` |
| `ENABLE_TEST_GATEWAY` | `false` (members could approve their own payments otherwise) |
| `EMAIL_TRANSPORT` / `SMTP_URL` / `EMAIL_FROM` | `smtp`, a real SMTP provider, a real sender address |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | `npx web-push generate-vapid-keys`, `mailto:` a real address |
| `TRUSTED_PROXY_HOPS` | exactly the number of proxies in front (usually `1`) |
| `RUN_WORKER_IN_PROCESS` | `false` (run the worker separately, step 10) |
| `ERROR_WEBHOOK_URL` | where errors get posted (Slack/Discord webhook) |
| `GOOGLE_CLIENT_ID/SECRET` | only if you offer Google sign-in; redirect URI `<APP_URL>/api/auth/google/callback` |
| `CLAMAV_HOST` | recommended: virus-scan uploads |

**6. Back up the encryption keys separately from the database.**
If `DATA_ENCRYPTION_KEY` or `FILE_ENCRYPTION_KEY` is lost, the encrypted data can't be recovered. Store them in a
password manager *and* your host's secret store. They must not live only on the server.

**7. Database.**
- Use a managed Postgres with automated daily backups and point-in-time recovery.
- **Do one test restore** before launch. A backup that has never been restored isn't proven to work.
- Apply schema with `npm run db:migrate` (`prisma migrate deploy`). **Never** run `npm run db:seed` against it.
- Migrations use the `pg_trgm` extension, so make sure your provider allows it.

### 🟠 High priority: before real customers

8. **Test the real providers end to end.** eSewa, Khalti and Sparrow/Aakash SMS have adapters that have never run
   against live credentials. Do one real low-value payment, one refund/failure case and one SMS.
9. **Replace placeholders.** The legal page falls back to `support@gympulse.example`, so set
   `platform.supportEmail` in platform settings. The env defaults use `@gympulse.local`.
10. **Run the worker as its own process** with automatic restart (separate container or systemd unit).
11. **Reverse proxy and TLS** (Caddy handles certificates automatically). Point an uptime monitor
    (UptimeRobot, Better Stack) at `GET /api/health`. It's public, leaks nothing, and returns 503 when the DB is down.
12. **Back up `STORAGE_DIR`** (uploaded files) on the same schedule as the database.
13. **No demo data in production.** The `*.demo` accounts with password `GymPulse!Demo2026` must not exist there.
14. **Set `DB_POOL_SIZE`** so `(web instances + worker) × pool` stays below your Postgres connection limit.

### 🟡 Before scaling: needs a human

- Real-device Safari check (iPhone + Mac). So far it has only been tested in Playwright WebKit on Linux.
- Load test (e.g. `k6`) of login, check-in and dashboard.
- An external security review or pen test before taking payments at scale.

---

## Part 2: CI/CD from zero

### What the words mean

- **CI (Continuous Integration):** every time someone pushes code, a robot checks it automatically (lint, types,
  tests, build, security scans). If anything fails, the code isn't allowed into `main`.
- **CD (Continuous Delivery / Deployment):** once code is in `main`, a robot packages it and ships it, first to
  **staging** (a private copy of production) and then, after a human clicks approve, to **production**.
- **Pipeline:** the ordered list of steps the robot runs.
- **Workflow:** in GitHub Actions, a YAML file in `.github/workflows/` that defines a pipeline.
- **Runner:** the temporary machine GitHub starts to run your workflow. It's destroyed afterwards.
- **Artifact / image:** the packaged app (here a Docker image) that you build once and deploy everywhere.

### Why bother

Without CI/CD, every deploy depends on someone remembering to run the tests, using the right Node version and
copying the right files. With it, **the same checks run every time, and only code that passed them can reach users.**

### The big picture

```
 developer ──push──▶ feature branch ──open PR──▶  CI: lint · types · tests · build · security scans
                                                    │  all green + 1 review
                                                    ▼
                                                  merge to main
                                                    │
                                                    ▼
                         CD: build Docker image ONCE (tagged with git SHA) ─▶ scan image ─▶ push to registry
                                                    │
                                                    ▼
                         deploy to STAGING ─▶ run migrations ─▶ smoke test /api/health
                                                    │  human approves in GitHub
                                                    ▼
                         deploy SAME image to PRODUCTION ─▶ migrations ─▶ smoke test ─▶ done
                                                    │  something wrong?
                                                    ▼
                                         redeploy previous SHA (rollback)
```

### The 10 rules of a safe pipeline

1. **`main` is protected.** No direct pushes and no force pushes. Changes arrive only through a PR with green CI.
2. **Build once, deploy many.** The exact image tested in staging is what goes to production. Never rebuild on
   the server.
3. **Least privilege everywhere.** Each workflow gets only the permissions it needs (`permissions:` block),
   and the default is read-only.
4. **Secrets never touch PRs from forks or untrusted code.** CI on pull requests uses throwaway keys generated
   inside the run. Real secrets live only in the protected `staging` / `production` environments.
5. **Never use `pull_request_target`** with a checkout of PR code. It's the most common way GitHub Actions get
   hacked.
6. **Pin third-party actions to a commit SHA**, not a tag. Tags can be moved by an attacker. (Part 4 shows how.)
7. **Scan dependencies, code, secrets and the container image** on every PR.
8. **Production deploys need a human approval** (GitHub Environment with required reviewers).
9. **Migrations are backward compatible** (see Part 3), so a rollback never breaks the database.
10. **Every deploy is traceable** to a commit SHA, and rollback means redeploying the previous SHA.

---

## Part 3: Step-by-step setup

### Step 1: GitHub repository settings (one-time, in the browser)

**Settings → General**
- Repository visibility: **Private**.
- Pull Requests: allow **squash merging** only; enable "Automatically delete head branches".

**Settings → Branches → Add branch ruleset for `main`**
- ✅ Require a pull request before merging (1 approval; dismiss stale approvals on new commits)
- ✅ Require status checks to pass: `verify`, `e2e`, `security` (they appear after the first CI run)
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution
- ✅ Block force pushes, ✅ Restrict deletions
- ✅ Do not allow bypassing (applies to admins too)

**Settings → Code security**
- ✅ Dependabot alerts, ✅ Dependabot security updates
- ✅ Secret scanning + ✅ Push protection (blocks commits that contain keys)
- ✅ Code scanning (CodeQL), set up by the workflow below

**Settings → Actions → General**
- Workflow permissions: **Read repository contents** (read-only default)
- ❌ Uncheck "Allow GitHub Actions to create and approve pull requests"
- Fork PR workflows: **Require approval for all outside collaborators**

**Settings → Environments**
- Create `staging`: no reviewers; restrict to branch `main`.
- Create `production`: **required reviewers = you**; restrict to branch `main`; optional wait timer 5 min.
- Put each environment's secrets **in that environment**, not in repo-level secrets (Step 6).

### Step 2: Files to add to the repo

```
.github/
  workflows/
    ci.yml          ← runs on every PR
    deploy.yml      ← runs on merge to main
  dependabot.yml    ← weekly dependency PRs
  CODEOWNERS        ← who must review what
Dockerfile
.dockerignore
```

### Step 3: `.github/workflows/ci.yml` (Continuous Integration)

> **UNVERIFIED**: there's no remote yet, so this has never run. Expect to fix small things on the first run.
> Rule: CI on PRs uses **no repository secrets**. Encryption keys are generated fresh inside each run.

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

# Read-only by default; jobs widen only what they need.
permissions:
  contents: read

# Cancel an older run when a new commit is pushed to the same PR.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    services:
      postgres:
        image: postgres:17            # includes pg_trgm
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: gympulse
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/gympulse
      APP_ENV: test
      NEXT_TELEMETRY_DISABLED: "1"
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false   # don't leave the token on disk

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      # Throwaway keys, valid only for this run. No real secret ever enters CI.
      - name: Generate ephemeral test keys
        run: |
          echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
          echo "FILE_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
          echo "SIGNING_SECRET=$(openssl rand -base64 48)"      >> "$GITHUB_ENV"

      - run: npm ci                    # exact versions from package-lock.json
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  e2e:
    needs: verify
    runs-on: ubuntu-latest
    timeout-minutes: 30
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: gympulse }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/gympulse
      APP_ENV: development              # seed refuses production; this is a disposable DB
      APP_URL: http://localhost:3000
      E2E_OWNER_EMAIL: owner@pulsefitness.demo
      E2E_OWNER_PASSWORD: GymPulse!Demo2026   # demo-only value; fine because this DB is thrown away
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - name: Generate ephemeral keys
        run: |
          echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
          echo "FILE_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
          echo "SIGNING_SECRET=$(openssl rand -base64 48)"      >> "$GITHUB_ENV"
      - run: npm ci
      - run: npm run db:migrate
      - run: npm run db:seed
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - name: Start app
        run: npm start &
      - run: npx wait-on http://localhost:3000/api/health --timeout 60000
      - run: npx playwright test
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: playwright-report, retention-days: 7 }

  security:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write            # needed only to upload CodeQL results
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false, fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci --ignore-scripts

      # 1. Known-vulnerable dependencies
      - run: npm audit --omit=dev --audit-level=high

      # 2. New risky dependencies introduced by this PR
      - if: github.event_name == 'pull_request'
        uses: actions/dependency-review-action@v4
        with: { fail-on-severity: high }

      # 3. Committed secrets (whole history)
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }

      # 4. Static analysis of our own code (SQL injection, XSS, etc.)
      - uses: github/codeql-action/init@v3
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@v3
```

**Before the `e2e` job works, fix `playwright.config.ts`:**
- `headless: false` → `headless: true` (CI has no screen)
- remove `channel: 'chrome'` (use Playwright's bundled Chromium)
- in `e2e/*.test.ts`, replace the hardcoded `OWNER_PASSWORD = 'GymPulse!Demo2026'` with
  `process.env.E2E_OWNER_PASSWORD!` (and the same for the email)
- delete or finish the six `e2e/import-*.test.ts` scratch tests; flaky tests in CI train people to ignore red

**npm audit is currently red** (Part 1 step 3). Either fix it first, or temporarily run that step with
`continue-on-error: true` and remove that line the day Prisma ships a patch. Never leave it off permanently.

### Step 4: `Dockerfile` (how the app is packaged)

> **UNVERIFIED** in this repo. Build it locally once with `docker build -t gympulse .` before relying on it.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Run as an unprivileged user, never root
RUN groupadd --system app && useradd --system --gid app --home /app app \
 && mkdir -p /data/storage && chown app:app /data/storage
COPY --from=build --chown=app:app /app ./
USER app
ENV STORAGE_DIR=/data/storage
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
```

Notes:
- The **worker uses the same image** with a different command: `npm run worker`.
- `tsx` (used by `npm run worker`) is a **devDependency**, so don't `npm prune --omit=dev` until you move `tsx`
  to `dependencies` or compile the worker. Same for `prisma` CLI used by migrations (already in dependencies).
- No secrets are baked into the image. They're injected at runtime as environment variables.
- `tesseract.js` downloads language data at runtime unless `TESSERACT_LANG_PATH` is set. For production,
  bake the `eng.traineddata` file into the image and set the path, so OCR doesn't depend on a third-party CDN.

**`.dockerignore`** (keeps secrets and junk out of the image):
```
.git
.env
.env.*
node_modules
.next
.pgdata
.storage
.perf-tmp
playwright-report
test-results
*.md
*.pdf
*.docx
*.zip
```

### Step 5: `.github/workflows/deploy.yml` (Continuous Delivery)

> **Superseded (2026-10-09):** the real files are `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` and
> `scripts/deploy.sh` in the repo. They differ from the sketches below: images are deployed by digest
> (`image: ${IMAGE_REF:?}` in compose), settings are named `STAGING_*` / `PRODUCTION_*`, and production deploys
> only by a manual run. Read the files, not this section.

Example target: one VPS running Docker Compose behind Caddy. The robot builds the image, pushes it to GitHub's
container registry (GHCR), then SSHes into the server as a restricted `deploy` user and switches to the new tag.

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:                  # manual re-deploy / rollback
    inputs:
      sha:
        description: "Image SHA to deploy (rollback). Empty = this commit."
        required: false

permissions:
  contents: read

concurrency:
  group: deploy                        # never two deploys at once
  cancel-in-progress: false

env:
  IMAGE: ghcr.io/${{ github.repository }}

jobs:
  build:
    if: github.event.inputs.sha == ''
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write                  # push to GHCR
      id-token: write                  # signing / provenance
      attestations: write
    outputs:
      tag: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}:${{ github.sha }}
          provenance: true
          sbom: true                   # list of everything inside the image
      # Fail the deploy if the image has HIGH/CRITICAL OS or library vulnerabilities
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: ${{ env.IMAGE }}:${{ github.sha }}
          severity: HIGH,CRITICAL
          exit-code: "1"
          ignore-unfixed: true
      - uses: actions/attest-build-provenance@v2
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true

  staging:
    needs: build
    if: always() && (needs.build.result == 'success' || needs.build.result == 'skipped')
    runs-on: ubuntu-latest
    environment: staging               # staging secrets only visible here
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - name: Deploy
        env:
          TAG: ${{ github.event.inputs.sha || github.sha }}
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}   # pinned host key: no MITM
          HOST: ${{ vars.DEPLOY_HOST }}
        run: ./scripts/deploy.sh
      - name: Smoke test
        run: curl --fail --retry 10 --retry-delay 5 "${{ vars.APP_URL }}/api/health"

  production:
    needs: staging
    runs-on: ubuntu-latest
    environment: production            # ⏸ waits for your approval in GitHub
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - name: Deploy
        env:
          TAG: ${{ github.event.inputs.sha || github.sha }}
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          HOST: ${{ vars.DEPLOY_HOST }}
        run: ./scripts/deploy.sh
      - name: Smoke test
        run: curl --fail --retry 10 --retry-delay 5 "${{ vars.APP_URL }}/api/health"
```

**`scripts/deploy.sh`** (what runs on each deploy):
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${TAG:?}" "${HOST:?}" "${SSH_KEY:?}" "${KNOWN_HOSTS:?}"

install -m 700 -d ~/.ssh
printf '%s\n' "$SSH_KEY"     > ~/.ssh/id_deploy && chmod 600 ~/.ssh/id_deploy
printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts

ssh -i ~/.ssh/id_deploy -o StrictHostKeyChecking=yes "deploy@$HOST" "TAG=$TAG bash -s" <<'REMOTE'
  set -euo pipefail
  cd /srv/gympulse
  docker compose pull
  # 1. Migrate FIRST, as a one-off container. If this fails, nothing else changes.
  docker compose run --rm -e TAG web npm run db:migrate
  # 2. Then roll the app and worker onto the new image.
  TAG="$TAG" docker compose up -d --remove-orphans web worker
  echo "$TAG" >> deploy-history.log
REMOTE
```

**On the server**, `/srv/gympulse/docker-compose.yml`:
```yaml
services:
  web:
    image: ghcr.io/<you>/gympulse:${TAG}
    env_file: /srv/gympulse/.env.production   # chmod 600, owned by root, never in git
    environment: { RUN_WORKER_IN_PROCESS: "false" }
    volumes: ["storage:/data/storage"]
    read_only: true
    tmpfs: ["/tmp", "/app/.next/cache"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped
  worker:
    image: ghcr.io/<you>/gympulse:${TAG}
    command: ["npm", "run", "worker"]
    env_file: /srv/gympulse/.env.production
    volumes: ["storage:/data/storage"]
    read_only: true
    tmpfs: ["/tmp"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data"]
    restart: unless-stopped
volumes: { storage: {}, caddy_data: {} }
```
`Caddyfile`: `your-domain.com { reverse_proxy web:3000 }` (Caddy gets and renews HTTPS certificates itself).
With Caddy as the only proxy, `TRUSTED_PROXY_HOPS=1`. **UNVERIFIED:** `read_only: true` may need more tmpfs paths
if Next.js writes elsewhere at runtime. Test it on staging first.

**Server hardening (one-time):**
- Create a `deploy` user that can only run docker in `/srv/gympulse` (no sudo, no password login).
- SSH: key-only (`PasswordAuthentication no`, `PermitRootLogin no`).
- Firewall: allow only 22, 80, 443 (`ufw`). Postgres must **not** be reachable from the internet.
- Enable automatic security updates (`unattended-upgrades`).
- Generate a dedicated deploy key pair: `ssh-keygen -t ed25519 -f gympulse_deploy -C ci-deploy`. The public key
  goes in the server's `~deploy/.ssh/authorized_keys`, the private key goes in GitHub (`DEPLOY_SSH_KEY`).
- Get the pinned host key with `ssh-keyscan your-server` and **check its fingerprint against the server
  console** before saving it as `DEPLOY_KNOWN_HOSTS`.

### Step 6: Where every secret lives

> **Superseded (2026-10-09):** the deploy settings are now `STAGING_DEPLOY_HOST`, `STAGING_DEPLOY_USER`,
> `STAGING_APP_URL` (variables) and `STAGING_DEPLOY_SSH_KEY`, `STAGING_DEPLOY_KNOWN_HOSTS` (secrets), and the same with
> `PRODUCTION_`. On GitHub Free (private repo) they live at repository level; see the top of `.github/workflows/deploy.yml`.

| Secret | Lives in | Never in |
|---|---|---|
| App runtime secrets (encryption keys, DB URL, SMTP, VAPID, provider creds) | `/srv/gympulse/.env.production` on each server (chmod 600) **+ password manager backup** | git, Docker image, CI logs |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | GitHub → Environments → `staging` / `production` (separate keys per env) | repo-level secrets |
| `DEPLOY_HOST`, `APP_URL` | GitHub → Environments → *Variables* (not secret) | |
| CI test keys | generated inside each run | anywhere persistent |

Staging and production must have **different** keys, databases and provider credentials (sandbox for staging).

### Step 7: `.github/dependabot.yml` and `CODEOWNERS`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 10
    groups:
      minor-and-patch: { update-types: [minor, patch] }
  - package-ecosystem: github-actions        # keeps pinned action SHAs current
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: docker
    directory: /
    schedule: { interval: weekly }
```

`.github/CODEOWNERS`, so sensitive paths always need your review:
```
*                         @<you>
/.github/                 @<you>
/prisma/migrations/       @<you>
/src/lib/auth/            @<you>
/src/services/payments/   @<you>
/src/config/env.ts        @<you>
```

### Step 8: Pin actions to SHAs

The examples above use readable tags (`@v4`). After everything works, convert them to commit SHAs:
```bash
npx pinact run            # rewrites uses: owner/action@v4 → @<sha> # v4
```
Dependabot (`github-actions` ecosystem above) will then keep those SHAs updated through PRs.

---

## Part 4: Database migrations without downtime or broken rollbacks

During a deploy, the old and new versions of the app run against the same database for a short time, and a
rollback puts the *old* code back on the *new* schema. So every migration must work with **both** versions.

**Expand, then contract:**

| Change | Release 1 (expand) | Release 2 (contract, a later deploy) |
|---|---|---|
| Add a column | add it **nullable** or with a default | make it required if needed |
| Rename a column | add the new column, write to both, backfill | stop reading old, then drop it |
| Drop a column | stop using it in code | drop it |
| Add an index on a big table | `CREATE INDEX CONCURRENTLY` (in its own migration) | |

Rules:
- Never edit a migration that has already been deployed. Add a new one.
- Every migration PR is reviewed (CODEOWNERS covers `/prisma/migrations/`).
- Take or confirm a fresh backup before any migration that deletes data.

---

## Part 5: Rollback and incidents

- **Rollback:** GitHub → Actions → `deploy` → *Run workflow* → enter the previous SHA (from
  `deploy-history.log` or the Actions list). Same approval gate applies to production.
- **The database doesn't roll back.** That's why Part 4 matters. Restore from backup only for data corruption.
- **Leaked secret:** rotate it immediately (provider dashboard, new key in `.env.production`, restart), then
  investigate. Removing it from git history doesn't help, because it's already been exposed.
- Rotating `DATA_ENCRYPTION_KEY` / `FILE_ENCRYPTION_KEY` requires re-encrypting existing data. **There's no
  rotation script in this repo yet.** Write one before you ever need it.

---

## Part 6: Your daily workflow once this is set up

```bash
git switch -c feat/member-export          # 1. branch
# ...code...
npm run lint && npm run typecheck && npm test   # 2. same checks CI will run
git commit -m "Add member CSV export"
git push -u origin feat/member-export     # 3. push
gh pr create --fill                       # 4. open PR → CI runs automatically
# 5. CI green + review → Squash & merge
# 6. deploy.yml: builds → staging → smoke test → waits for you
# 7. check staging in the browser → Approve in GitHub → production
```

---

## Part 7: Launch checklist (tick in order)

- [ ] Code pushed to a private GitHub repo; branch is `main`
- [ ] Working tree clean; scratch files removed; misleading `PRODUCTION_GUIDE.md` removed or rewritten
- [ ] `next` → 16.4.0, `npm audit fix`, tests + build green
- [ ] Branch ruleset, secret scanning, push protection, Dependabot enabled
- [ ] `ci.yml` green on a PR (verify, e2e, security)
- [ ] Playwright config made headless; e2e credentials from env
- [ ] Dockerfile builds locally; image runs and `/api/health` returns 200
- [ ] VPS hardened (deploy user, key-only SSH, firewall, auto-updates)
- [ ] Managed Postgres with PITR; **restore tested**
- [ ] Fresh production keys generated and backed up offline
- [ ] `.env.production` filled; app boots (env.ts guards pass)
- [ ] Staging deployed through the pipeline and clicked through by a human
- [ ] Real eSewa + Khalti payment and real SMS tested on staging (sandbox) and then once in production
- [ ] Support email and legal placeholders replaced
- [ ] No demo accounts in the production DB
- [ ] Uptime monitor on `/api/health`; `ERROR_WEBHOOK_URL` delivering
- [ ] `STORAGE_DIR` volume backed up
- [ ] Real iPhone + Mac Safari check
- [ ] Production approved and deployed; rollback rehearsed once on staging

---

### What this document does not cover / is unverified
- None of the workflow, Dockerfile, compose or deploy-script examples have been run; there's no remote or server yet.
- Whether `next build` needs runtime env vars at build time: the CI job provides them, but this is untested in CI.
- No encryption-key rotation tool exists in the repo.
- No load test or external security review has been done.
