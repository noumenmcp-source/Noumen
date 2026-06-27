#!/usr/bin/env python3
"""P1 — загружает все 21 триггер-шаблон + segments + journeys в Dittofeed.
Usage: DITTOFEED_ADMIN_KEY=... WORKSPACE_ID=... python3 p1_load_all_triggers.py
"""
import os
import json, os, re, uuid, sys, urllib.request, urllib.error

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "services", "dittofeed-assets"))
API  = os.getenv("DITTOFEED_API", "http://localhost:3000")
KEY  = os.getenv("DITTOFEED_ADMIN_KEY")
WS   = os.getenv("WORKSPACE_ID")
NS   = uuid.NAMESPACE_DNS

THEMES  = json.load(open(f"{ROOT}/themes/themes.json"))["themes"]
CATALOG = json.load(open(f"{ROOT}/campaigns-catalog.json"))
MASTER  = open(f"{ROOT}/templates/master-marketing.liquid.html").read()
MASTER_TXN = open(f"{ROOT}/templates/master-transactional.liquid.html").read()

# D-group (transactional) uses separate master
TXN_SCENARIOS = {"order_confirmation", "payment_received", "shipping_delivery",
                 "rfq_received", "return_refund"}

THEME_NAME = "zavod"

TOKENS = ["brand_name","tagline","font","accent","accent_text","ink","paper",
          "surface","border","muted","stat_num","stat_label","footer",
          "cta_url_default","img1","img2","img3"]

def api(method, path, body=None):
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data,
          headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
          method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.getcode(), json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}

def compile_template(scenario: str) -> tuple[str, str]:
    """Возвращает (html, subject) для сценария."""
    theme = THEMES[THEME_NAME]
    copy  = CATALOG.get(scenario, {})
    master = MASTER_TXN if scenario in TXN_SCENARIOS else MASTER
    # 1. вставить токены темы
    html = master
    for k in TOKENS:
        html = html.replace(f"__{k.upper()}__", str(theme.get(k, "")))
    # 2. вставить копи кампании
    accent_text = theme.get("accent_text", "#b3402c")
    heading = re.sub(r"\[\[(.+?)\]\]",
                     rf"<span style='color:{accent_text};'>\1</span>",
                     copy.get("heading", ""))
    for pat, val in [
        (r"\{\{\s*campaign_eyebrow[^}]*\}\}", copy.get("eyebrow", "")),
        (r"\{\{\s*campaign_heading[^}]*\}\}", heading),
        (r"\{\{\s*campaign_cta[^}]*\}\}", copy.get("cta", "")),
        (r"\{\{\s*user\.gen_subject[^}]*\}\}", "{{ user.gen_subject | default: '' }}"),
        (r"\{\{\s*user\.gen_body_html[^}]*\}\}", "{{ user.gen_body_html | default: '' }}"),
        (r"\{\{\s*catalog_url[^}]*\}\}", theme.get("cta_url_default", "#")),
        (r"\{\{\s*unsubscribe_url[^}]*\}\}", "{% unsubscribe_link %}"),
    ]:
        html = re.sub(pat, val, html)
    # оставить user.* liquid для Dittofeed runtime; убрать только технические заглушки
    subject_tpl = copy.get("subject", scenario)
    return html, subject_tpl

# Маппинг сценарий → тип сегмента для journey entry
SEGMENT_DEFS = {
    # trait-based: вошёл в сегмент по значению трейта
    "welcome":             ("trait", "audience", "Equals", "storefront"),
    "double_opt_in":       ("trait", "audience", "Equals", "storefront"),
    "onboarding_series":   ("trait", "audience", "Equals", "storefront"),
    "preferences":         ("trait", "audience", "Equals", "storefront"),
    # B nurture — triggered by event trait presence
    "browse_abandon":      ("trait", "last_category", "Exists", None),
    "new_arrivals":        ("trait", "section", "Exists", None),
    "category_digest":     ("trait", "section", "Exists", None),
    "price_drop":          ("trait", "last_category", "Exists", None),
    "back_in_stock":       ("trait", "last_category", "Exists", None),
    "wishlist_reminder":   ("trait", "last_category", "Exists", None),
    "recommendations":     ("trait", "audience", "Equals", "storefront"),
    # C conversion
    "abandoned_cart":      ("trait", "audience", "Equals", "storefront"),
    "abandoned_checkout":  ("trait", "audience", "Equals", "storefront"),
    "cart_change":         ("trait", "audience", "Equals", "storefront"),
    "abandoned_rfq":       ("trait", "company", "Exists", None),
    # D transactional — audience=storefront for now
    "order_confirmation":  ("trait", "audience", "Equals", "storefront"),
    "payment_received":    ("trait", "audience", "Equals", "storefront"),
    "shipping_delivery":   ("trait", "audience", "Equals", "storefront"),
    "rfq_received":        ("trait", "company", "Exists", None),
    "return_refund":       ("trait", "audience", "Equals", "storefront"),
    # E retention
    "review_request":      ("trait", "audience", "Equals", "storefront"),
    "cross_sell":          ("trait", "audience", "Equals", "storefront"),
    "replenishment":       ("trait", "audience", "Equals", "storefront"),
    "loyalty":             ("trait", "audience", "Equals", "storefront"),
    "win_back":            ("trait", "audience", "Equals", "storefront"),
    "anniversary":         ("trait", "audience", "Equals", "storefront"),
}

def segment_definition(scenario: str) -> dict:
    kind, path, op_type, val = SEGMENT_DEFS[scenario]
    operator = {"type": op_type}
    if val is not None:
        operator["value"] = val
    return {
        "entryNode": {
            "type": "Trait",
            "id": str(uuid.uuid5(NS, f"seg-node-{WS}-{scenario}")),
            "path": path,
            "operator": operator,
        },
        "nodes": []
    }

# Subscription group ID (Default-Email — уже существует)
SUB_GROUP_ID = "8b4c6d7e-0000-0000-0000-000000000001"

def find_or_use_sub_group():
    code, data = api("GET", f"/api/admin/subscription-groups?workspaceId={WS}")
    if code == 200 and isinstance(data, list) and data:
        return data[0].get("id", SUB_GROUP_ID)
    return SUB_GROUP_ID

results = {"ok": [], "fail": []}

def log(scenario, step, code):
    mark = "✅" if code in (200, 201, 204) else f"⚠️ {code}"
    print(f"  {mark} {scenario} / {step}")
    if code not in (200, 201, 204):
        results["fail"].append(f"{scenario}/{step}:{code}")
    else:
        results["ok"].append(f"{scenario}/{step}")

def main():
    if not KEY or not WS:
        print("ERROR: set DITTOFEED_ADMIN_KEY and WORKSPACE_ID"); sys.exit(1)

    print(f"\n📧 P1: загружаем {len(CATALOG)} триггеров в Dittofeed {API}\n")

    # Получаем реальный subscription group ID
    sub_group_id = find_or_use_sub_group()
    print(f"SubscriptionGroup: {sub_group_id}\n")

    for scenario in CATALOG:
        print(f"[{scenario}]")
        template_id = str(uuid.uuid5(NS, f"tpl-{WS}-{scenario}"))
        segment_id  = str(uuid.uuid5(NS, f"seg-{WS}-{scenario}"))
        journey_id  = str(uuid.uuid5(NS, f"jrn-{WS}-{scenario}"))
        msg_node_id = str(uuid.uuid5(NS, f"msg-{WS}-{scenario}"))

        # 1. Компилируем шаблон
        html, subject = compile_template(scenario)

        # 2. PUT шаблон
        code, _ = api("PUT", "/api/admin/content/templates", {
            "workspaceId": WS,
            "id": template_id,
            "name": scenario,
            "definition": {
                "type": "Email",
                "from": "Zavod.dev <hello@mail.zavod.dev>",
                "subject": subject,
                "body": html,
                "emailContentsType": "Code",
            }
        })
        log(scenario, "template", code)

        # 3. PUT сегмент
        code, _ = api("PUT", "/api/admin/segments/", {
            "workspaceId": WS,
            "id": segment_id,
            "name": f"seg-{WS}-{scenario}",
            "definition": segment_definition(scenario),
        })
        log(scenario, "segment", code)

        # 4. PUT journey (entry → message → exit)
        code, _ = api("PUT", "/api/admin/journeys/", {
            "workspaceId": WS,
            "id": journey_id,
            "name": f"jrn-{WS}-{scenario}",
            "definition": {
                "entryNode": {
                    "type": "EntryNode",
                    "segment": segment_id,
                    "child": msg_node_id,
                },
                "exitNode": {"type": "ExitNode"},
                "nodes": [{
                    "id": msg_node_id,
                    "type": "MessageNode",
                    "name": f"email-{scenario}",
                    "subscriptionGroupId": sub_group_id,
                    "variant": {"type": "Email", "templateId": template_id},
                    "child": "ExitNode",
                }],
            },
            "status": "Running",
        })
        log(scenario, "journey", code)
        print()

    print("\n" + "="*50)
    print(f"✅ ok: {len(results['ok'])}")
    if results["fail"]:
        print(f"⚠️  fail: {len(results['fail'])}")
        for f in results["fail"]: print(f"   - {f}")
    else:
        print("🎉 Все шаблоны и journeys загружены без ошибок!")

if __name__ == "__main__":
    main()
