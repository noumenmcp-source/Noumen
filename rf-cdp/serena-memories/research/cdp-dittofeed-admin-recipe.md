# Dittofeed full-role recipe — proven live (2026-06-19)

Hard-won operational knowledge for driving a self-hosted Dittofeed (lite v0.23.0) via Admin API.
Companion to `mem:research/cdp-runtime-verified`.

## Admin API key — how to mint by hand (no dashboard/CLI)
Admin key is stored in `Secret.configValue` (jsonb), NOT `Secret.value`. Required shape
(validated by `AdminApiKeyDefinition` — ALL THREE fields required, missing `permissions` => silent 401):
```
configValue = {"type":"AdminApiKey","key":"<64-hex>","permissions":["Admin"]}
```
The Bearer token = the raw `key` value (NOT base64). SQL:
```sql
-- create Secret + AdminApiKey rows (workspaceId = Default Root workspace), then:
UPDATE "Secret" SET "configValue" = jsonb_build_object(
  'type','AdminApiKey','key','<64hex>','permissions',jsonb_build_array('Admin'))
WHERE "name"='cdp-admin-secret';
```
Header: `Authorization: Bearer <64hex>`. Workspace passed as `?workspaceId=` query param.
NOTE: `docker exec -i` is REQUIRED for psql heredocs (without -i no stdin -> silently no-op).
NOTE: pgcrypto absent -> use md5(random()::text) not gen_random_bytes.

## OpenAPI
Full live spec at `GET http://localhost:3000/documentation/json` (149 paths). Use it as the contract.

## Public write key (events) recap
Auth = `Authorization: Basic base64("<secretId>:<secretValue>")` sent VERBATIM. secretId must be uuid.

## Full-role build sequence (all returned 2xx, email landed in mailpit)
1. `PUT /api/admin/user-properties/`  body {workspaceId,id(uuid),name,definition:{type:"Trait",path:"gen_subject"}}.
   Create gen_subject, gen_body_html. Only DECLARED user properties resolve in templates.
2. `PUT /api/admin/content/templates` body {workspaceId,id,name,definition:{type:"Email",from,subject,body,
   emailContentsType:"Code"}}. emailContentsType MUST be "Code" or "LowCode" (NOT "Mjml"); "Code" body
   accepts MJML and is compiled to HTML on render. ChannelType.Email="Email".
   Name must be unique per workspace (reuse id to update; new id+same name => 400).
3. `PUT /api/admin/settings/email-providers` body {workspaceId,setDefault:true,
   config:{type:"Smtp",host:"cdp-mailpit",port:"1025",username:"",password:""}}. Providers also: AmazonSes,
   Postmark, SendGrid, Resend, Test, Gmail, MailChimp.
4. `POST /api/admin/content/templates/test` body {workspaceId,templateId,channel:"Email",userProperties:{...}}.
   Renders + sends via default provider.

## Liquid strict-mode gotcha (the last blocker)
Template referenced {{ catalog_url }} / {{ unsubscribe_url }} which are NOT declared user properties ->
"undefined variable" render error under strictVariables. Fix: `{{ catalog_url | default: "..." }}` —
liquidjs allows undefined immediately before the `default` filter. gen_subject/gen_body_html resolved
fine because they ARE declared user properties.

## Local send proof without an ESP
Run mailpit on the dittofeed network: `docker run -d --name cdp-mailpit --network dittofeed-network-lite
-p 8025:8025 -p 1025:1025 axllent/mailpit`. SMTP host inside compose net = `cdp-mailpit:1025`.
Read via `GET http://localhost:8025/api/v1/messages` and `/api/v1/message/<id>` (HTML field).

## PROVEN (2026-06-19)
Flot MJML template + user properties + SMTP provider -> test send 200 (DFInternalMessageSent, Smtp) ->
mailpit got 1 email: subject="<gen_subject>" rendered, body contained gen_body_html + brand + CTA + catalog_url.
The core product value (personalized email rendered & sent) works end to end.

## Still creds-gated / not done
- Multi-tenant (AUTH_MODE=multi-tenant) needs an OIDC provider — deferred.
- Production ESP (SES/Resend) needs real credentials + per-tenant domain/DKIM.
- Segment + journey/broadcast (automated send) not yet built — only one-off test send proven.
- Helper script: `scripts/dittofeed_full_role.py`.
