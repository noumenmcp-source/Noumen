# CDP-US Infrastructure

Terraform configuration for a US-only deployment of `apps/api` on AWS ECS Fargate with managed Postgres, secrets, and a public healthcheck.

## Runbook

1. Copy `terraform.tfvars.example` to a private tfvars file and replace placeholders outside version control.
2. Initialize locally:

   ```bash
   terraform -chdir=infra init -backend=false
   ```

3. Validate and format-check:

   ```bash
   terraform -chdir=infra validate
   terraform -chdir=infra fmt -check
   ```

4. Review the plan:

   ```bash
   terraform -chdir=infra plan -var-file=terraform.tfvars
   ```

5. Apply only from an approved operator workstation:

   ```bash
   terraform -chdir=infra apply -var-file=terraform.tfvars
   ```

6. Run database migrations after the API and database are reachable:

   ```bash
   pnpm --filter @cdp-us/db db:migrate
   ```

7. Verify the API:

   ```bash
   curl "$(terraform -chdir=infra output -raw healthcheck_url)"
   ```

## Environment

The API task receives `DATABASE_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `PORT`, optional `RESEND_API_KEY`, `AI_GATEWAY_BASE_URL`, and `AI_GATEWAY_API_KEY`.

No secrets are committed. Use secure variable injection for `database_password`, `resend_api_key`, and `ai_gateway_api_key`.
