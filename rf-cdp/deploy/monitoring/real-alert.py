#!/usr/bin/env python3
"""Emit Telegram-alert lines for REAL leads / external visitors from an ES
_search result (stdin). argv[1] = site. Filters out own IPs and curl test
injections. Prints one 'WM=<max ts>' line + zero or more 'MSG=<text>' lines."""
import sys
import json

SITE = sys.argv[1] if len(sys.argv) > 1 else "?"
OWN = {"138.124.80.43", "137.220.56.211"}  # свои IP (VPN / Odoo-сервер)
LEADS = {"callback_requested", "rfq_submitted", "account_registered"}

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

hits = data.get("hits", {}).get("hits", [])
if not hits:
    sys.exit(0)

max_ts = ""
msgs = []
for hit in hits:
    src = hit.get("_source", {})
    ts = src.get("ts", "")
    if ts > max_ts:
        max_ts = ts
    ua = str(src.get("ua", ""))
    if "curl" in ua:  # отладочные инъекции
        continue
    event = src.get("event")
    ip = src.get("ip")
    origin = src.get("origin")
    dev = ("iPhone" if "iPhone" in ua else "Android" if "Android" in ua
           else "Mac" if "Mac" in ua else "Windows" if "Windows" in ua else "?")
    if event in LEADS:
        msgs.append("MSG=\U0001F4E9 ЛИД %s: %s | ip=%s | %s" % (SITE, event, ip, ts[:16]))
    elif origin and ip not in OWN:
        msgs.append("MSG=\U0001F464 внешний посетитель %s: %s | ip=%s | %s" % (SITE, dev, ip, ts[:16]))

if max_ts:
    print("WM=" + max_ts)
for m in msgs:
    print(m)
