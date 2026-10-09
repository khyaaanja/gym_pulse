#!/usr/bin/env bash
# Deploys one image, by digest, to one server over SSH. Called by .github/workflows/deploy.yml; never needs to run
# locally.
#
# Server side (see documents/GO-LIVE-RUNBOOK.md, Phases 3-4): /srv/gympulse/docker-compose.yml whose web and worker
# services use `image: ${IMAGE_REF:?}` (the worker with `healthcheck: {disable: true}`), an .env.production next to it,
# and a deploy user that can run docker there and has done `docker login ghcr.io` with a read:packages token.
# This script writes IMAGE_REF into /srv/gympulse/.env (compose reads it automatically), so a later hand-run
# `docker compose up -d` keeps the deployed image. It refuses to finish unless the containers run exactly IMAGE_REF.
#
# Order matters: migrate first in a one-off container. If the migration fails, the running app is left untouched.
set -euo pipefail

: "${TAG:?}" "${IMAGE_REF:?}" "${DEPLOY_HOST:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}" "${APP_URL:?}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

# Everything below is interpolated into a remote command line, so allow only what a real value can contain.
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "TAG must be a full commit SHA" >&2; exit 1; }
[[ "$IMAGE_REF" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || { echo "IMAGE_REF must be ghcr.io/...@sha256:<digest>" >&2; exit 1; }
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "DEPLOY_HOST must be a plain hostname or IP" >&2; exit 1; }
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "DEPLOY_USER is not a valid user name" >&2; exit 1; }
[[ "$APP_URL" =~ ^https:// ]] || { echo "APP_URL must be https" >&2; exit 1; }
# Staging and production must be different machines; a copy-paste mistake here would deploy untested code live.
if [ -n "${OTHER_HOST:-}" ] && [ "${OTHER_HOST,,}" = "${DEPLOY_HOST,,}" ]; then
  echo "staging and production point at the same host ($DEPLOY_HOST): refusing" >&2; exit 1
fi
# Same machine under two names (IP vs hostname) shows up as the same host key in both known_hosts values.
if [ -n "${OTHER_KNOWN_HOSTS:-}" ]; then
  keys() { tr -d '\r' | awk 'NF >= 3 && $1 !~ /^#/ { print $(NF-1), $NF }' | sort -u; }
  shared=$(comm -12 <(printf '%s\n' "$DEPLOY_KNOWN_HOSTS" | keys) <(printf '%s\n' "$OTHER_KNOWN_HOSTS" | keys))
  [ -z "$shared" ] || { echo "staging and production known_hosts share a host key (same machine?): refusing" >&2; exit 1; }
fi

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
  "$DEPLOY_USER@$DEPLOY_HOST" "TAG=$TAG IMAGE_REF=$IMAGE_REF bash -s" <<'REMOTE'
set -euo pipefail
cd /srv/gympulse
export TAG IMAGE_REF
# Before touching anything: the compose file must resolve web and worker to exactly this digest.
images=$(docker compose config --images web worker | sort -u)
[ "$images" = "$IMAGE_REF" ] || { echo "compose resolves to '$images', expected $IMAGE_REF (use image: \${IMAGE_REF:?})" >&2; exit 1; }
docker compose pull web worker
docker compose run --rm --no-deps web npm run db:migrate
# Record the image for compose (atomically, keeping any other lines) only once the migration has succeeded.
{ grep -v '^IMAGE_REF=' .env 2>/dev/null || true; printf 'IMAGE_REF=%s\n' "$IMAGE_REF"; } > .env.tmp && mv .env.tmp .env
# --wait: web must turn healthy and the worker must be running (not restarting) before this returns.
docker compose up -d --remove-orphans --wait --wait-timeout 180 web worker
# Prove the containers now running are exactly the requested image, and stay up (no restarts in a 10 s window).
declare -A before
for svc in web worker; do before[$svc]=$(docker inspect -f '{{.RestartCount}}' "$(docker compose ps -q "$svc")"); done
sleep 10
for svc in web worker; do
  id=$(docker compose ps -q "$svc")
  [ -n "$id" ] || { echo "$svc is not running" >&2; exit 1; }
  image=$(docker inspect -f '{{.Config.Image}}' "$id")
  [ "$image" = "$IMAGE_REF" ] || { echo "$svc runs '$image', expected $IMAGE_REF" >&2; exit 1; }
  state=$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$id")
  [ "$state" = "running ${before[$svc]}" ] || { echo "$svc is not stable: $state (restarts before: ${before[$svc]})" >&2; exit 1; }
done
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" "$IMAGE_REF" >> deploy-history.log
REMOTE

# Smoke test through the public URL (proxy, TLS and app together).
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$APP_URL/api/health"; then echo; echo "deployed $TAG ($IMAGE_REF)"; exit 0; fi
  sleep 5
done
echo "health check failed after deploying $TAG; roll back by running the deploy workflow with the previous sha and digest" >&2
exit 1
