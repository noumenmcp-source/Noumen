CREATE TABLE IF NOT EXISTS "playbook_action_feedback" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "action_key" text NOT NULL,
  "status" text NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metric_before" numeric,
  "metric_after" numeric,
  "worked" boolean,
  "note" text
);
--> statement-breakpoint
ALTER TABLE "playbook_action_feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "playbook_action_feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "playbook_action_feedback_tenant_isolation" ON "playbook_action_feedback";
--> statement-breakpoint
CREATE POLICY "playbook_action_feedback_tenant_isolation" ON "playbook_action_feedback"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_action_feedback_tenant_key_idx" ON "playbook_action_feedback" ("tenant_id", "action_key");
