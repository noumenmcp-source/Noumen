# Dittofeed welcome journey — verified live (2026-06-19)

Auto-send on segment entry. Companion to `mem:research/cdp-dittofeed-admin-recipe`.

## Schema (introspected from container types)
JourneyDefinition = { entryNode, exitNode, nodes }.
- entryNode (SegmentEntryNode): `{type:"EntryNode", segment:<segmentId>, child:<nextNodeId>}`.
  (Event entry variant exists too: `{type:"EventEntryNode", event, key, child}`.)
- nodes[]: MessageNode `{id, type:"MessageNode", name, subscriptionGroupId, variant:{type:"Email",
  templateId}, child}`. Other node types: DelayNode, SegmentSplitNode, RateLimitNode, RandomCohortNode.
- exitNode: `{type:"ExitNode"}` — referenced by a node's `child:"ExitNode"` (literal string).

## Create + publish (VERIFIED -> 200)
`PUT /api/admin/journeys/` body:
```
{ workspaceId, id, name, definition:{...as above...}, status:"Running" }
```
PUT defaults to status NotStarted; include `status:"Running"` (or re-PUT) to publish — confirmed it
flips NotStarted -> Running. Journey then fires when a user ENTERS the segment.

## zavod welcome journey (live)
entry: segment `all-storefront` -> MessageNode Email (template `zavod-welcome`, subscriptionGroup
Default-Email `8b4c6d7e-...`) -> ExitNode. Script: `scripts/setup_zavod_journey.py` (idempotent, uuid5 id).
Note: real sends still gated by Resend domain (only owner address until mail.zavod.dev verified).
