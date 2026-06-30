-- Extend row-level security to the remaining tenant-scoped data tables. Same
-- shape as events (0008): the app binds app.tenant_id per transaction (withTenant)
-- and every statement is scoped to it. Superusers/seed bypass; a least-privilege
-- app role is isolated. Auth/boot tables (tenants, api_tokens, consent_states,
-- suppression_entries) stay un-scoped — they have legitimate cross-tenant access.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "profiles_tenant_isolation" ON "profiles";--> statement-breakpoint
CREATE POLICY "profiles_tenant_isolation" ON "profiles"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "consent_records_tenant_isolation" ON "consent_records";--> statement-breakpoint
CREATE POLICY "consent_records_tenant_isolation" ON "consent_records"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "audit_entries_tenant_isolation" ON "audit_entries";--> statement-breakpoint
CREATE POLICY "audit_entries_tenant_isolation" ON "audit_entries"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
