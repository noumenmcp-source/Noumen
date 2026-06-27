# CDP-US API — Deploy Runbook

US-only deployment runbook for the `@cdp-us/api` service.

> **Region scope:** US only. This service runs on US infrastructure (US-region
> Postgres, US container host). There is **no RF/Russian infrastructure** in this
> deployment — no Beget, no RU-ESP, no RU region. Do not point any environment
> variable at non-US infrastructure.

## Target

Container target. Runs on **Fly.io** or any container host (ECS, Cloud Run,
Kubernetes, plain Docker host). The image is built from
[`apps/api/Dockerfile`](../apps/api/Dockerfile), a multi-stage build (Node 20,
matching the repo's `.nvmrc`) over the pnpm monorepo.

The container runs as the non-root `node` user, listens on port **8110**, and
exposes a health endpoint at `GET /v1/health`.

> **Build-context note:** the Dockerfile's ignore rules live in
> [`apps/api/Dockerfile.dockerignore`](../apps/api/Dockerfile.dockerignore), not
> a plain `.dockerignore`. Because the build context is the repo root, Docker
> only honors the context-root `.dockerignore` or the Dockerfile-specific
> `<dockerfile>.dockerignore` name — do not rename it back to `.dockerignore`.

## Required environment variables

| Variable            | Required           | Default                  | Description                                                                                                  |
| ------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | yes (production)   | _none_ → in-memory store | Connection string for the **US-region** Postgres. If unset, the API falls back to ephemeral in-memory stores (dev/test only) and persists nothing — always set it in production. |
| `RATE_LIMIT_MAX`    | no                 | `600`                    | Max requests allowed per rate-limit window.                                                                  |
| `RATE_LIMIT_WINDOW` | no                 | `1 minute`               | Rate-limit window duration (e.g. `1 minute`).                                                                |
| `PORT`              | no                 | `8110`                   | HTTP listen port (also baked into the image as `8110` and used by the container `HEALTHCHECK`).              |

## Deploy steps

### 1. Build the image

From the monorepo root (build context must be the repo root so all workspaces
are available):

```sh
docker build -f apps/api/Dockerfile -t cdp-us-api:latest .
```

On Fly.io, `fly deploy` builds the same Dockerfile (point `dockerfile` in
`fly.toml` at `apps/api/Dockerfile` with the build context at the repo root).

### 2. Run database migrations

Migrations run from a checkout of this repo (not from the API container — the
runtime image has no `drizzle-kit`). On the host, run `pnpm install` once, then
apply migrations against the **US Postgres** before starting (or rolling) the
API:

```sh
pnpm install --frozen-lockfile
DATABASE_URL="<us-postgres-url>" pnpm --filter @cdp-us/db db:migrate
```

This runs `drizzle-kit migrate`, applying the SQL migrations in
`packages/db/drizzle/` (config: `packages/db/drizzle.config.ts`).

### 3. Start the service

```sh
docker run -d \
  -e DATABASE_URL="<us-postgres-url>" \
  -e RATE_LIMIT_MAX="100" \
  -e RATE_LIMIT_WINDOW="1 minute" \
  -e PORT="8110" \
  -p 8110:8110 \
  cdp-us-api:latest
```

On Fly.io: set secrets with `fly secrets set DATABASE_URL=... RATE_LIMIT_MAX=...
RATE_LIMIT_WINDOW=...` then `fly deploy`.

### 4. Verify health

The container `HEALTHCHECK` hits `GET /v1/health` automatically. To verify
manually:

```sh
curl -fsS http://127.0.0.1:8110/v1/health
```

A healthy response confirms the API is up and connected. Configure the
container host / Fly.io health check to use `GET /v1/health` on port `8110`.

## Rollback

Redeploy the previous image tag (or `fly releases` + `fly deploy --image
<previous>`). Migrations are forward-only; review the `@cdp-us/db` migration
history before rolling back schema-affecting releases.
