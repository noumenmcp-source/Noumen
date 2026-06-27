# Suppression / unsubscribe — verified live (2026-06-19)

Companion to `mem:research/cdp-broadcast-orchestration`.

## Dittofeed subscription model (the reality, verified)
- NO bulk "list unsubscribed" endpoint. Suppression = per-user subscription to an Email
  subscription group (type OptOut → subscribed by default).
- Default groups (seeded): "Default - Email" id `8b4c6d7e-c297-5fb2-aa6c-7ca2cddeb781` (channel Email,
  OptOut), plus Default - SMS / Default - Mobile Push.
- Check status: `GET /api/admin/users/subscriptions?workspaceId=&userId=` (both required) ->
  `{subscriptionGroups:[{id,name,isSubscribed,channel}]}`.
- Unsubscribe (admin): `PUT /api/admin/subscription-groups/assignments`
  body `{workspaceId, userUpdates:[{userId, changes:{<groupId>: false}}]}`.
- Public opt-out flow: `PUT /api/public/subscription-management/user-subscriptions` (link-token based).

## Proven end-to-end
1. unsubscribe lead-metallprom from Email group via assignments PUT -> 200.
2. GET subscriptions: Email isSubscribed True -> **False**.
3. Broadcast over the industrial segment (5 members incl. metallprom) delivered to **4** recipients;
   **metallprom was skipped** — Dittofeed broadcasts honor the subscription natively. No manual
   suppression needed for unsubscribes.

## Worker code now matches reality
- `DittofeedClient.is_subscribed(user_id, group_id)` and `.unsubscribe(user_id, group_id)` use the
  verified endpoints (env: DITTOFEED_WORKSPACE_ID, EMAIL_SUBSCRIPTION_GROUP).
- `SuppressionList` is now only for bounce/complaint feeds (SES SNS etc.), not subscription state.
- Earlier bogus bulk `list_unsubscribed()` removed. Tests green. Commit c673d4e.
