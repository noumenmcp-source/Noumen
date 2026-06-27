# CDP маркетинг — деплой на Vercel (манифест)

Полная карта деплоев. Источник истины для всех материалов = этот репозиторий.
Внешние папки `/Users/a1/cdp-risk/` и `/Users/a1/cdp-en/` — лишь зеркала для деплоя
(в них копии этих же файлов + соответствующий `vercel.json`); воспроизводимы по таблице ниже.

## Проекты и URL (аккаунт pm99lvl-2370, team denis-projects5)

| Проект Vercel | URL | Отдаёт файл из репо | Язык |
|---|---|---|---|
| `cdp-risk` | https://cdp-risk.vercel.app/        | `cdp_landing_risk.html`     | RU |
| `cdp-risk` | https://cdp-risk.vercel.app/deck    | `cdp_deck_premium.html`     | RU |
| `cdp-risk` | https://cdp-risk.vercel.app/insight | `cdp_landing_insight.html`  | RU |
| `cdp-en`   | https://cdp-en.vercel.app/          | `cdp_landing_en.html`       | EN |

`vercel.json` для обоих проектов одинаковый (`cleanUrls: true`, `trailingSlash: false`) —
см. `cdp-risk.vercel.json` / `cdp-en.vercel.json` в этой папке.

## Как воспроизвести деплой-папку из репо

### cdp-risk (RU, мультистраничный)
```sh
mkdir -p /Users/a1/cdp-risk
cp "cdp_landing_risk.html"    /Users/a1/cdp-risk/index.html
cp "cdp_deck_premium.html"    /Users/a1/cdp-risk/deck.html
cp "cdp_landing_insight.html" /Users/a1/cdp-risk/insight.html
cp "vercel-deploy/cdp-risk.vercel.json" /Users/a1/cdp-risk/vercel.json
vercel deploy /Users/a1/cdp-risk --prod --yes
```

### cdp-en (EN, отдельный проект — по явной просьбе)
```sh
mkdir -p /Users/a1/cdp-en
cp "cdp_landing_en.html" /Users/a1/cdp-en/index.html
cp "vercel-deploy/cdp-en.vercel.json" /Users/a1/cdp-en/vercel.json
vercel deploy /Users/a1/cdp-en --prod --yes
```

## Правило
НЕ плодить отдельные Vercel-проекты без явной просьбы. `cdp-en` — отдельный по прямой команде юзера
(«запости отдельно на Версел»). RU-материалы держим под одним проектом `cdp-risk` на разных путях.

См. также `../MARKETING_ARTIFACTS.md` (индекс артефактов).
