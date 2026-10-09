# syntax=docker/dockerfile:1
# Base image pinned by digest (Dependabot's docker updates keep it current). The tag is for humans.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM ${NODE_IMAGE} AS deps
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
RUN npm run build \
 && npm prune --omit=dev \
 && rm -rf .next/cache

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# Prisma's migration engine needs OpenSSL, which the slim image does not include.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STORAGE_DIR=/data/storage \
    NPM_CONFIG_CACHE=/tmp/.npm NPM_CONFIG_UPDATE_NOTIFIER=false
# Run as an unprivileged user, never root. App files stay root-owned so the app cannot rewrite its own code.
RUN groupadd --system app && useradd --system --gid app --home /app app \
 && mkdir -p /data/storage /app/.next/cache && chown app:app /data/storage /app/.next/cache
COPY --from=build /app ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# next directly, not through npm, so SIGTERM from `docker stop` reaches the server and it shuts down cleanly.
CMD ["node_modules/.bin/next", "start"]
