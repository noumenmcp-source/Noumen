-- Row-level security: scope every `events` row to the request's tenant.
-- The app binds app.tenant_id per transaction (see withTenant); statements then
-- only see/insert rows for that tenant. FORCE applies the policy to the table
-- owner too; superusers still bypass (used by the seed/admin tooling).
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "events_tenant_isolation" ON "events";--> statement-breakpoint
CREATE POLICY "events_tenant_isolation" ON "events"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
