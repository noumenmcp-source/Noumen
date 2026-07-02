#!/bin/sh
# Advisory-locked deploy for a console service (rf-console, us-console, ...).
# Prevents the concurrent-session race where two sessions scp+`docker compose up`
# the same service at once and one side's file/container-rename silently
# clobbers the other's.
#
# Usage: scp your server.js to /opt/cdp/services/<service>/server.js.incoming
# on the host first, then run this script ON THE HOST (via ssh):
#   /opt/cdp/deploy/deploy-console.sh <service>
# e.g. /opt/cdp/deploy/deploy-console.sh rf-console
#      /opt/cdp/deploy/deploy-console.sh us-console
#
# It atomically: takes a per-service lock (fails fast if someone else is
# deploying that same service — other services deploy independently and are
# not blocked) -> moves .incoming into place -> rebuilds+recreates the
# container -> health checks -> releases the lock.
set -e
SVC="$1"
if [ -z "$SVC" ]; then
  echo "usage: deploy-console.sh <service-name>" >&2
  exit 1
fi
LOCK="/opt/cdp/deploy/.${SVC}-deploy.lock"
SVC_DIR="/opt/cdp/services/${SVC}"
CONTAINER="cdp-${SVC}-1"
COMPOSE="docker compose -p cdp -f /opt/cdp/deploy/docker-compose.cdp.yaml"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "LOCKED: another deploy of ${SVC} is in progress. Not proceeding." >&2
  exit 1
fi
echo "lock acquired (pid $$) at $(date -u +%FT%TZ)" > "$LOCK.info"

if [ ! -f "$SVC_DIR/server.js.incoming" ]; then
  echo "ERROR: $SVC_DIR/server.js.incoming not found — scp your file there first." >&2
  exit 1
fi

mv "$SVC_DIR/server.js.incoming" "$SVC_DIR/server.js"

cd /opt/cdp
$COMPOSE up -d --no-deps --build "$SVC"

i=0
STATUS=unknown
while [ $i -lt 10 ]; do
  sleep 2
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo unknown)
  [ "$STATUS" = "healthy" ] && break
  i=$((i + 1))
done
echo "post-deploy health: $STATUS (after $((i * 2))s)"
if [ "$STATUS" != "healthy" ]; then
  echo "WARNING: container not healthy after deploy — check logs" >&2
fi
rm -f "$LOCK.info"
echo "done"
