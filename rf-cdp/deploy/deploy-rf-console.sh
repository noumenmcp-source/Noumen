#!/bin/sh
# Advisory-locked deploy for rf-console. Prevents the concurrent-session race
# where two sessions scp+`docker compose up` the same service at once and one
# side's file/container-rename silently clobbers the other's.
#
# Usage: scp your server.js to /opt/cdp/services/rf-console/server.js.incoming
# on the host first, then run this script ON THE HOST (via ssh):
#   /opt/cdp/deploy/deploy-rf-console.sh
#
# It atomically: takes the lock (fails fast if someone else is deploying) ->
# moves .incoming into place -> rebuilds+recreates the container -> health
# checks -> releases the lock. If the lock is held, it exits 1 immediately
# (no queueing/waiting) so the caller knows to retry later rather than assume
# success.
set -e
LOCK=/opt/cdp/deploy/.rf-console-deploy.lock
SVC_DIR=/opt/cdp/services/rf-console
COMPOSE="docker compose -p cdp -f /opt/cdp/deploy/docker-compose.cdp.yaml"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "LOCKED: another deploy of rf-console is in progress. Not proceeding." >&2
  exit 1
fi
echo "lock acquired (pid $$) at $(date -u +%FT%TZ)" > "$LOCK.info"

if [ ! -f "$SVC_DIR/server.js.incoming" ]; then
  echo "ERROR: $SVC_DIR/server.js.incoming not found — scp your file there first." >&2
  exit 1
fi

mv "$SVC_DIR/server.js.incoming" "$SVC_DIR/server.js"

cd /opt/cdp
$COMPOSE up -d --no-deps --build rf-console

i=0
STATUS=unknown
while [ $i -lt 10 ]; do
  sleep 2
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' cdp-rf-console-1 2>/dev/null || echo unknown)
  [ "$STATUS" = "healthy" ] && break
  i=$((i + 1))
done
echo "post-deploy health: $STATUS (after $((i * 2))s)"
if [ "$STATUS" != "healthy" ]; then
  echo "WARNING: container not healthy after deploy — check logs" >&2
fi
rm -f "$LOCK.info"
echo "done"
