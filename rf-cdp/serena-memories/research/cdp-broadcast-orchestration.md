# Dittofeed native segment+broadcast orchestration — PROVEN (2026-06-19)

Closes the loop natively (not per-user test-send). Companion to `mem:research/cdp-dittofeed-admin-recipe`.

## Full automated loop proven end-to-end
1. Seed users via public identify with a marker trait `audience="industrial"` + profile traits.
2. ML loop (`scripts/cdp_ml_loop.py`): Flot (qwen3.7-max) generates per-user subject+body ->
   `ml_content_worker.validator.Validator` gate -> write gen_subject/gen_body_html back via identify.
3. Segment (`scripts/cdp_broadcast.py`): `PUT /api/admin/segments/` with
   `definition:{entryNode:{type:"Trait", id:<uuid>, path:"audience", operator:{type:"Equals", value:"industrial"}}, nodes:[]}`.
4. `POST /api/admin/computed-properties/trigger-recompute {workspaceId}` -> segment populates in ~6s
   (async Temporal). Check membership: `POST /api/admin/users {workspaceId, segmentFilter:[segmentId]}`.
   -> got 3 members.
5. Broadcast (`scripts/cdp_broadcast2.py`): `PUT /api/admin/broadcasts/v2` with
   `{workspaceId, id, name, segmentId, messageTemplateId, config:{type:"V2", message:{type:"Email",
   providerOverride:"Smtp"}, errorHandling:"SkipOnError", batchSize:10, rateLimit:100}}`.
6. `POST /api/admin/broadcasts/start {workspaceId, broadcastId}` -> "Broadcast started".
7. Result: mailpit 4 -> 7, each segment member got THEIR personalized email (gen_subject rendered
   per-member from stored traits). No subscriptionGroupId needed for the send to go through.

## Key facts
- SegmentNodeType: Trait/And/Or/Performed/Manual/Everyone/... ; SegmentOperatorType: Equals/NotEquals/Exists/...
- Segment membership is computed async (Temporal worker) — must trigger-recompute and poll, not instant.
- Broadcast v2 renders each member's stored user-property traits through the template's Liquid -> true
  per-recipient personalization at the orchestration layer.

## State after this milestone
Overall ~58% of target; ~80% of Stage 0. The core product loop (audience -> per-recipient AI content ->
validated -> segment broadcast -> personalized delivery) is fully proven natively on a self-hosted stack.
Remaining: multi-tenant (OIDC), prod ESP (SES/Resend + DKIM), ingest-gateway as a running service,
deliverability hardening (suppression/unsubscribe/warming), sklearn micro-segment clustering in the worker.
