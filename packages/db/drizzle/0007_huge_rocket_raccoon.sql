CREATE TABLE IF NOT EXISTS "consent_states" (
	"tenant_id" text NOT NULL,
	"subject" text NOT NULL,
	"state" jsonb NOT NULL,
	"source" text DEFAULT 'banner' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_states_tenant_id_subject_pk" PRIMARY KEY("tenant_id","subject")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
