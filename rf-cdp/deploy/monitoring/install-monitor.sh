#!/usr/bin/env bash
set -euo pipefail
mkdir -p /opt/cdp/monitoring/state
install -m 0755 /tmp/cdp-monitor.sh /opt/cdp/monitoring/cdp-monitor.sh
# env template (filled with token/chat later; script no-ops until then)
[ -f /opt/cdp/monitoring/telegram.env ] || cat > /opt/cdp/monitoring/telegram.env <<EOF
TG_TOKEN=PUT_TOKEN_HERE
TG_CHAT=PUT_CHAT_HERE
EOF
chmod 600 /opt/cdp/monitoring/telegram.env
cat > /etc/systemd/system/cdp-monitor.service <<EOF
[Unit]
Description=CDP minimal monitor -> Telegram
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/cdp/monitoring/cdp-monitor.sh
EOF
cat > /etc/systemd/system/cdp-monitor.timer <<EOF
[Unit]
Description=Run CDP monitor every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now cdp-monitor.timer
echo "--- installed ---"
systemctl list-timers cdp-monitor.timer --no-pager | head -3
echo "--- dry run (not armed yet, должно сказать not armed) ---"
/opt/cdp/monitoring/cdp-monitor.sh
