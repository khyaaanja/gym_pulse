# Base image pinned by digest; Dependabot's docker updates keep it current. The tag is for humans.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
WORKDIR /app
# OpenSSL must be present when `npm ci` runs, not only at runtime: Prisma picks its engine binaries by the libssl it
# finds at install time, and with none it ships the openssl-1.1 engines, which then don't match at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# next.config.ts reads APP_ENV when it builds the header table: production adds HSTS.
# Build with the environment you deploy to, or the HSTS header is silently missing.
ARG APP_ENV=production
ENV APP_ENV=$APP_ENV
# The database client refuses to load without DATABASE_URL, and `next build` loads route modules. Nothing connects
# during the build, so a dummy, unreachable URL is enough. Set inline so it never reaches the runtime image.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build npm run build \
 && npm prune --omit=dev \
 && rm -rf .next/cache

FROM base AS runtime
ENV NODE_ENV=production STORAGE_DIR=/data/storage \
    NPM_CONFIG_CACHE=/tmp/.npm NPM_CONFIG_UPDATE_NOTIFIER=false
# Run as an unprivileged user, never root. App files stay root-owned so the app cannot rewrite its own code.
RUN groupadd --system app && useradd --system --gid app --home /app app \
 && mkdir -p /data/storage /app/.next/cache && chown app:app /data/storage /app/.next/cache
COPY --from=build /app ./
ARG APP_ENV=production
ENV APP_ENV=$APP_ENV
USER app
EXPOSE 3000
# For the web container. The worker serves no HTTP: run it with the healthcheck disabled (compose: `healthcheck:
# {disable: true}`), or it shows as permanently unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# next directly, not through npm, so SIGTERM from `docker stop` reaches the server and it shuts down cleanly.
CMD ["node_modules/.bin/next", "start"]
