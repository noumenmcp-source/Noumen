"""Per-profile catalog showcase for emails. Picks relevant zavod.dev catalog sections for a user's
traits and renders an email-safe HTML block. webp images are proxied to png (images.weserv.nl) so they
render in Apple Mail / Outlook too. Canonical version; the standalone scripts/catalog_personalize.py mirrors it."""
import json
import urllib.parse
import urllib.request

SECTIONS_URL = "https://aiml.pm99lvl.workers.dev/catalog/v2/sections.json"
_cache = None


def _fetch_sections():
    global _cache
    if _cache is None:
        # Cloudflare fronts the worker — send a browser-like UA or it 403s.
        req = urllib.request.Request(SECTIONS_URL, headers={"User-Agent": "Mozilla/5.0 (zavod-cdp)"})
        with urllib.request.urlopen(req, timeout=15) as r:
            _cache = json.load(r)
    return _cache


def _png(image_url: str, w: int = 240) -> str:
    """Wrap a (possibly webp) image through an email-safe converter -> png."""
    bare = image_url.split("://", 1)[-1]
    return f"https://images.weserv.nl/?url={urllib.parse.quote(bare, safe='')}&w={w}&output=png"


def pick_showcase(traits: dict, n: int = 3) -> list:
    sections = _fetch_sections()
    keywords = [str(v).lower() for v in (traits or {}).values() if isinstance(v, str)]
    matched, seen = [], set()
    for s in sections:
        hay = " ".join([s["slug"], s["name"]] + [c["name"] for c in s.get("categories", [])]).lower()
        if any(k in hay for k in keywords):
            matched.append(s); seen.add(s["slug"])
    matched.sort(key=lambda x: x["count"], reverse=True)
    if len(matched) < n:  # fallback: biggest sections by count
        for s in sorted(sections, key=lambda x: x["count"], reverse=True):
            if s["slug"] not in seen:
                matched.append(s)
            if len(matched) >= n:
                break
    return [{"name": s["name"], "image": s["image"], "count": s["count"],
             "url": f"https://zavod.dev/catalog/{s['slug']}"} for s in matched[:n]]


def render_showcase_html(items: list) -> str:
    if not items:
        return ""
    cards = []
    for it in items:
        cards.append(
            f'<td width="33%" valign="top" style="padding:7px;">'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:#fffdf7;border:1px solid #e5e0d4;border-radius:14px;overflow:hidden;">'
            f'<tr><td height="168" align="center" valign="middle" bgcolor="#ffffff" style="padding:14px;">'
            f'<a href="{it["url"]}"><img src="{_png(it["image"], 480)}" alt="{it["name"]}" width="180" '
            f'style="display:block;max-width:100%;max-height:140px;border:0;"></a></td></tr>'
            f'<tr><td style="padding:16px 16px 18px 16px;border-top:1px solid #e5e0d4;">'
            f'<div style="font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;'
            f'letter-spacing:1.2px;text-transform:uppercase;color:#b3402c;">Раздел</div>'
            f'<div style="font-family:Inter,Arial,sans-serif;font-size:16px;font-weight:700;'
            f'color:#1a1410;line-height:1.25;margin-top:7px;">{it["name"]}</div>'
            f'<div style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#6b6258;'
            f'margin-top:8px;">{it["count"]} позиций</div></td></tr></table></td>'
        )
    return ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="margin-top:18px;"><tr>' + "".join(cards) + "</tr></table>")


def build_showcase(traits: dict, n: int = 3) -> str:
    """Network-safe convenience: returns the showcase HTML, or '' on any failure."""
    try:
        return render_showcase_html(pick_showcase(traits, n))
    except Exception:
        return ""
