#!/usr/bin/env python3
"""White-label email compiler: theme x master -> brand template; campaign copy + Liquid -> final email.
Usage: python3 compile_email.py <theme> <scenario> [--send <to>]"""
import os
import json, re, sys, os, subprocess

ROOT = "/Users/a1/Documents/New project/cdp/services/dittofeed-assets"
THEMES = json.load(open(f"{ROOT}/themes/themes.json"))["themes"]
CATALOG = json.load(open(f"{ROOT}/campaigns-catalog.json"))
MASTER = open(f"{ROOT}/templates/master-marketing.liquid.html").read()
RESEND_KEY = os.getenv("RESEND_KEY", "")

TOKENS = ["brand_name", "tagline", "font", "accent", "accent_text", "ink", "paper", "surface",
          "border", "muted", "stat_num", "stat_label", "footer", "cta_url_default", "img1", "img2", "img3"]


def compile_theme(master: str, theme: dict) -> str:
    out = master
    for k in TOKENS:
        out = out.replace(f"__{k.upper()}__", str(theme.get(k, "")))
    return out


def render(brand_tpl: str, copy: dict, theme: dict) -> str:
    accent_text = theme.get("accent_text", "#b3402c")
    # heading: [[word]] -> accent span
    heading = re.sub(r"\[\[(.+?)\]\]", rf"<span style='color:{accent_text};'>\1</span>", copy.get("heading", ""))
    h = brand_tpl
    h = re.sub(r"\{\{\s*campaign_eyebrow[^}]*\}\}", copy.get("eyebrow", ""), h)
    h = re.sub(r"\{\{\s*campaign_heading[^}]*\}\}", heading, h)
    h = re.sub(r"\{\{\s*campaign_cta[^}]*\}\}", copy.get("cta", ""), h)
    h = re.sub(r"\{\{\s*user\.gen_subject[^}]*\}\}", copy.get("subject", ""), h)
    h = re.sub(r"\{\{\s*user\.gen_body_html[^}]*\}\}", copy.get("intro", ""), h)
    h = re.sub(r"\{\{\s*catalog_url[^}]*\}\}", theme.get("cta_url_default", "#"), h)
    h = re.sub(r"\{\{\s*unsubscribe_url[^}]*\}\}", "#", h)
    return re.sub(r"\{\{[^}]*\}\}", "", h)  # strip any leftover


def build(theme_name: str, scenario: str) -> tuple:
    theme = THEMES[theme_name]
    copy = CATALOG[scenario]
    brand = compile_theme(MASTER, theme)
    return render(brand, copy, theme), copy.get("subject", scenario)


def send(html: str, subject: str, to: str):
    payload = {"from": "Zavod <onboarding@resend.dev>", "to": to, "subject": f"[универсал] {subject}", "html": html}
    json.dump(payload, open("/tmp/ce.json", "w"), ensure_ascii=False)
    out = subprocess.run(["curl", "-s", "--max-time", "20", "-X", "POST", "https://api.resend.com/emails",
        "-H", f"Authorization: Bearer {RESEND_KEY}", "-H", "Content-Type: application/json",
        "--data", "@/tmp/ce.json"], capture_output=True, text=True).stdout
    os.remove("/tmp/ce.json")
    return json.loads(out).get("id") if out.strip().startswith("{") else out[:80]


if __name__ == "__main__":
    theme_name, scenario = sys.argv[1], sys.argv[2]
    html, subject = build(theme_name, scenario)
    leftover = "{{" in html
    print(f"compiled {theme_name}/{scenario}: {len(html)}B leftover-liquid={leftover}")
    if "--send" in sys.argv:
        to = sys.argv[sys.argv.index("--send") + 1]
        print("  sent id=", send(html, subject, to))
    else:
        path = f"/tmp/email_{theme_name}_{scenario}.html"
        open(path, "w").write(html); print("  saved", path)
