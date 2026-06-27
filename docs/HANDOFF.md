# Handoff — CDP-US / Noumen

Snapshot for continuing the work in a fresh session. Updated at main `bc5afe6`
(2026-06-27).

## Repo / location

- GitHub: `noumenmcp-source/Noumen`
- Worktree: `/Users/a1/cdp-platform-enforcement`
- Branch: `feat/platform-enforcement`
- `HEAD` == `origin/main` == `origin/feat/platform-enforcement` == `bc5afe6`
- `gh auth`: `noumenmcp-source`, scopes repo/workflow.

## Workflow rules (followed all session)

1. Never work directly on `main`; commit on `feat/platform-enforcement`.
2. Before each slice: clean tree + `git fetch` and confirm `origin/main` hasn't moved.
3. Test-first; one tightly-scoped slice per commit; each green before the next.
4. Don't touch root configs / `.github` / `pnpm-lock` without a real reason.
5. Verification ladder per slice (all must pass):
   - `pnpm --filter @cdp-us/api build`
   - targeted unit tests, then `pnpm build` + `pnpm test`
   - for DB slices: migrate + integration on a **fresh** local Postgres (below)
   - `pnpm install --frozen-lockfile`, `pnpm -r --if-present build`, `git diff --check`
   - content scan: changed files must not match `Russian|GDPR|coming soon|RU-only|152-ФЗ|РФ|РКН`
6. Commit, push branch; if `origin/main` hasn't moved, fast-forward main with
   `git push origin <sha>:refs/heads/main`.
7. Watch CI with `gh run watch <id> --exit-status`; confirm `completed/success`.
8. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Local integration Postgres (for DB slices)

```sh
docker run -d --name cdp-pg-test -e POSTGRES_USER=cdp -e POSTGRES_PASSWORD=cdp \
  -e POSTGRES_DB=cdp_us -p 5544:5432 postgres:16
export DATABASE_URL="postgres://cdp:cdp@localhost:5544/cdp_us"
pnpm --filter @cdp-us/db db:migrate
pnpm --filter @cdp-us/api exec vitest run src/db.integration.test.ts
```
Integration tests are gated by `describe.skipIf(!DATABASE_URL)`. Recreate the
container fresh when a migration changes a PK (mirrors CI). CI's `integration`
job runs all migrations on a fresh PG and the same tests.

## Done this session (14 commits, all CI-green)

Persistence + enforcement + compliance:
- `dc93ff9` persist tenant plan/status; `ffce980` onboard signups on `free`
- `e0a1b4b` audit trail in Postgres; `053a670` suppression list (CAN-SPAM)
- `ffd4677` usage counters (atomic); `0348ffc` monthly usage buckets;
  `f0ba9ba` window in-memory meter to match
- `cf1a445` audit emission on DSAR; `e8793fc` audit emission on module-enable
- `6974644`+`75bf46c` **B2**: DSAR delete actually erases (events + profile anonymize)
- `3e7ba9e` **B3**: consent persists (`consent_states`) + rehydrates gate on boot
- `f16a03b`+`bc5afe6` docs: `COMMERCIAL_READINESS.md`

State: all live-circuit stores are Postgres-backed (tenant, token, profile,
ingest, audit, suppression, usage, consent). Migrations 0000–0007.

## Gotchas

- **drizzle-kit PK reorder bug**: changing a composite PK emits `ADD PRIMARY KEY`
  *before* `ADD COLUMN` → fails on apply. Hand-reorder the generated SQL (column
  first). Always verify a PK-changing migration on a fresh PG.
- `.astro` build artifacts are git-ignored; don't re-add.
- `redactProfile` sets `id` to the tombstone — when anonymizing in place, restore
  `id`/`tenantId`/`createdAt` (see `createDsarEraser` in `server.ts`).
- Email enforcement records usage *after* send (`email.ts` `usageMeter.record`),
  so durable + monthly buckets make `*PerMonth` limits correct in prod.

## What's left to commercial production

See `docs/COMMERCIAL_READINESS.md`. Decisions from the planning review: host =
**Fly.io**, GTM = **sales-led** (defers self-serve auth P1 and part of B1).

Launch blockers remaining:
- **B1 Stripe** (payments — needs Stripe account/creds; webhook→`plan` codeable now)
- **B4 deploy** to Fly.io (needs cloud creds + domain + approval; image verified)

Production-trust (code, no creds needed — good next autonomous work):
- **P2** observability (Sentry/OTel) · **P5** graceful shutdown (SIGTERM →
  `app.close()`) · **P6** Redis-backed rate-limit · **P3** RLS tenant isolation

Compliance follow-ups: tamper-evident hash-chained `consent_records` ledger;
fine-grained DSAR event deletion under partial legal hold.
