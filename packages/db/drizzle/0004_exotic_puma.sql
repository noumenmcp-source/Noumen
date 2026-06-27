CREATE TABLE IF NOT EXISTS "suppression_entries" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
