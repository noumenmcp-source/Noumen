ALTER TABLE "tenants" ADD COLUMN "plan" text DEFAULT 'agency' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;