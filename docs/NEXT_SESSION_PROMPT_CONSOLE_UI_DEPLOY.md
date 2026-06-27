# Detailed Next Session Prompt: Console Square UI Deploy

Ты продолжаешь работу над CDP-US / Noumen. Это US-only B2B SaaS на ядре CDP: CCPA/CPRA/CAN-SPAM/TCPA, US cloud/runtime, англоязычный customer-facing UI. Ответы пользователю давай на русском, но весь продуктовый UI/copy/docs для клиентов держи на английском.

Главная цель следующей сессии: довести Square UI inspired console dashboard до build-green, развернуть его на US server рядом с live Noumen API, проверить реальный UI URL, затем закоммитить/запушить/fast-forward main только после локальных проверок.

## 0. Жёсткие правила

1. Не работай в `main` напрямую.
2. Не смешивай RF runtime/materials с US deploy.
3. Не используй старый RF/Beget/Odoo контекст как runtime для Noumen US.
4. Не трогай `pnpm-lock.yaml`, root configs, `.github/**` без реальной причины.
5. Не выдавай "готово" без machine-readable evidence: команды, статусы, URL, CI.
6. Не печатай и не сохраняй в docs пароли/секреты/токены.
7. Если GitHub connector не callable, честно скажи это и используй `git`/`gh` fallback.
8. Если `origin/main` убежал, не делай FF push в main без нового сравнения.
9. Если появляются чужие/unrelated изменения, не откатывай их вслепую.
10. UI должен быть рабочим dashboard/app, не landing page.

## 1. Координаты

Canonical repo:

- GitHub: `https://github.com/noumenmcp-source/Noumen`

Рабочий чистый UI worktree:

- Path: `/Users/a1/cdp-console-square-ui`
- Branch: `feat/console-square-ui`
- Base/head на момент handoff: `cd422ec4d3b62fc29d41a7696eae0965ef346254`
- `origin/main` на момент handoff: `cd422ec4d3b62fc29d41a7696eae0965ef346254`

Старый ECO SAS worktree, который НЕ использовать для US main/deploy без отдельного решения:

- Path: `/Users/a1/cdp-platform-enforcement`
- Branch: `feat/platform-enforcement`
- HEAD на момент handoff: `7ce8f0fabce92a171ede121cf268002951cbad4c`
- Состояние: ahead of `origin/main` by one RF knowledge/materials commit.

Почему создан отдельный worktree: чтобы не смешать RF knowledge commit из `feat/platform-enforcement` с US console/deploy slice.

## 2. Tooling expectations

Serena:

- Предпочтительный проект: `ECO SAS`.
- Если Serena не видит имя `ECO SAS`, активируй проект по пути `/Users/a1/cdp-platform-enforcement`; в прошлой сессии это создало/активировало проект с именем `ECO SAS`.

Codebase-memory:

- Для старого worktree есть graph project: `Users-a1-cdp-platform-enforcement`.
- Для нового clean UI worktree graph может отсутствовать. Если нужен structural discovery именно в `/Users/a1/cdp-console-square-ui`, сначала проиндексируй:

```sh
# through codebase-memory MCP, not shell:
# index_repository(repo_path="/Users/a1/cdp-console-square-ui", mode="fast", persistence=true)
```

GitHub:

- Official GitHub connector в предыдущей сессии не стал callable.
- `gh` fallback работал.
- Перед push проверь:

```sh
gh auth status
```

## 3. Square UI reference

Пользователь явно указал стиль-референс:

- Repo: `https://github.com/zerostaticthemes/square-ui`
- Demo/homepage: `https://square.lndev.me`
- `gh repo view` ранее подтвердил:
  - `nameWithOwner`: `zerostaticthemes/square-ui`
  - default branch: `master`
  - description: `Collection of beautifully crafted open-source layouts UI built with shadcn/ui.`
  - license key: `other`
  - pushedAt: `2026-06-14T11:49:48Z`

Локальный reference clone в прошлой сессии:

- `/tmp/square-ui`

Инспектированные шаблоны:

- `/tmp/square-ui/templates/dashboard-1`
- `/tmp/square-ui/templates/leads`
- `/tmp/square-ui/templates/marketing-dashboard`

Использовать как стиль-референс, не копировать wholesale:

- compact SaaS shell;
- left sidebar на desktop;
- sticky top header;
- dense operational cards;
- bordered `rounded-xl` cards;
- muted table headers;
- compact tables;
- neutral light palette with restrained accent;
- actual app surface first, no marketing hero.

## 4. Что уже изменено

В `/Users/a1/cdp-console-square-ui` уже есть незакоммиченные изменения в `apps/console/**`.

Изменённые файлы:

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
- `docs/CONSOLE_UI_DEPLOY_HANDOFF.md`
- `docs/NEXT_SESSION_PROMPT_CONSOLE_UI_DEPLOY.md`

Смысл текущих UI-правок:

- Старый простой green top-nav заменён на Square UI inspired SaaS shell.
- Добавлен desktop sidebar и mobile horizontal nav.
- Добавлен sticky header.
- Добавлены общие primitives в `apps/console/src/ui.tsx`: `PageHeader`, `MetricCard`, расширенный `Badge`, обновлённые `Panel/Button/Field`.
- Dashboard получил KPI strip и runtime/tenant panels.
- Modules и Profiles переведены в dense table layout.
- Connect/Login/Signup/Activation приведены к тому же visual language.
- API/session логика намеренно сохранена.
- UI copy на английском.

Важно: сборка ещё не зелёная, потому что не была запущена до конца.

## 5. Verification status на момент handoff

Команда:

```sh
pnpm --filter @cdp-us/console build
```

Результат:

```text
next: command not found
WARN Local package.json exists, but node_modules missing, did you mean to install?
```

Причина: новый worktree без `node_modules`.

Затем была начата команда:

```sh
pnpm install --frozen-lockfile
```

Она была намеренно прервана пользователем. После interrupt проверка процессов показала, что фоновых `pnpm install` / `next build` не осталось.

Не утверждай, что UI готов, пока сам не прогонишь сборку и runtime check.

## 6. Live runtime evidence

US API был жив на момент handoff:

```sh
/usr/bin/curl -sS -i https://noumen.137-220-56-211.sslip.io/v1/health
```

Ответ:

```text
HTTP/2 200
content-type: application/json; charset=utf-8
via: 1.1 Caddy
{"status":"ok","region":"us","counters":{"received":0,"stored":0,"suppressed":0,"failed":0}}
```

Latest checked main CI:

```text
completed success feat(api): add env-gated observability hooks CI main push 28293618102 49s 2026-06-27T15:33:14Z
```

CI URL:

- `https://github.com/noumenmcp-source/Noumen/actions/runs/28293618102`

## 7. First commands in next session

Start here:

```sh
cd /Users/a1/cdp-console-square-ui
git status --short --branch
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git diff --stat
```

Expected baseline:

- branch: `feat/console-square-ui`
- HEAD should still be `cd422ec4d3b62fc29d41a7696eae0965ef346254` unless previous work continued;
- `origin/main` should still be checked before any FF push;
- dirty files should be scoped to `apps/console/**` plus docs handoff/prompt.

Then install deps:

```sh
pnpm install --frozen-lockfile
```

If this changes `pnpm-lock.yaml`, stop and inspect why before committing anything.

## 8. Build and test ladder

Run:

```sh
pnpm --filter @cdp-us/console build
```

Fix any Next/Tailwind/TypeScript errors in the smallest possible scope.

Then run:

```sh
pnpm build
pnpm test
pnpm -r --if-present build
git diff --check
```

Run content/segmentation scan over changed files:

```sh
LC_ALL=C rg -n "Russian|GDPR|coming soon|RU-only|152-ФЗ|РФ|РКН|Beget|90\\.156\\.170\\.63" $(git diff --name-only)
```

Expected nuance:

- `GDPR` may exist in old docs, but do not introduce new customer-facing GDPR/RF/RU terms into US UI.
- The scan may match the prompt itself because it contains the forbidden-term regex. If so, explain it as a docs/runbook guard, not product copy.

## 9. Local visual/runtime verification

Run local console against live US API:

```sh
NEXT_PUBLIC_API_URL=https://noumen.137-220-56-211.sslip.io pnpm --filter @cdp-us/console dev
```

Open/check:

- `http://localhost:8120/`
- `http://localhost:8120/signup`
- `http://localhost:8120/login`
- `http://localhost:8120/connect`
- `http://localhost:8120/modules`
- `http://localhost:8120/profiles`
- `http://localhost:8120/activation`

Verify:

- dashboard renders, not blank;
- no obvious text overlap desktop/mobile;
- sidebar/header/table/card styles are Square UI inspired;
- health/API status is fetched from live API;
- signup form still submits to the API;
- modules route still lists modules;
- no runtime console crash.

If browser automation is available, use it. If not, use curl/HTML evidence and say browser visual verification was not available.

## 10. Production deploy target

Existing live API:

- `https://noumen.137-220-56-211.sslip.io`

Recommended console URL:

- `https://console.137-220-56-211.sslip.io`

Console build env:

```text
NEXT_PUBLIC_API_URL=https://noumen.137-220-56-211.sslip.io
```

Deployment was completed in the continuation session:

1. Added `apps/console/Dockerfile` and `apps/console/Dockerfile.dockerignore` for Next standalone runtime.
2. Built from repo root with filtered console install and `NEXT_PUBLIC_API_URL=https://noumen.137-220-56-211.sslip.io`.
3. Synced `apps/console` into `/opt/noumen/repo/apps/console`.
4. Added `noumen-console` service on the US server.
5. Reverse proxied through Caddy at `console.137-220-56-211.sslip.io`.
6. Verified public HTTP 200, rendered dashboard, live API status, and signup POST `201`.

Do not destroy or stop API/Postgres/Redis. Existing US runtime from previous work:

- `noumen-api`
- `noumen-postgres`
- `noumen-redis`

API URL remained healthy after console deploy.

## 11. Commit/push sequence

Only after local build/test/visual checks are acceptable:

```sh
git status --short --branch
git add apps/console docs/CONSOLE_UI_DEPLOY_HANDOFF.md docs/NEXT_SESSION_PROMPT_CONSOLE_UI_DEPLOY.md
git commit -m "feat(console): apply square ui inspired dashboard shell"
git push origin feat/console-square-ui
```

Before FF main:

```sh
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git log --oneline --decorate --max-count=5
```

If `origin/main` still matches the expected base or can be safely fast-forwarded:

```sh
git push origin HEAD:refs/heads/main
```

Then check CI:

```sh
gh run list --repo noumenmcp-source/Noumen --branch main --limit 5
gh run watch <run-id> --repo noumenmcp-source/Noumen --exit-status
```

Do not claim CI green until `gh run watch` exits success or `gh run view` confirms completed/success.

## 12. Final answer format

Final answer must include:

- path: `/Users/a1/cdp-console-square-ui`
- branch: `feat/console-square-ui`
- commit SHA
- pushed branch status
- whether main was fast-forwarded
- UI URL and status
- API URL and status
- exact verification commands run
- CI URL/status
- what remains not done

Keep the answer concise but evidence-backed. If something failed, say exactly where and do not blur local green with remote/deploy blockers.
