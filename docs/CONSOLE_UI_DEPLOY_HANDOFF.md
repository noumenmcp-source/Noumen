# Console UI Deploy Handoff

Updated: 2026-06-27 17:21 UTC.

## Scope

This is the handoff for the Noumen/CDP-US console UI and US dashboard deploy slice.
The requested visual reference is Square UI:

- GitHub: https://github.com/zerostaticthemes/square-ui
- Demo/homepage: https://square.lndev.me
- Repo facts checked through `gh repo view`: `zerostaticthemes/square-ui`, default branch `master`, description "Collection of beautifully crafted open-source layouts UI built with shadcn/ui.", license key `other`, pushed at `2026-06-14T11:49:48Z`.
- Local reference clone used only for inspection: `/tmp/square-ui`.
- Relevant templates inspected: `templates/dashboard-1`, `templates/leads`, `templates/marketing-dashboard`.

Use Square UI as a style reference, not as a wholesale code import. The current adaptation uses the same product language: compact SaaS shell, left sidebar, sticky header, bordered cards, dense tables, muted headers, and operational dashboard density.

## Repo State

Canonical GitHub repo:

- `noumenmcp-source/Noumen`

Clean US UI worktree created to avoid mixing the RF knowledge commit into US runtime work:

- Path: `/Users/a1/cdp-console-square-ui`
- Branch: `feat/console-square-ui`
- Base/head at creation: `cd422ec4d3b62fc29d41a7696eae0965ef346254`
- `origin/main` at check: `cd422ec4d3b62fc29d41a7696eae0965ef346254`
- Git status: dirty with scoped `apps/console/**` changes plus this docs handoff.

Existing ECO SAS worktree still exists and must not be used for US main deploy until its RF context is handled deliberately:

- Path: `/Users/a1/cdp-platform-enforcement`
- Branch: `feat/platform-enforcement`
- HEAD: `7ce8f0fabce92a171ede121cf268002951cbad4c`
- State: ahead of `origin/main` by one RF knowledge/materials commit.

## Live Runtime Evidence

US API currently responds:

```text
curl -i https://noumen.137-220-56-211.sslip.io/v1/health
HTTP/2 200
content-type: application/json; charset=utf-8
via: 1.1 Caddy
{"status":"ok","region":"us","counters":{"received":0,"stored":0,"suppressed":0,"failed":0}}
```

Latest checked main CI:

```text
gh run list --repo noumenmcp-source/Noumen --branch main --limit 3
completed success feat(api): add env-gated observability hooks CI main push 28293618102 49s 2026-06-27T15:33:14Z
completed success feat(api): add graceful shutdown handlers CI main push 28292884496 1m0s 2026-06-27T15:03:42Z
completed success docs: add session handoff + next-session transition prompt CI main push 28292666577 56s 2026-06-27T14:54:56Z
```

CI URL for latest checked run:

- https://github.com/noumenmcp-source/Noumen/actions/runs/28293618102

## UI Work Already Applied

Changed files in `/Users/a1/cdp-console-square-ui`:

- `apps/console/tailwind.config.ts`
- `apps/console/app/globals.css`
- `apps/console/src/ui.tsx`
- `apps/console/app/page.tsx`
- `apps/console/app/modules/page.tsx`
- `apps/console/app/profiles/page.tsx`
- `apps/console/app/profiles/[id]/page.tsx`
- `apps/console/app/connect/page.tsx`
- `apps/console/app/login/page.tsx`
- `apps/console/app/signup/page.tsx`
- `apps/console/app/activation/page.tsx`
- `apps/console/app/activation/journeys/page.tsx`
- `apps/console/Dockerfile`
- `apps/console/Dockerfile.dockerignore`

Intent of the changes:

- Replace the previous simple green top-nav shell with a Square UI inspired SaaS shell.
- Add left sidebar on desktop and compact horizontal mobile nav.
- Add sticky header, operational runtime status card, compact cards and tables.
- Add shared `PageHeader` and `MetricCard` primitives.
- Keep all existing API/session behavior intact.
- Keep customer-facing UI copy English and US-only.

No lockfile or root config changes were made.

## Verification Status

Completed after the interrupted install from the previous session:

```sh
pnpm install --frozen-lockfile
pnpm --filter @cdp-us/console build
pnpm build
pnpm test
pnpm -r --if-present build
git diff --check
LC_ALL=C rg -n "Russian|GDPR|coming soon|RU-only|152-ФЗ|РФ|РКН|Beget|90\\.156\\.170\\.63" $(git diff --name-only)
```

Results:

- `pnpm --filter @cdp-us/console build`: passed.
- `pnpm build`: passed.
- `pnpm test`: passed; API DB integration tests remained skipped when no DB env was provided.
- `pnpm -r --if-present build`: passed.
- `git diff --check`: passed with no output.
- segmentation/content scan: no matches in changed files.

Local runtime and browser checks:

- `NEXT_PUBLIC_API_URL=https://noumen.137-220-56-211.sslip.io pnpm --filter @cdp-us/console dev`
- `http://localhost:8120/`, `/signup`, `/login`, `/connect`, `/modules`, `/profiles`, and `/activation`: HTTP 200.
- Playwright desktop/mobile checks showed rendered shell, live API `ok`, no page/console errors, and `horizontalOverflow: 0`.
- Signup posted to `https://noumen.137-220-56-211.sslip.io/v1/signup` and returned `201`.
- Local Docker image `noumen-console:local` built from `apps/console/Dockerfile`, ran on `localhost:8121`, and passed route/API/browser checks.

## Deploy Status

Public UI URL:

- `https://console.137-220-56-211.sslip.io`

Existing API URL:

- `https://noumen.137-220-56-211.sslip.io`

The console should be built with:

```text
NEXT_PUBLIC_API_URL=https://noumen.137-220-56-211.sslip.io
```

Deployment completed on the US server:

- Added `apps/console/Dockerfile` and `apps/console/Dockerfile.dockerignore`.
- Synced `apps/console` into `/opt/noumen/repo/apps/console` without `.next`, `node_modules`, or build output.
- Added `noumen-console` service to `/opt/noumen/docker-compose.yml`.
- Built `noumen-console:feat-console-square-ui` from `/opt/noumen/repo`.
- Published the service on `127.0.0.1:8220->8120`.
- Added Caddy vhost `console.137-220-56-211.sslip.io` and reloaded Caddy.
- Public console routes `/`, `/signup`, `/login`, `/connect`, `/modules`, `/profiles`, and `/activation` returned HTTP 200.
- Browser verification against the public URL showed desktop/mobile render, live API `ok`, no page/console errors, and signup POST `201`.
- Existing `noumen-api`, `noumen-postgres`, and `noumen-redis` were not stopped or recreated and remained healthy/running.

## GitHub/Connector Notes

In this Codex runtime, the official GitHub connector did not become callable as an MCP tool. Repository and CI facts above were gathered through `git` and `gh` fallback.

`gh auth status` was previously OK for `noumenmcp-source` with `repo` and `workflow` scopes. Re-check before push:

```sh
gh auth status
```

After green local verification:

```sh
git status --short --branch
git add apps/console docs/CONSOLE_UI_DEPLOY_HANDOFF.md docs/NEXT_SESSION_PROMPT_CONSOLE_UI_DEPLOY.md
git commit -m "feat(console): apply square ui inspired dashboard shell"
git push origin feat/console-square-ui
git fetch origin
git rev-parse origin/main
git push origin HEAD:refs/heads/main
gh run list --repo noumenmcp-source/Noumen --branch main --limit 5
gh run watch <run-id> --repo noumenmcp-source/Noumen --exit-status
```

Do not fast-forward main if `origin/main` moved unexpectedly.
