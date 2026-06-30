-- Server-side session management for API tokens: revocation (logout/admin) and
-- optional expiry. Both nullable; existing tokens stay live (NULL = never).
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
