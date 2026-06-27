# CDP minimal monitor → Telegram (deployed on 90.156.170.63)

systemd timer `cdp-monitor.timer` runs `cdp-monitor.sh` every 2 min (~0 RAM, short-lived).
Alerts to Telegram (@HermDom_bot) on: container down/restart (catches silent OOM restarts),
gateway /v1/health unreachable, raw.failed/forward.failed/dropped/resend.failed increase,
ES heap ≥85%, MemAvailable <150MB, kernel oom-kill. Daily heartbeat once/UTC-day.

Arm: fill /opt/cdp/monitoring/telegram.env (TG_TOKEN, TG_CHAT, chmod 600). Script no-ops until armed.
Manual run: /opt/cdp/monitoring/cdp-monitor.sh   Logs: journalctl -u cdp-monitor.service
