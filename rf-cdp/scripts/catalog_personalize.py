import json
import urllib.request

# Cache for fetched catalog sections
catalog_cache = None

def fetch_catalog_sections(url):
    global catalog_cache
    if catalog_cache is None:
        # Cloudflare in front of the catalog worker blocks the default urllib UA — send a browser-like one.
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (zavod-cdp)"})
        with urllib.request.urlopen(req, timeout=15) as response:
            catalog_cache = json.load(response)
    return catalog_cache

def pick_showcase(traits, n=3):
    sections = fetch_catalog_sections("https://aiml.pm99lvl.workers.dev/catalog/v2/sections.json")
    matched_sections = []

    # Keywords from traits to match against section metadata
    keywords = [value.lower() for value in traits.values() if isinstance(value, str)]

    # Rank sections based on matches
    for section in sections:
        slug = section['slug'].lower()
        name = section['name'].lower()
        category_names = [category['name'].lower() for category in section['categories']]
        
        if any(keyword in slug or keyword in name or any(keyword in cat for cat in category_names) for keyword in keywords):
            matched_sections.append(section)

    # Sort matches by count in descending order
    matched_sections.sort(key=lambda x: x['count'], reverse=True)

    # Fallback: if nothing matched the traits, fill with the biggest sections by count.
    if len(matched_sections) < n:
        seen = {s['slug'] for s in matched_sections}
        for section in sorted(sections, key=lambda x: x['count'], reverse=True):
            if section['slug'] not in seen:
                matched_sections.append(section)
            if len(matched_sections) >= n:
                break

    # Prepare the top n sections
    showcase = []
    for section in matched_sections[:n]:
        showcase.append({
            'name': section['name'],
            'image': section['image'],
            'count': section['count'],
            'url': f"https://zavod.dev/catalog/{section['slug']}"
        })

    return showcase

def render_showcase_html(items):
    html_snippet = '<table style="border-collapse: collapse; width: 100%;">'
    for item in items:
        html_snippet += '<tr>'
        html_snippet += f'<td style="width: 33%; padding: 10px; background: white;">'
        html_snippet += f'<img src="{item["image"]}" style="max-height: 90px;" />'
        html_snippet += f'<div style="color: #1a1410; font-weight: 700;">{item["name"]}</div>'
        html_snippet += f'<div style="color: #6b6258;">{item["count"]} позиций</div>'
        html_snippet += '</td>'
        html_snippet += '</tr>'
    html_snippet += '</table>'
    return html_snippet

if __name__ == "__main__":
    print(pick_showcase({'interest':'робот'}))