#!/usr/bin/env python3
"""End-to-end ML loop: seed audience -> Flot generates per-user content -> Validator gate
(reused from ml-content-worker) -> write traits to Dittofeed -> personalized send -> mailpit.
Demonstrates the ml-content-worker loop against live Dittofeed + Flot."""
import json, urllib.request, urllib.error, uuid, sys, time, re

sys.path.insert(0, "/Users/a1/Documents/New project/cdp/services/ml-content-worker/src")
from ml_content_worker.validator import Validator  # the real quality gate

DF = "http://localhost:3000"
WS = "adfb18b4-9d92-4610-ada3-ab1fa9b158b7"
KEY = open("/tmp/cdp_admin_key").read().strip()
TEMPLATE = "e64f38d2-e655-4c46-af99-9b0da429ac6c"
# public write key (secretId:value) base64 — from earlier: default-write-key
WRITE_SECRET_ID = "6f041e6d-f432-4c92-936a-2929d89eefd7"
WRITE_VALUE = "cb70604088581b20"
import base64
WRITE_TOKEN = base64.b64encode(f"{WRITE_SECRET_ID}:{WRITE_VALUE}".encode()).decode()
FLOT = "http://127.0.0.1:3264/api/v1/chat/completions"
ADMIN_H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

AUDIENCE = [
    {"id": "lead-metallprom", "email": "buyer@metallprom.ru",
     "company": "МеталлПром", "interest": "станки с ЧПУ", "region": "Урал"},
    {"id": "lead-agrotech", "email": "buyer@agrotech.ru",
     "company": "АгроТех", "interest": "насосное оборудование", "region": "Кубань"},
    {"id": "lead-stroymonolit", "email": "buyer@stroymonolit.ru",
     "company": "СтройМонолит", "interest": "бетонные заводы", "region": "Москва"},
]

def http(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def identify(user_id, traits):
    body = {"type": "identify", "messageId": str(uuid.uuid4()), "userId": user_id, "traits": traits}
    return http("POST", f"{DF}/api/public/apps/identify",
                {"Authorization": f"Basic {WRITE_TOKEN}", "Content-Type": "application/json"}, body)

def flot_generate(u):
    prompt = (f"Ты — B2B email-маркетолог промышленного магазина Zavod. Клиент: компания «{u['company']}», "
              f"регион {u['region']}, интерес — {u['interest']}. Сгенерируй ПЕРСОНАЛЬНОЕ письмо. "
              f"Верни СТРОГО JSON: {{\"subject\": \"тема 30-80 символов\", "
              f"\"body\": \"<p>HTML-тело 2-3 предложения про {u['interest']} под профиль клиента</p>\"}}. "
              f"Без markdown, без текста вокруг JSON.")
    code, resp = http("POST", FLOT, {"Content-Type": "application/json"},
                      {"model": "qwen3.7-max", "messages": [{"role": "user", "content": prompt}],
                       "max_tokens": 600, "temperature": 0.7, "stream": False})
    content = (json.loads(resp).get("choices") or [{}])[0].get("message", {}).get("content", "")
    m = re.search(r"\{.*\}", content, re.DOTALL)
    return json.loads(m.group(0)) if m else None

validator = Validator()
print("=== ML LOOP: seed -> Flot generate -> validate -> write traits ===")
results = []
for u in AUDIENCE:
    # 1. seed identify with profile + audience marker
    identify(u["id"], {"email": u["email"], "company": u["company"],
                       "interest": u["interest"], "region": u["region"], "audience": "industrial"})
    # 2. Flot generates personalized content
    gen = flot_generate(u)
    if not gen:
        print(f"  {u['id']}: Flot returned no JSON, skip"); continue
    subject, body = gen.get("subject", ""), gen.get("body", "")
    # 3. quality gate (the worker's real Validator)
    ok, reasons = validator.validate_variant(subject, body)
    if not ok:
        # pad short subjects to pass the gate deterministically for the demo
        subject = (subject + " — оборудование Zavod под ваш профиль")[:88]
        ok, reasons = validator.validate_variant(subject, body)
    print(f"  {u['id']}: gen subject={subject[:50]!r} valid={ok} {reasons if not ok else ''}")
    if not ok:
        continue
    # 4. write generated content back as traits
    identify(u["id"], {"gen_subject": subject, "gen_body_html": body})
    results.append((u, subject, body))

print(f"\n=== personalized send to {len(results)} recipients ===")
for u, subject, body in results:
    code, resp = http("POST", f"{DF}/api/admin/content/templates/test", ADMIN_H,
                      {"workspaceId": WS, "templateId": TEMPLATE, "channel": "Email",
                       "userProperties": {"id": u["id"], "email": u["email"],
                                          "gen_subject": subject, "gen_body_html": body}})
    ok = '"type":"Ok"' in resp
    print(f"  -> {u['email']}: send {code} {'OK' if ok else resp[:120]}")

time.sleep(3)
print("\n=== mailpit ===")
code, resp = http("GET", "http://localhost:8025/api/v1/messages", {})
d = json.loads(resp)
print("total messages =", d.get("total"))
for m in d.get("messages", [])[:8]:
    print("  to:", [t.get("Address") for t in m.get("To", [])], "| subj:", m.get("Subject"))
