#!/usr/bin/env python3
"""Flot fan-out: campaign copy for ALL trigger scenarios (по стадиям, параллельно).
Brand-agnostic RU copy for a large online store. Each scenario -> {eyebrow, heading, cta, subject, intro}.
heading may mark one accent word with [[слово]] (компилятор обернёт в accent-span)."""
import json, os, urllib.request, concurrent.futures, time

FLOT = "http://127.0.0.1:3264/api/v1/chat/completions"
OUT = "/Users/a1/Documents/New project/cdp/services/dittofeed-assets/copy"
os.makedirs(OUT, exist_ok=True)

SHAPE = ('Верни СТРОГО JSON-объект {ключ_сценария: {"eyebrow":"...","heading":"... [[акцент-слово]] ...",'
         '"cta":"...","subject":"...","intro":"<p>1-2 предложения</p>"}}. Копи на русском, для КРУПНОГО '
         'интернет-магазина (универсально, бренд-агностично — без названия бренда). Тон деловой, без эмодзи. '
         'В heading ровно одно ключевое слово оберни в [[ ]]. Без markdown, без текста вокруг JSON.')

STAGES = {
  "onboarding": "Сценарии: welcome (новый подписчик), double_opt_in (подтверждение email), onboarding_series (серия знакомства), preferences (собрать интересы).",
  "nurture": "Сценарии: browse_abandon (смотрел, не положил в корзину), new_arrivals (новинки по интересу), category_digest (дайджест раздела), price_drop (снижение цены просмотренного), back_in_stock (снова в наличии), wishlist_reminder (избранное без действия), recommendations (рекомендации по поведению).",
  "conversion": "Сценарии: abandoned_cart (брошенная корзина), abandoned_checkout (брошенный checkout), cart_change (изменения в корзине), abandoned_rfq (брошенный запрос КП, B2B).",
  "retention": "Сценарии: review_request (просьба об отзыве после доставки), cross_sell (допродажа после заказа), replenishment (пора дозаказать расходники), loyalty (статус/лояльность), win_back (давно не заходил), anniversary (годовщина/повод).",
}

def call(model, spec):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": spec}],
                       "max_tokens": 2500, "temperature": 0.5, "stream": False}).encode()
    req = urllib.request.Request(FLOT, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=240) as r:
        d = json.loads(r.read())
    return (d.get("choices") or [{}])[0].get("message", {}).get("content") or ""

def run(stage, scenarios):
    spec = f"Сгенерируй копи триггерных писем. {scenarios}\n\n{SHAPE}"
    t0 = time.time()
    for model in ("qwen3.7-max", "qwen3-coder-plus"):
        try:
            c = call(model, spec)
            import re
            m = re.search(r"\{.*\}", c, re.DOTALL)
            if m:
                obj = json.loads(m.group(0))
                json.dump(obj, open(os.path.join(OUT, stage + ".json"), "w"), ensure_ascii=False, indent=2)
                return f"{stage}: OK {len(obj)} scenarios via {model} {int(time.time()-t0)}s"
            last = f"{stage}: no JSON via {model}"
        except Exception as e:
            last = f"{stage}: ERR {e}"
    return last

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    futs = {ex.submit(run, s, sc): s for s, sc in STAGES.items()}
    for f in concurrent.futures.as_completed(futs):
        print(f.result(), flush=True)
