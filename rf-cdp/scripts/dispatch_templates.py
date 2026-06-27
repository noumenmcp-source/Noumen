#!/usr/bin/env python3
"""Flot fan-out: 4 INDEPENDENT campaign email templates in the zavod.dev design system."""
import json, os, urllib.request, concurrent.futures, time

FLOT = "http://127.0.0.1:3264/api/v1/chat/completions"
OUT = "/Users/a1/Documents/New project/cdp/services/dittofeed-assets/templates"
os.makedirs(OUT, exist_ok=True)

DS = """zavod.dev design system (use EXACTLY):
- bg #f5f1e8; card #fffdf7; border #e5e0d4; radius 18px; dark header #1a1410; text #2a221c; muted #6b6258.
- accent terracotta #d4513a, accent-on-light text #b3402c.
- Heading: Inter, font-weight 800, UPPERCASE, letter-spacing -0.6px, line-height 1.0, ONE word wrapped
  <span style="color:#b3402c"> accent. Eyebrow: Inter 700, 11px, uppercase, color #b3402c, preceded by a
  30x2px terracotta dash bar. CTA: pill (border-radius 999px), bg #d4513a, white uppercase Inter 700.
- Header wordmark: ZAVOD (Inter 900 uppercase white) + 9px terracotta square.
- Email-safe ONLY: tables, inline styles, web-safe fallbacks (Inter,Arial,sans-serif). No flex/grid/JS.
- Liquid placeholders to include: subject in <title> {{ user.gen_subject | default: "..." }};
  body block {{ user.gen_body_html | default: "<p>...</p>" }}; {{ catalog_url | default: 'https://zavod.dev/catalog' }};
  {{ unsubscribe_url | default: '#' }}. Footer: muted, with unsubscribe link.
Catalog = B2B AI/ML/robotics electronics (вычислители, машинное зрение, датчики, робототехника)."""

CAMPAIGNS = {
  "welcome": "Welcome email for a NEW subscriber. Eyebrow 'Добро пожаловать', warm intro, value props, CTA 'Открыть каталог'.",
  "abandoned-cart": "Abandoned-cart reminder. Eyebrow 'Вы кое-что забыли', remind items left in cart (use {{ user.gen_body_html }}), CTA 'Вернуться в корзину'.",
  "re-engagement": "Re-engagement for a dormant customer. Eyebrow 'Давно не виделись', what's new, CTA 'Посмотреть новинки'.",
  "new-arrivals": "New-arrivals announcement. Eyebrow 'Новинки каталога', highlight fresh positions by profile, CTA 'Смотреть новинки'.",
}

def call(model, spec):
    body=json.dumps({"model":model,"messages":[{"role":"user","content":spec}],"max_tokens":3500,"temperature":0.4,"stream":False}).encode()
    req=urllib.request.Request(FLOT,data=body,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=300) as r: d=json.loads(r.read())
    return d.get("model"),(d.get("choices") or [{}])[0].get("message",{}).get("content") or ""

def run(name, brief):
    spec=(f"Generate a complete, valid, email-safe HTML email template '{name}'. {brief}\n\n{DS}\n\n"
          "Output ONLY the HTML (DOCTYPE..</html>), no markdown fences, no prose.")
    t0=time.time()
    for model in ("qwen3.7-max","qwen3-coder-plus"):
        try:
            m,c=call(model,spec)
            c=c.strip()
            if c.startswith("```"): c=c.split("\n",1)[1].rsplit("```",1)[0]
            if "<html" in c.lower() and "{{ user.gen_body_html" in c:
                open(os.path.join(OUT,f"{name}.liquid.html"),"w").write(c)
                return f"{name}: OK via {model} {len(c)}B {int(time.time()-t0)}s"
            last=f"{name}: invalid via {model} ({len(c)}B)"
        except Exception as e: last=f"{name}: ERR {e}"
    return last

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    futs={ex.submit(run,n,b):n for n,b in CAMPAIGNS.items()}
    for f in concurrent.futures.as_completed(futs): print(f.result(),flush=True)
