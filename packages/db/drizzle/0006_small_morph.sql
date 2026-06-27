ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_tenant_id_metric_pk";--> statement-breakpoint
ALTER TABLE "usage_counters" ADD COLUMN "period" text NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_metric_period_pk" PRIMARY KEY("tenant_id","metric","period");