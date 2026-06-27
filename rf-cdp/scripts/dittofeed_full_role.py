#!/usr/bin/env python3
"""Bring Dittofeed to full role via Admin API: user properties -> email template (Flot MJML)
-> SMTP provider (mailpit) -> test send -> read rendered email from mailpit."""
import json, urllib.request, uuid, os, time

BASE = "http://localhost:3000"
WS = "adfb18b4-9d92-4610-ada3-ab1fa9b158b7"
KEY = open("/tmp/cdp_admin_key").read().strip()
ASSETS = "/Users/a1/Documents/New project/cdp/services/dittofeed-assets"
H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)

def step(title, method, path, body=None):
    code, resp = call(method, path, body)
    print(f"\n[{title}] {method} {path} -> {code}")
    print("   ", resp[:280])
    return code, resp

subject = open(f"{ASSETS}/subject.liquid").read().strip()
mjml = open(f"{ASSETS}/body.mjml").read()

# 1. user properties gen_subject, gen_body_html
for prop in ("gen_subject", "gen_body_html"):
    step(f"user-property {prop}", "PUT", "/api/admin/user-properties/", {
        "workspaceId": WS, "id": str(uuid.uuid4()), "name": prop,
        "definition": {"type": "Trait", "path": prop},
    })

# 2. email template from Flot MJML
tpl_id = str(uuid.uuid4())
code, resp = step("create email template", "PUT", "/api/admin/content/templates", {
    "workspaceId": WS, "id": tpl_id, "name": "cdp-welcome-industrial",
    "definition": {
        "type": "Email", "from": "noreply@zavod.dev",
        "subject": subject, "body": mjml, "emailContentsType": "Code",
    },
})

# 3. SMTP provider -> mailpit, set default
step("smtp provider -> mailpit", "PUT", "/api/admin/settings/email-providers", {
    "workspaceId": WS, "setDefault": True,
    "config": {"type": "Smtp", "host": "cdp-mailpit", "port": "1025", "username": "", "password": ""},
})

# 4. test-send the template with our generated traits
step("test send", "POST", "/api/admin/content/templates/test", {
    "workspaceId": WS, "templateId": tpl_id, "channel": "Email",
    "userProperties": {
        "email": "recipient@zavod.dev",
        "gen_subject": "Промышленный апгрейд: новые позиции под ваш профиль",
        "gen_body_html": "<p>Здравствуйте! Под ваш профиль подобрали 12 новых позиций оборудования с обновлёнными ценами.</p>",
        "catalog_url": "https://zavod.dev/catalog",
        "unsubscribe_url": "https://zavod.dev/unsubscribe?u=recipient",
    },
})

# 5. read mailpit — prove personalization rendered
time.sleep(3)
try:
    with urllib.request.urlopen("http://localhost:8025/api/v1/messages", timeout=8) as r:
        m = json.loads(r.read())
    print(f"\n[mailpit] total messages = {m.get('total')}")
    for msg in m.get("messages", [])[:3]:
        mid = msg.get("ID")
        print("   subject:", msg.get("Subject"), "| to:", [t.get("Address") for t in msg.get("To", [])])
        try:
            with urllib.request.urlopen(f"http://localhost:8025/api/v1/message/{mid}", timeout=8) as r2:
                full = json.loads(r2.read())
            html = (full.get("HTML") or "")[:600]
            print("   body excerpt:", html.replace("\n", " ")[:400])
        except Exception as e:
            print("   body read failed:", e)
except Exception as e:
    print("\n[mailpit] read failed:", e)
print("\nTEMPLATE_ID", tpl_id)
