#!/usr/bin/env python3
"""
provision_site.py — idempotent "onboard a new site" tool for the multi-tenant CDP.

THE ISOLATION SPINE (do not deviate):
  1 site  ==  1 Dittofeed WORKSPACE  (Dittofeed isolates profiles/events/segments/journeys
              natively by workspaceId — this is the hard boundary).
  1 site  ==  1 Elasticsearch raw index  (cdp_events_<siteId>).
  1 site  ==  1 gateway write-key (wk_<siteId>) that the ingest-gateway resolves to a TENANT:
              { siteId, writeKey, workspaceId, dittofeedWriteKey, esIndex, allowedOrigins }.

This script provisions all of that and UPSERTs the tenant row into tenants.json. Re-running it
against an already-provisioned site is safe (idempotent): existing resources are detected and
reused, deterministic uuid5 ids are used wherever a stable id is possible.

------------------------------------------------------------------------------------------------
WHY SOME STEPS GO THROUGH POSTGRES (verified against the live dittofeed-lite stack, 2026-06-19):
  - Dittofeed-lite exposes NO REST/CLI flow to create a WORKSPACE. Every candidate admin path
    (/api/admin/workspaces, /settings/workspaces, ...) returns 404. The Default workspace and the
    bootstrap admin key are seeded directly in Postgres (see deploy/DEPLOY_DITTOFEED_PERMANENT.md).
    => We create the new Workspace row in Postgres.
  - The Dittofeed admin API key is STRICTLY PER-WORKSPACE. The Default-scoped --admin-key returns
    401 ("API key not valid") for ANY other workspaceId. So a freshly-created workspace needs its
    OWN AdminApiKey before the admin API can touch it.
    => We mint a per-workspace admin key in Postgres (same shape deploy doc step 2a uses).
  - Once the per-workspace admin key exists, these admin endpoints DO work and ARE idempotent:
        PUT /api/admin/settings/write-keys      -> 204  (create/ensure public write key by name)
        GET /api/admin/settings/write-keys      -> 200  ([{writeKeyName,writeKeyValue,secretId,...}])
        PUT /api/admin/subscription-groups      -> 200  (ensure a Default Email subscription group)
    => We use the admin API (not raw SQL) for write-keys and the subscription group, so we ride
       Dittofeed's own validators/side-effects rather than hand-rolling secret rows.

Postgres access mirrors the existing scripts (scripts/launch_test.sh,
deploy/DEPLOY_DITTOFEED_PERMANENT.md): we shell out to `docker exec <container> psql ...`.
Override the container/db/user with --pg-container / --pg-db / --pg-user if your stack differs.
------------------------------------------------------------------------------------------------

USAGE:
  python3 scripts/provision_site.py \\
      --site acme \\
      --admin-base http://localhost:3000 \\
      --admin-key  <bootstrap/Default admin Bearer token> \\
      --es-url     http://127.0.0.1:9200 \\
      --origins    https://acme.com,https://*.acme.com

  # --admin-key is the EXISTING (Default-workspace) admin token. It is used only as the SQL
  # gateway is unavailable through it — actually it is NOT needed for the admin API calls (those
  # use the freshly-minted per-workspace key). It is accepted for parity with the other scripts and
  # to verify connectivity / pre-flight the admin base. The real per-workspace key is generated here.

DEPENDENCIES: stdlib only (urllib, json, uuid, subprocess, argparse). No third-party packages.
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

# Deterministic-id namespace so re-runs reproduce the same ids (idempotency).
NS = uuid.UUID("c0ffee00-cafe-4bad-9000-1deafeed1dea")

# Path to the gateway's multi-tenant config that this script UPSERTs into.
TENANTS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "services", "ingest-gateway-prod", "tenants.json"))


# ----------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------
def log(step, msg):
    print(f"  [{step}] {msg}")


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def http(method, url, key=None, body=None, timeout=30):
    """Minimal urllib JSON client — same pattern as scripts/p1_load_all_triggers.py.

    Returns (status_code, parsed_json_or_text). Never raises on non-2xx (returns the code so
    callers can branch); transport errors (host down/refused/timeout) are reported via die().
    """
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.getcode(), json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return r.getcode(), raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        # Non-2xx with a body: return the code so callers can branch (this is not a transport error).
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return e.code, raw.decode("utf-8", "replace")
    except urllib.error.URLError as e:
        # Transport error (host down, refused, DNS, timeout) — report cleanly, no stack trace.
        die(f"cannot reach {url}: {e.reason}")


def es_request(method, es_url, path, body=None, timeout=30):
    """Talk to Elasticsearch (no auth assumed — same as the in-box es-test)."""
    return http(method, f"{es_url.rstrip('/')}{path}", key=None, body=body, timeout=timeout)


def psql(args, sql):
    """Run a single SQL statement inside the Dittofeed Postgres container and return stdout.

    Uses `docker exec -i ... psql -tAc` exactly like deploy/DEPLOY_DITTOFEED_PERMANENT.md and
    scripts/launch_test.sh. `-i` is required so stdin/quoting behaves; `-tA` gives tuples-only,
    unaligned output; we pass the SQL via -c.
    """
    cmd = [
        "docker", "exec", "-i", args.pg_container,
        "psql", "-U", args.pg_user, "-d", args.pg_db, "-tAc", sql,
    ]
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60
        )
    except FileNotFoundError:
        die("`docker` not found on PATH — needed to reach the Dittofeed Postgres container.")
    except subprocess.TimeoutExpired:
        die("psql command timed out (is the postgres container up?).")
    if out.returncode != 0:
        die(
            "psql failed:\n"
            f"  cmd: {' '.join(cmd[:7])} ...\n"
            f"  stderr: {out.stderr.strip()}"
        )
    return out.stdout.strip()


def sql_lit(value):
    """Escape a Python string for safe inlining as a single-quoted SQL literal."""
    return "'" + str(value).replace("'", "''") + "'"


# ----------------------------------------------------------------------------------------------
# step 1 — create/ensure the Dittofeed WORKSPACE (Postgres; no REST flow exists in lite)
# ----------------------------------------------------------------------------------------------
def ensure_workspace(args):
    """Create (or detect) a Root workspace named <siteId>. Returns its workspaceId (uuid)."""
    name = args.site
    existing = psql(args, f'select id from "Workspace" where name={sql_lit(name)} limit 1;')
    if existing:
        log("workspace", f"exists: {name} -> {existing}")
        return existing

    # Deterministic id so a re-run (after, say, a partial failure that left no row) is stable.
    ws_id = str(uuid.uuid5(NS, f"ws-{name}"))
    psql(
        args,
        'insert into "Workspace"(id, name, type, status) '
        f"values ({sql_lit(ws_id)}, {sql_lit(name)}, 'Root', 'Active') "
        "on conflict (id) do nothing;",
    )
    # Read back (covers the race where the id pre-existed under a different name, etc.).
    ws_id = psql(args, f'select id from "Workspace" where name={sql_lit(name)} limit 1;')
    if not ws_id:
        die(f"failed to create workspace {name}")
    log("workspace", f"created: {name} -> {ws_id}")
    return ws_id


# ----------------------------------------------------------------------------------------------
# step 1b — mint a PER-WORKSPACE admin key (Postgres). Required: the admin API key is
#           strictly per-workspace, so we cannot reuse the Default --admin-key for the new ws.
# ----------------------------------------------------------------------------------------------
def ensure_workspace_admin_key(args, ws_id):
    """Ensure an AdminApiKey for this workspace and return its raw Bearer token (64 hex).

    Mirrors deploy doc step 2a: the key lives in Secret.configValue (jsonb) as
    {type:'AdminApiKey', key:<hex>, permissions:['Admin']}, linked from an AdminApiKey row.
    Idempotent: if a 'cdp-admin' key already exists for this workspace we read and reuse it.
    """
    secret_name = "cdp-admin-secret"
    # Reuse if present — read the existing key value out of configValue.
    existing = psql(
        args,
        "select \"configValue\"->>'key' from \"Secret\" "
        f"where name={sql_lit(secret_name)} and \"workspaceId\"={sql_lit(ws_id)} "
        "and \"configValue\"->>'type'='AdminApiKey' limit 1;",
    )
    if existing:
        log("admin-key", "per-workspace admin key exists (reused)")
        return existing

    # Deterministic 64-hex key derived from the workspace id (so re-mints are reproducible).
    key = uuid.uuid5(NS, f"adminkey-{ws_id}").hex + uuid.uuid5(NS, f"adminkey2-{ws_id}").hex
    secret_id = str(uuid.uuid5(NS, f"adminsecret-{ws_id}"))
    apikey_id = str(uuid.uuid5(NS, f"adminapikey-{ws_id}"))

    psql(
        args,
        # 1) the Secret holding the AdminApiKey definition (all three fields required or 401).
        'insert into "Secret"(id, "workspaceId", name, "configValue") values ('
        f"{sql_lit(secret_id)}, {sql_lit(ws_id)}, {sql_lit(secret_name)}, "
        "jsonb_build_object('type','AdminApiKey','key'," + sql_lit(key)
        + ",'permissions',jsonb_build_array('Admin'))) on conflict (id) do nothing; "
        # 2) the AdminApiKey row pointing at that Secret.
        'insert into "AdminApiKey"(id, "workspaceId", name, "secretId") values ('
        f"{sql_lit(apikey_id)}, {sql_lit(ws_id)}, 'cdp-admin', {sql_lit(secret_id)}) "
        "on conflict (id) do nothing; "
        # 3) re-assert the configValue in case the Secret pre-existed with a stale shape.
        'update "Secret" set "configValue"=jsonb_build_object('
        "'type','AdminApiKey','key'," + sql_lit(key)
        + ",'permissions',jsonb_build_array('Admin')) "
        f"where id={sql_lit(secret_id)};",
    )
    log("admin-key", "per-workspace admin key minted")
    return key


# ----------------------------------------------------------------------------------------------
# step 1c — ensure a Default Email subscription group (needed by p1_load_all_triggers.py)
# ----------------------------------------------------------------------------------------------
def ensure_subscription_group(args, ws_id, ws_admin_key):
    """Ensure a Default Email OptOut subscription group exists in the new workspace.

    p1_load_all_triggers.py wires every journey's MessageNode to a subscription group; a fresh
    workspace has none, so we seed one. Uses the admin API (validated side-effects) with the
    per-workspace key. Deterministic id => idempotent.
    """
    sg_id = str(uuid.uuid5(NS, f"sg-email-{ws_id}"))
    code, _ = http(
        "PUT",
        f"{args.admin_base.rstrip('/')}/api/admin/subscription-groups",
        key=ws_admin_key,
        body={
            "workspaceId": ws_id,
            "id": sg_id,
            "name": "Default - Email",
            "type": "OptOut",
            "channel": "Email",
        },
    )
    ok = code in (200, 201, 204)
    log("sub-group", f"Default - Email {'ok' if ok else f'WARN http {code}'} ({sg_id})")
    return sg_id


# ----------------------------------------------------------------------------------------------
# step 2 — create/ensure the public write key; return raw "secretId:value"
# ----------------------------------------------------------------------------------------------
def ensure_dittofeed_write_key(args, ws_id, ws_admin_key):
    """Ensure a public write key named 'default-write-key' and return raw 'secretId:value'.

    PUT is idempotent by name (204 whether it created or already existed). We then GET the list
    and select our key to capture the secretId+value pair the gateway forwards with (Basic auth,
    base64 done by the gateway itself).
    """
    base = args.admin_base.rstrip("/")
    name = "default-write-key"

    code, _ = http(
        "PUT",
        f"{base}/api/admin/settings/write-keys",
        key=ws_admin_key,
        body={"workspaceId": ws_id, "writeKeyName": name},
    )
    if code not in (200, 201, 204):
        die(f"write-key PUT failed (http {code}) — check the per-workspace admin key/base url")

    code, data = http(
        "GET",
        f"{base}/api/admin/settings/write-keys?workspaceId={ws_id}",
        key=ws_admin_key,
    )
    if code != 200 or not isinstance(data, list):
        die(f"write-key GET failed (http {code})")

    row = next((r for r in data if r.get("writeKeyName") == name), None) or (data[0] if data else None)
    if not row:
        die("no write key returned after PUT")
    pair = f"{row['secretId']}:{row['writeKeyValue']}"
    log("write-key", f"dittofeed write key ready ({row['secretId']}:****)")
    return pair


# ----------------------------------------------------------------------------------------------
# step 3 — create/ensure the per-tenant Elasticsearch raw index
# ----------------------------------------------------------------------------------------------
# Explicit mapping matching the fixed ES doc shape the gateway writes (server.js toEsDoc):
#   {ts,write_key,anonymous_id,user_id,type,event,properties,traits_present,ip,ua,origin}
ES_MAPPING = {
    "mappings": {
        "properties": {
            "ts": {"type": "date"},
            "write_key": {"type": "keyword"},
            "anonymous_id": {"type": "keyword"},
            "user_id": {"type": "keyword"},
            "type": {"type": "keyword"},
            "event": {"type": "keyword"},
            # free-form event/trait payload — kept queryable but not indexed-per-field by default
            "properties": {"type": "object", "enabled": True},
            "traits_present": {"type": "boolean"},
            "ip": {"type": "ip"},
            "ua": {"type": "text"},
            "origin": {"type": "keyword"},
        }
    }
}


def ensure_es_index(args, es_index):
    """PUT cdp_events_<siteId> with the mapping. Idempotent: a pre-existing index is fine."""
    es_url = args.es_url.rstrip("/")
    code, _ = es_request("GET", es_url, f"/{es_index}")
    if code == 200:
        log("es-index", f"exists: {es_index}")
        return
    code, data = es_request("PUT", es_url, f"/{es_index}", body=ES_MAPPING)
    if code in (200, 201):
        log("es-index", f"created: {es_index}")
        return
    # Treat "already exists" as success (race / re-run).
    err_type = ""
    if isinstance(data, dict):
        err_type = (data.get("error") or {}).get("type", "") if isinstance(data.get("error"), dict) else ""
    if code == 400 and "resource_already_exists" in str(err_type):
        log("es-index", f"exists (race): {es_index}")
        return
    die(f"ES index PUT failed (http {code}): {data}")


# ----------------------------------------------------------------------------------------------
# step 5 — UPSERT the tenant into tenants.json
# ----------------------------------------------------------------------------------------------
def upsert_tenant(tenant):
    """Read tenants.json (a list), replace the row with the same siteId or append, write back.

    Atomic-ish: write to a temp file then os.replace. Pretty-printed for human review/PRs.
    """
    # Canonical registry format is { "tenants": [ {...}, ... ] } — the same shape
    # lib/registry.js reads. Tolerate a bare list / dict-of-objects on read.
    tenants = []
    if os.path.exists(TENANTS_PATH):
        try:
            with open(TENANTS_PATH, "r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict) and isinstance(loaded.get("tenants"), list):
                tenants = loaded["tenants"]
            elif isinstance(loaded, list):
                tenants = loaded
            elif isinstance(loaded, dict):
                # tolerate a dict-shaped file: {siteId: {...}} — normalise to a list
                tenants = list(loaded.values())
        except (json.JSONDecodeError, OSError) as e:
            die(f"could not read existing tenants.json: {e}")

    tenants = [t for t in tenants if t.get("siteId") != tenant["siteId"]]
    tenants.append(tenant)
    tenants.sort(key=lambda t: t.get("siteId", ""))

    tmp = TENANTS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"tenants": tenants}, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, TENANTS_PATH)
    log("tenants", f"upserted {tenant['siteId']} -> {TENANTS_PATH} ({len(tenants)} tenants)")


def ensure_user_properties(args, ws_id):
    """Copy the default user-property set (id, email, anonymousId, ...) into the new workspace.

    A workspace created via SQL/admin API (not the dashboard's bootstrap) ships with NO user
    properties, so computed-property recompute has nothing to materialise and /api/admin/users
    stays empty. We clone the definitions from the Default workspace (the one bootstrap created),
    giving each a fresh id. Idempotent: skips if the target already has user properties.
    """
    have = psql(args, f"SELECT count(*) FROM \"UserProperty\" WHERE \"workspaceId\"='{ws_id}';")
    if have and have.isdigit() and int(have) > 0:
        log("user-props", f"already present ({have}) — skip")
        return
    default_ws = psql(args, "SELECT id FROM \"Workspace\" WHERE name='Default' ORDER BY \"createdAt\" LIMIT 1;")
    if not default_ws:
        log("user-props", "WARN no Default workspace to clone from — skipped")
        return
    psql(args,
        "INSERT INTO \"UserProperty\" (id, \"workspaceId\", name, definition, \"createdAt\", "
        "\"updatedAt\", \"definitionUpdatedAt\", \"resourceType\") "
        f"SELECT gen_random_uuid(), '{ws_id}', name, definition, now(), now(), now(), \"resourceType\" "
        f"FROM \"UserProperty\" WHERE \"workspaceId\"='{default_ws}' ON CONFLICT DO NOTHING;")
    cnt = psql(args, f"SELECT count(*) FROM \"UserProperty\" WHERE \"workspaceId\"='{ws_id}';")
    log("user-props", f"cloned from Default -> {cnt} user properties")


def ensure_compute_workflow(args, ws_id):
    """Start the per-workspace computed-properties Temporal workflow so segments/profiles compute.

    A provisioned workspace has no compute-properties workflow until one is started; without it
    trigger-recompute returns 500 (WorkflowNotFoundError) and nothing materialises. The admin-cli
    `reset-compute-properties` (re)starts it. The cli lives INSIDE the lite image, so we exec it
    there (the standalone admin-cli image is optional/unavailable in some networks).
    """
    cmd = [
        "docker", "exec", args.lite_container,
        "node", "packages/admin-cli/dist/scripts/cli.js",
        "reset-compute-properties", "-w", ws_id,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        log("compute-wf", f"WARN could not start workflow ({e}) — run reset-compute-properties manually")
        return
    if "Reset computed properties workflow" in (out.stdout + out.stderr):
        log("compute-wf", "computed-properties workflow started (Active)")
    else:
        log("compute-wf", f"WARN unexpected output — check manually: {out.stderr.strip()[:120]}")


# ----------------------------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Idempotently onboard a new site (1 site = 1 workspace + 1 ES index + 1 tenant)."
    )
    p.add_argument("--site", required=True, help="siteId (also the Dittofeed workspace name)")
    p.add_argument("--admin-base", required=True, help="Dittofeed base url, e.g. http://localhost:3000")
    p.add_argument("--admin-key", required=True, help="existing (Default-workspace) admin Bearer token")
    p.add_argument("--es-url", required=True, help="Elasticsearch base url, e.g. http://127.0.0.1:9200")
    p.add_argument("--origins", default="", help="comma-separated allowed CORS origins (exact or *.wildcard)")
    # Postgres access for the workspace + admin-key steps (no REST flow exists for those in lite).
    p.add_argument("--pg-container", default="dittofeed-postgres-1", help="Dittofeed Postgres container name")
    p.add_argument("--lite-container", default="cdp-lite-1", help="Dittofeed lite container (hosts admin-cli)")
    p.add_argument("--pg-db", default="dittofeed", help="Postgres database name")
    p.add_argument("--pg-user", default="postgres", help="Postgres user")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    site = args.site.strip()
    if not site:
        die("--site must be non-empty")

    es_index = f"cdp_events_{site}"
    gateway_write_key = f"wk_{site}"
    allowed_origins = [o.strip() for o in args.origins.split(",") if o.strip()]

    print(f"\n=== provisioning site '{site}' ===\n")

    # (pre-flight) sanity-check the admin base is reachable at all.
    code, _ = http("GET", f"{args.admin_base.rstrip('/')}/api", key=args.admin_key)
    # Any HTTP response (even 404) proves the base is up; transport errors already raised above.

    # 1) Dittofeed workspace (Postgres) + per-workspace admin key (Postgres) + sub group (admin API)
    ws_id = ensure_workspace(args)
    ws_admin_key = ensure_workspace_admin_key(args, ws_id)
    ensure_subscription_group(args, ws_id, ws_admin_key)

    # 2) public write key (admin API) -> raw "secretId:value"
    dittofeed_write_key = ensure_dittofeed_write_key(args, ws_id, ws_admin_key)

    # 3) per-tenant ES raw index
    ensure_es_index(args, es_index)

    # 3b) default user properties (id/email/...) + start the compute-properties workflow,
    #     so the new site has live segments/profiles immediately (not a bare workspace).
    ensure_user_properties(args, ws_id)
    ensure_compute_workflow(args, ws_id)

    # 4) gateway write key is derived from the siteId
    log("gateway-key", f"gateway write key: {gateway_write_key}")

    # 5) UPSERT the tenant row (the gateway resolves x-write-key -> this exact record)
    tenant = {
        "siteId": site,
        "writeKey": gateway_write_key,
        "workspaceId": ws_id,
        "dittofeedWriteKey": dittofeed_write_key,
        "esIndex": es_index,
        "allowedOrigins": allowed_origins,
    }
    upsert_tenant(tenant)

    # 6) next step
    print("\n=== done ===")
    print("NEXT STEP — load the 21 triggers into this workspace:\n")
    print(
        f"  DITTOFEED_API={args.admin_base.rstrip('/')} \\\n"
        f"  DITTOFEED_ADMIN_KEY={ws_admin_key} \\\n"
        f"  WORKSPACE_ID={ws_id} \\\n"
        f"  python3 scripts/p1_load_all_triggers.py\n"
    )
    print("(use the PER-WORKSPACE admin key above — the Default --admin-key is rejected cross-workspace)\n")


if __name__ == "__main__":
    main()
