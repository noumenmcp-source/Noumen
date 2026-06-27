#!/usr/bin/env python3
"""Idempotent welcome journey for zavod.dev (VERIFIED live 2026-06-19):
segment entry (all-storefront) -> Email (zavod-welcome) -> Exit, set Running.
Run after setup_zavod_workspace.py (needs the segment + template to exist)."""
import json, os, urllib.request, urllib.error, uuid

DF = os.getenv("DITTOFEED_API", "http://localhost:3000")
KEY = os.getenv("DITTOFEED_ADMIN_KEY")
WS = os.getenv("WORKSPACE_ID", "adfb18b4-9d92-4610-ada3-ab1fa9b158b7")
EMAIL_GROUP = os.getenv("EMAIL_SUBSCRIPTION_GROUP", "8b4c6d7e-c297-5fb2-aa6c-7ca2cddeb781")
H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
NS = uuid.UUID("00000000-0000-0000-0000-00000000ca90")


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(DF + path, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as x:
            return x.status, x.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def find(path, key, name):
    _, body = req("GET", f"{path}?workspaceId={WS}")
    d = json.loads(body)
    items = d if isinstance(d, list) else d.get(key, [])
    m = [i for i in items if i.get("name") == name]
    return m[0]["id"] if m else None


segment = find("/api/admin/segments/", "segments", "all-storefront")
template = find("/api/admin/content/templates", "templates", "zavod-welcome")
if not (segment and template):
    raise SystemExit(f"missing segment/template (segment={segment}, template={template}) — run setup_zavod_workspace.py first")

msg_id = str(uuid.uuid4())
definition = {
    "entryNode": {"type": "EntryNode", "segment": segment, "child": msg_id},
    "nodes": [{
        "id": msg_id, "type": "MessageNode", "name": "Welcome email",
        "subscriptionGroupId": EMAIL_GROUP,
        "variant": {"type": "Email", "templateId": template},
        "child": "ExitNode",
    }],
    "exitNode": {"type": "ExitNode"},
}
journey_id = str(uuid.uuid5(NS, "zavod-welcome-journey"))
code, body = req("PUT", "/api/admin/journeys/", {
    "workspaceId": WS, "id": journey_id, "name": "zavod-welcome-journey",
    "definition": definition, "status": "Running",
})
print(f"welcome journey -> {code} (status Running) id={journey_id}")
