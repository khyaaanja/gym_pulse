#!/usr/bin/env bash
# Deploys image tag $TAG to one server over SSH. Called by .github/workflows/deploy.yml; never needs to run locally.
#
# Server side (see documents/GO-LIVE-RUNBOOK.md, Phases 3-4): /srv/gympulse/docker-compose.yml whose web and worker
# services use `image: ghcr.io/<owner>/<repo>:${TAG}`, an .env.production next to it, and a `deploy` user that can
# run docker there and has already done `docker login ghcr.io` with a read:packages token.
#
# Order matters: migrate first in a one-off container. If the migration fails, the running app is left untouched.
set -euo pipefail

: "${TAG:?}" "${DEPLOY_HOST:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}" "${APP_URL:?}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

# Everything below is interpolated into a remote command line, so allow only what a real value can contain.
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "TAG must be a full commit SHA" >&2; exit 1; }
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "DEPLOY_HOST must be a plain hostname or IP" >&2; exit 1; }
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "DEPLOY_USER is not a valid user name" >&2; exit 1; }
[[ "$APP_URL" =~ ^https:// ]] || { echo "APP_URL must be https" >&2; exit 1; }

ssh_dir="$(mktemp -d)"
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"

# Host key pinned: an unknown or changed host key aborts instead of trusting it.
ssh -i "$ssh_dir/key" \
  -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" \
  -o ConnectTimeout=15 \
  "$DEPLOY_USER@$DEPLOY_HOST" "TAG=$TAG bash -s" <<'REMOTE'
set -euo pipefail
cd /srv/gympulse
export TAG
docker compose pull web worker
docker compose run --rm --no-deps web npm run db:migrate
docker compose up -d --remove-orphans web worker
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >> deploy-history.log
REMOTE

# Smoke test through the public URL (proxy, TLS and app together).
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$APP_URL/api/health"; then echo; echo "deployed $TAG"; exit 0; fi
  sleep 5
done
echo "health check failed after deploying $TAG; roll back by running the deploy workflow with the previous SHA" >&2
exit 1
