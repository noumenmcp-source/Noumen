#!/usr/bin/env bash
# Install the CDP backup as a daily systemd timer on the permanent host.
# Idempotent. Run as root on 90.156.170.63 from inside /opt/cdp.
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/cdp}"
SCRIPT="$STACK_DIR/deploy/backup/cdp-backup.sh"

chmod +x "$SCRIPT"
mkdir -p "$STACK_DIR/backups"

cat > /etc/systemd/system/cdp-backup.service <<EOF
[Unit]
Description=CDP nightly backup (pg/es/clickhouse/config)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
Environment=STACK_DIR=$STACK_DIR
ExecStart=$SCRIPT
EOF

cat > /etc/systemd/system/cdp-backup.timer <<EOF
[Unit]
Description=Run CDP backup daily at 03:30 UTC

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now cdp-backup.timer
echo "--- installed. timer status: ---"
systemctl list-timers cdp-backup.timer --no-pager || true
echo "--- run once now to verify: systemctl start cdp-backup.service && tail -f $STACK_DIR/backups/backup.log"
