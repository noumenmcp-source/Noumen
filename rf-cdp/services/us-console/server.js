'use strict';
/*
 * axiom console (US) — English. Left section menu
 * (Today/Overview/Profiles/Segments/Sources/Email/Consent/Services),
 * server-side aggregation from Elasticsearch (cdp_events_<site>,
 * cdp_consent_<site>). US sources (Instagram/TikTok/Reddit/YouTube/marketplaces).
 * Zero-dep: Node http + global fetch. ES creds in env, never sent to the browser.
 */
const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8122', 10);
const ES_URL = (process.env.ES_URL || 'http://localhost:9200').replace(/\/$/, '');
const ES_USER = process.env.ES_USER || 'elastic';
const ES_PASSWORD = process.env.ES_PASSWORD || '';
const ES_AUTH = 'Basic ' + Buffer.from(ES_USER + ':' + ES_PASSWORD).toString('base64');

const TENANT_RE = /^[a-z0-9_-]+$/i;
const DAY = 86400000;

async function es(path, body) {
  const res = await fetch(ES_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: ES_AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404) return { _missing: true };
  if (!res.ok) throw new Error('ES ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : {};
}

async function listTenants() {
  const rows = await es('/_cat/indices/cdp_events_*?format=json&h=index,docs.count');
  if (rows._missing || !Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ tenant: r.index.replace('cdp_events_', ''), docs: parseInt(r['docs.count'] || '0', 10) }))
    .filter((t) => TENANT_RE.test(t.tenant))
    .sort((a, b) => b.docs - a.docs);
}

// ─── US sources: origin → label + tone ──────────────────────────────
const SOURCE_MAP = [
  [/instagram|\big\b|fb\.com|facebook|fbclid/i, 'Instagram', 'gold'],
  [/tiktok|\btt\b/i, 'TikTok', 'sage'],
  [/reddit/i, 'Reddit', 'gold'],
  [/youtube|youtu\.be/i, 'YouTube', 'rust'],
  [/twitter|\bx\.com\b|t\.co/i, 'X (Twitter)', 'rust'],
  [/pinterest/i, 'Pinterest', 'sage'],
  [/linkedin/i, 'LinkedIn', 'gold'],
  [/amazon/i, 'Amazon', 'rust'],
  [/walmart|etsy/i, 'Marketplace', 'sage'],
  [/google|bing/i, 'Search', 'muted'],
];
function mapSource(origin) {
  const o = String(origin || '').trim();
  if (!o || o === '(direct)' || o === 'direct' || o === 'null') return { label: 'Direct', tone: 'muted' };
  for (const [re, label, tone] of SOURCE_MAP) if (re.test(o)) return { label, tone };
  return { label: o.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 28), tone: 'sage' };
}

// ─── Lifecycle by recency ────────────────────────────────────────────────
function bucketLifecycle(profiles, nowMs) {
  const b = { New: 0, Active: 0, Dormant: 0, Lost: 0 };
  for (const p of profiles) {
    const ageFirst = nowMs - (p.firstSeen ? Date.parse(p.firstSeen) : 0);
    const ageLast = nowMs - (p.lastSeen ? Date.parse(p.lastSeen) : 0);
    if (ageFirst <= 7 * DAY) b.New++;
    else if (ageLast <= 7 * DAY) b.Active++;
    else if (ageLast <= 30 * DAY) b.Dormant++;
    else b.Lost++;
  }
  return b;
}
const LIFECYCLE_TONE = { New: 'sage', Active: 'gold', Dormant: 'rust', Lost: 'muted' };
const LIFECYCLE_DESC = { New: 'first visit ≤7 days', Active: 'visit ≤7 days', Dormant: 'visit 7–30 days', Lost: 'visit >30 days' };

async function profilesOf(tenant) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0, aggs: { profiles: { terms: { field: 'anonymous_id.keyword', size: 5000 }, aggs: { fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } } } } },
  });
  if (q._missing) return [];
  return ((q.aggregations && q.aggregations.profiles.buckets) || []).map((b) => ({ id: b.key, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string }));
}

// ─── Profiles (table) ────────────────────────────────────────────────────────
async function profilesList(tenant, limit) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    aggs: {
      profiles: {
        terms: { field: 'anonymous_id.keyword', size: Math.min(limit || 200, 500), order: { ls: 'desc' } },
        aggs: {
          fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } },
          last: { top_hits: { size: 1, sort: [{ ts: 'desc' }], _source: ['user_id', 'event', 'origin', 'properties', 'traits'] } },
          evs: { terms: { field: 'event.keyword', size: 5 } },
          rev: { filter: { term: { 'event.keyword': 'order_completed' } }, aggs: { sum: { sum: { field: 'properties.revenue' } } } },
        },
      },
    },
  });
  if (q._missing) return [];
  return ((q.aggregations && q.aggregations.profiles.buckets) || []).map((b) => {
    const s = (b.last.hits.hits[0] || {})._source || {};
    const tr = s.traits || {};
    return {
      id: b.key, count: b.doc_count, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string,
      userId: s.user_id || null, origin: s.origin || null, lastEvent: s.event || null,
      name: tr.name || null, city: tr.city || null,
      revenue: Math.round((b.rev && b.rev.sum && b.rev.sum.value) || 0),
      events: ((b.evs && b.evs.buckets) || []).map((e) => ({ event: e.key, count: e.doc_count })),
    };
  });
}

const PURPOSE_RU = {
  personal_data: 'Personal data', pdn_processing: 'Personal data', marketing: 'Marketing',
  marketing_email: 'Email marketing', marketing_messaging: 'SMS / messaging', analytics: 'Analytics',
  third_party_transfer: 'Sale / share to third parties', cross_border: 'Cross-border transfer',
};
async function consentStats(tenant) {
  const q = await es('/cdp_consent_' + tenant + '/_search', {
    size: 0, track_total_hits: true, aggs: { purposes: { terms: { field: 'consent.purposes.keyword', size: 12 } } },
  }).catch(() => ({ _missing: true }));
  if (q._missing) return { total: 0, purposes: [] };
  const total = (q.hits && q.hits.total && q.hits.total.value) || 0;
  const purposes = ((q.aggregations && q.aggregations.purposes.buckets) || []).map((b) => ({ purpose: b.key, label: PURPOSE_RU[b.key] || b.key, count: b.doc_count }));
  return { total, purposes };
}

async function aggregate(tenant, nowMs) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const idx = '/cdp_events_' + tenant;
  const main = await es(idx + '/_search', {
    size: 0, track_total_hits: true,
    aggs: {
      uniq: { cardinality: { field: 'anonymous_id.keyword' } },
      ident: { cardinality: { field: 'user_id.keyword' } },
      d7: { filter: { range: { ts: { gte: 'now-7d' } } } },
      d1: { filter: { range: { ts: { gte: 'now-24h' } } } },
      sources: { terms: { field: 'origin.keyword', size: 25 } },
      events: { terms: { field: 'event.keyword', size: 10 } },
      daily: { date_histogram: { field: 'ts', calendar_interval: 'day', min_doc_count: 0, extended_bounds: { min: 'now-29d/d', max: 'now/d' } } },
      orders: { filter: { term: { 'event.keyword': 'order_completed' } }, aggs: { rev: { sum: { field: 'properties.revenue' } } } },
    },
  });
  if (main._missing) throw new Error('index not found');
  const a = main.aggregations;

  const srcMap = new Map();
  for (const b of a.sources.buckets) {
    const m = mapSource(b.key);
    const cur = srcMap.get(m.label) || { label: m.label, tone: m.tone, value: 0 };
    cur.value += b.doc_count; srcMap.set(m.label, cur);
  }
  const sources = [...srcMap.values()].sort((x, y) => y.value - x.value).slice(0, 8);

  const profs = await profilesOf(tenant);
  const lc = bucketLifecycle(profs, nowMs);
  const lifecycle = Object.keys(lc).map((k) => ({ label: k, value: lc[k], tone: LIFECYCLE_TONE[k], desc: LIFECYCLE_DESC[k] }));
  const consent = await consentStats(tenant);
  const ord = a.orders || { doc_count: 0 };
  const daily = a.daily.buckets.map((b) => ({ label: new Date(b.key).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }), value: b.doc_count }));

  return {
    tenant,
    kpi: { profiles: a.uniq.value, identified: a.ident.value, events: (main.hits.total && main.hits.total.value) || 0, active7: a.d7.doc_count, active1: a.d1.doc_count },
    orders: { count: ord.doc_count || 0, revenue: Math.round((ord.rev && ord.rev.value) || 0) },
    sources, lifecycle, consent, daily,
    topEvents: a.events.buckets.map((b) => ({ label: b.key, value: b.doc_count, tone: 'sage' })),
  };
}

function send(res, code, data, type) {
  const body = type === 'html' ? data : JSON.stringify(data);
  res.writeHead(code, { 'content-type': type === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

// section paths — each serves the SPA shell; client shows the right section (deep-link)
const SEC_RE = /^\/(today|overview|profiles|segments|sources|email|automations|consent|services)$/;
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/' || p === '/index.html' || SEC_RE.test(p)) return send(res, 200, HTML, 'html');
    if (p === '/favicon.svg' || p === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public,max-age=86400' });
      return res.end(FAV);
    }
    if (p === '/health') return send(res, 200, { ok: true });
    const hdr = req.headers['x-cdp-tenant'];
    const locked = hdr && TENANT_RE.test(hdr) ? hdr : null;
    if (p === '/api/config') return send(res, 200, { locked });
    if (p === '/api/tenants') {
      const all = await listTenants();
      return send(res, 200, locked ? all.filter((t) => t.tenant === locked) : all);
    }
    const tenant = locked || u.searchParams.get('tenant');
    if (p === '/api/overview') { if (!tenant) return send(res, 400, { error: 'tenant required' }); return send(res, 200, await aggregate(tenant, Date.now())); }
    if (p === '/api/profiles') { if (!tenant) return send(res, 400, { error: 'tenant required' }); return send(res, 200, await profilesList(tenant, parseInt(u.searchParams.get('limit') || '200', 10))); }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log('us-console on :' + PORT + ' es=' + ES_URL));

module.exports = { mapSource, bucketLifecycle, aggregate, profilesList, listTenants, server };

// ─── favicon: Axiom orbit mark (gold on ink, zero-dep inline SVG) ────
const FAV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#1c1510"/><circle cx="16" cy="16" r="10" fill="none" stroke="#c9a84c" stroke-width="1.5"/><g fill="#c9a84c"><circle cx="16" cy="16" r="3.2"/><circle cx="16" cy="6" r="2"/><circle cx="7.34" cy="21" r="2"/><circle cx="24.66" cy="21" r="2"/></g></svg>`;

// ─── frontend: left menu + panels (Axiom style, SVG charts, zero-dep) ────
const HTML = /* html */ `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Axiom · Console</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
  :root{--gold:#c9a84c;--sage:#d9c07a;--rust:#c4683a;--ink:#1c1510;--muted:#7a6e60;--line:#332a20;--cream:#f5f0e8;--panel:#201811;--head:#1c1510}
  *{box-sizing:border-box}
  body{margin:0;background:#201811;color:var(--ink);font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh}
  .serif{font-family:Lora,Georgia,serif}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  /* sidebar */
  .side{width:230px;flex:none;background:var(--head);color:var(--cream);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:auto}
  .side .brand{padding:18px 20px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #3a2f25}
  .side .brand b{font-family:Lora,serif;font-size:20px;letter-spacing:.04em}
  .side .brand .bd{font-size:9px;letter-spacing:.12em;text-transform:uppercase;border:1px solid #5b4d3e;border-radius:20px;padding:2px 8px;color:var(--gold)}
  .nav{padding:10px 0;flex:1}
  .nav a{display:flex;align-items:center;gap:11px;padding:10px 20px;color:#c9bba9;cursor:pointer;font-size:14px;border-left:3px solid transparent}
  .nav a .ic{width:16px;text-align:center;opacity:.85}
  .nav a:hover{background:#2a2018;color:var(--cream)}
  .nav a.on{background:#2a2018;color:var(--cream);border-left-color:var(--gold)}
  .side .ft{padding:14px 20px;border-top:1px solid #3a2f25;font-size:11px;color:#8a7d6c}
  .mtop{display:none}.backdrop{display:none}
  .burger{background:none;border:0;color:var(--cream);font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
  .mbrand{font-family:Lora,Georgia,serif;font-weight:700;font-size:18px;letter-spacing:.04em}
  /* content */
  .content{flex:1;min-width:0;padding:24px 38px}
  .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
  .top h1{font-family:Lora,serif;font-size:26px;font-weight:700;margin:0}
  .top .sp{flex:1}
  select{background:#201811;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 11px;font:inherit;cursor:pointer}
  .grid{display:grid;gap:16px}
  .k4{grid-template-columns:repeat(4,1fr)} .two{grid-template-columns:1fr 1fr} .four{grid-template-columns:repeat(4,1fr)} .k3{grid-template-columns:repeat(3,1fr)}
  @media(max-width:900px){.k4,.two,.four,.k3{grid-template-columns:1fr 1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
  .card h2{font-family:Lora,serif;font-size:16px;font-weight:700;margin:0}
  .card .st{color:var(--muted);font-size:12px;margin:2px 0 13px}
  .tile .v{font-family:Lora,serif;font-size:28px;font-weight:700;line-height:1;margin-top:7px}
  .tile .h{color:var(--muted);font-size:12px;margin-top:6px}
  .bars{display:grid;gap:12px}
  .bar .tp{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:5px}
  .bar .cap{color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:11px}
  .track{height:9px;border-radius:9px;background:#201811;overflow:hidden}.fill{height:100%;border-radius:9px}
  .legend{display:grid;gap:7px;margin:0;padding:0}.legend li{display:flex;align-items:center;gap:8px;list-style:none}.legend .sw{width:11px;height:11px;border-radius:3px;flex:none}.legend .nm{font-weight:600}
  .vb{display:flex;align-items:flex-end;gap:4px;height:150px}.vb .col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.vb .rect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.vb .x{font-size:8px;color:var(--muted);margin-top:5px}
  .act{display:flex;flex-direction:column;justify-content:space-between;min-height:120px}
  .act .big{font-family:Lora,serif;font-size:30px;font-weight:700;line-height:1}
  .act .nm{font-weight:700;margin-bottom:3px}.act .c{color:var(--muted);font-size:12px}
  .act .cta{margin-top:10px;align-self:flex-start;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:8px;padding:5px 10px;color:var(--ink);background:#201811}
  .svc .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.svc .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}.svc .m{font-family:Lora,serif;font-size:19px;font-weight:700}.svc .c{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.35}.stat{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);display:flex;align-items:center;gap:4px}.stat .d{width:5px;height:5px;border-radius:50%;background:var(--sage)}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#201811}
  td.id{font-family:'JetBrains Mono',monospace;color:var(--rust)}
  .idn{display:inline-block;padding:2px 7px;border-radius:6px;background:rgba(216,183,94,.14);color:var(--sage);font-size:11px}.anon{color:var(--muted)}
  .chip{font-size:10px;background:#201811;border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--muted);margin-right:4px}
  .muted{color:var(--muted)} .err{color:#b3402a;background:#c4683a18;border:1px solid #c4683a55;border-radius:8px;padding:12px;margin-bottom:14px}
  .sec{margin:22px 0 12px}.note{background:#201811;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;color:#6b5d4d;font-size:13px;margin-bottom:16px}
  .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* ── mobile responsive ── */
  @media(max-width:760px){
    .mtop{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:30;background:var(--head);color:var(--cream);margin:-16px -14px 14px;padding:12px 16px}
    .side{position:fixed;left:0;top:0;height:100vh;width:250px;transform:translateX(-100%);transition:transform .22s ease;z-index:60;box-shadow:0 0 40px rgba(0,0,0,.45)}
    body.menu .side{transform:none}
    .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:55}
    body.menu .backdrop{display:block}
    .content{padding:16px 14px}
    .top{flex-wrap:wrap;gap:10px}.top h1{font-size:21px}
    .k4,.four{grid-template-columns:1fr 1fr}.two,.k3{grid-template-columns:1fr}
    .vb{height:120px}.vb .x{display:none}
    .act{min-height:auto}
    table{font-size:12px}th,td{padding:8px 9px}
  }
  @media(max-width:430px){
    .four,.k3{grid-template-columns:1fr}
    .tile .v{font-size:22px}.tile{padding:13px}.act .big{font-size:24px}
    .top h1{font-size:20px}select{max-width:46vw}
  }
/* ── EMAIL MODULE · sub-nav ── */
.em-module{display:block}
.em-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #332a20}
.em-tab{display:inline-flex;align-items:center;gap:7px;background:#201811;border:1px solid #332a20;border-radius:10px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;color:#7a6e60;cursor:pointer;transition:border-color .12s,color .12s,background .12s,box-shadow .12s}
.em-tab:hover{border-color:#c9a84c;color:#1c1510}
.em-tab.on{background:#201811;border-color:#c9a84c;color:#1c1510;box-shadow:inset 0 0 0 1px #c9a84c}
.em-tab-ic{font-size:14px;color:#c9a84c;line-height:1}
.em-tab-lb{line-height:1}
.em-panel{display:block}
@media(max-width:640px){.em-tab-lb{display:none}.em-tab{padding:9px 12px}.em-tab-ic{font-size:16px}}

/* ── campaigns ── */
.em-cname{font-size:14px;line-height:1.3;display:block;max-width:280px;color:var(--ink,#1c1510)}
.em-tmpl{font-family:'JetBrains Mono',monospace;font-size:11px;color:#d9c07a;background:#201811;padding:2px 6px;border-radius:5px;white-space:nowrap}
.em-typ{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap;display:inline-block}
.em-typ-flow{color:#c4683a;background:rgba(196,104,58,.10);border:1px solid rgba(196,104,58,.25)}
.em-typ-bc{color:#d9c07a;background:rgba(216,183,94,.10);border:1px solid rgba(216,183,94,.25)}
.em-when{display:block;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink,#1c1510);white-space:nowrap}
.em-when-hint{display:block;font-size:10px;color:#7a6e60;margin-top:1px}
.em-num{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--ink,#1c1510);white-space:nowrap}
.em-metric{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink,#1c1510);white-space:nowrap;line-height:1.1}
.em-mini{display:block;margin-top:3px;width:54px;height:4px;background:#332a20;border-radius:3px;overflow:hidden;margin-left:auto}
.em-mini-fill{display:block;height:100%;border-radius:3px}
.em-row-soft td{opacity:.72}
.em-cab-row td{background:#201811;border-top:none;padding-top:0}
.em-cab{padding:4px 2px 10px 2px}
.em-cab .label{display:block;margin-bottom:6px}
.em-cab-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.em-cab-var{border:1px solid #332a20;border-radius:8px;padding:8px 10px;background:#201811;position:relative}
.em-cab-win{border-color:#c9a84c;background:rgba(201,168,76,.07);box-shadow:0 0 0 1px rgba(201,168,76,.25) inset}
.em-cab-tag{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#7a6e60;margin-bottom:4px}
.em-cab-win .em-cab-tag{color:#c9a84c}
.em-cab-subj{display:block;font-size:13px;color:var(--ink,#1c1510);line-height:1.35;margin-bottom:5px}
.em-cab-open{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:11px;color:#7a6e60}
.em-cab-var .em-mini{margin-left:0;margin-top:4px;width:100%}
.em-cab-uplift{display:block;margin-top:8px;font-size:12px;color:#d9c07a}
.em-cab-uplift b{color:#c9a84c}
.em-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #332a20;font-size:12px;color:#7a6e60}
.em-legend>span{display:inline-flex;align-items:center;gap:6px}
@media(max-width:760px){.em-cab-grid{grid-template-columns:1fr}.em-cname{max-width:none}}

/* ── builder ── */
.em-build{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;margin-top:16px}
.em-col-left{display:flex;flex-direction:column}
.em-palette{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.em-palbtn{display:flex;flex-direction:column;align-items:flex-start;gap:3px;position:relative;background:#201811;border:1px solid var(--line);border-radius:9px;padding:9px 10px;cursor:pointer;text-align:left;transition:border-color .12s,transform .06s,box-shadow .12s}
.em-palbtn:hover{border-color:var(--gold);box-shadow:0 2px 10px rgba(201,168,76,.18)}
.em-palbtn:active{transform:translateY(1px)}
.em-pal-ic{font-size:16px;color:var(--gold);line-height:1}
.em-pal-nm{font-size:12px;font-weight:600;color:var(--ink);line-height:1.2}
.em-pal-plus{position:absolute;top:7px;right:9px;font-size:12px;color:var(--muted);font-weight:700}
.em-palbtn:hover .em-pal-plus{color:var(--gold)}
.em-st-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:7px;background:#201811}
.em-st-ic{width:18px;text-align:center;color:var(--gold)}
.em-st-nm{flex:1;font-size:12px;font-weight:600}
.em-st-ctl{display:flex;gap:4px}
.em-mv{width:24px;height:24px;border:1px solid var(--line);border-radius:6px;background:#201811;cursor:pointer;font-size:12px;line-height:1;color:var(--ink);padding:0}
.em-mv:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.em-mv:disabled{opacity:.35;cursor:default}
.em-mv.em-del:hover{border-color:var(--rust);color:var(--rust)}
.em-vars{display:flex;flex-wrap:wrap;gap:6px}
.em-var{font-family:'JetBrains Mono',monospace;font-size:10px;background:rgba(216,183,94,.1);border:1px solid rgba(216,183,94,.4);color:var(--sage);border-radius:6px;padding:3px 8px;cursor:pointer}
.em-var:hover{background:rgba(216,183,94,.2)}
.em-subject-card{margin-bottom:16px}
.em-input{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:15px/1.4 Lora,Georgia,serif;color:var(--ink);background:#201811;margin-top:6px}
.em-input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.16)}
.em-inbox{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#201811;margin-top:6px}
.em-inbox-av{width:38px;height:38px;flex:none;border-radius:50%;background:rgba(216,183,94,.16);display:flex;align-items:center;justify-content:center;font-size:19px}
.em-inbox-body{min-width:0;flex:1}
.em-inbox-from{font-size:13px}
.em-inbox-from b{color:var(--ink)} .em-inbox-mail{color:var(--muted);font-size:11px}
.em-inbox-subj{font-family:Lora,Georgia,serif;font-weight:700;font-size:15px;color:var(--ink);margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em-inbox-snip{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em-col-canvas{position:sticky;top:18px}
.em-canvas-bar{display:flex;align-items:center;gap:6px;background:var(--head);border-radius:10px 10px 0 0;padding:9px 13px}
.em-cb-dot{width:8px;height:8px;border-radius:50%;background:#5b4d3e}
.em-cb-dot:nth-child(1){background:var(--rust)} .em-cb-dot:nth-child(2){background:var(--gold)} .em-cb-dot:nth-child(3){background:var(--sage)}
.em-cb-w{margin-left:8px;font-size:10px;color:#a89a86;text-transform:uppercase;letter-spacing:.05em}
.em-letter{background:#201811;border:1px solid var(--line);border-top:none;border-radius:0 0 10px 10px;padding:0;max-width:600px;margin:0 auto;overflow:hidden;box-shadow:0 8px 30px rgba(28,21,16,.08)}
.em-empty{padding:60px 20px;text-align:center;color:var(--muted);font-size:13px}
.em-bk{padding:18px 26px}
.em-bk-header{padding:16px 26px;border-bottom:2px solid rgba(201,168,76,.3)}
.em-logo{font-family:Lora,Georgia,serif;font-size:21px;font-weight:700;color:var(--ink)}
.em-logo .em-leaf{margin-right:6px}
.em-tag{text-align:right;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.em-bk-hero{text-align:center;background:linear-gradient(160deg,#201811,#201811);padding:34px 26px;border-bottom:1px solid var(--line)}
.em-hero-emoji{font-size:38px;margin-bottom:8px}
.em-hero-h{font-size:25px;font-weight:700;color:var(--ink);line-height:1.15;max-width:420px;margin:0 auto 8px}
.em-hero-s{font-size:14px;color:#6b5d4d;max-width:380px;margin:0 auto;line-height:1.45}
.em-bk-text p{margin:0;font-size:14px;line-height:1.6;color:#3a3128}
.em-bk-cta{text-align:center;padding:8px 26px 22px}
.em-btn{display:inline-block;background:var(--gold);color:#1c1510;font-weight:700;font-size:14px;text-decoration:none;padding:13px 30px;border-radius:9px;letter-spacing:.01em}
.em-bk-products{padding:18px 18px 22px}
.em-prod-title{font-size:17px;font-weight:700;color:var(--ink);text-align:center;margin-bottom:14px}
.em-prod{width:33.33%;vertical-align:top;text-align:center;padding:0 7px}
.em-prod-img{font-size:30px;background:#201811;border-radius:10px;padding:16px 0;margin-bottom:7px}
.em-prod-name{font-size:12px;font-weight:600;color:var(--ink);line-height:1.25;min-height:30px}
.em-prod-cap{font-size:10px;color:var(--muted);line-height:1.3;margin:3px 0 5px;min-height:24px}
.em-prod-price{font-family:Lora,Georgia,serif;font-size:16px;font-weight:700;color:var(--sage)}
.em-prod-buy{margin-top:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--rust);border:1px solid rgba(196,104,58,.4);border-radius:7px;padding:5px 0}
.em-bk-promo{margin:4px 22px 6px;text-align:center;background:#1c1510;border-radius:12px;padding:20px}
.em-promo-txt{color:#201811;font-size:13px;margin-bottom:8px}
.em-promo-code{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;letter-spacing:.12em;color:var(--gold);border:1.5px dashed var(--gold);border-radius:9px;padding:8px 20px}
.em-promo-exp{color:#a89a86;font-size:11px;margin-top:9px;text-transform:uppercase;letter-spacing:.04em}
.em-bk-divider{text-align:center;padding:8px 0}
.em-bk-divider .em-dot{color:var(--gold);font-size:18px;letter-spacing:.3em}
.em-bk-social{text-align:center;padding:14px 26px}
.em-soc{display:inline-block;width:38px;height:38px;line-height:38px;border-radius:50%;font-weight:700;font-size:12px;text-decoration:none;margin:0 5px;color:#201811}
.em-soc-vk{background:#d9c07a} .em-soc-tg{background:#c4683a}
.em-soc-cap{font-size:11px;color:var(--muted);margin-top:9px}
.em-bk-footer{background:#201811;padding:18px 26px;border-top:1px solid var(--line)}
.em-foot-adv{font-size:11px;color:#6b5d4d;line-height:1.45}
.em-foot-law{font-size:10px;color:var(--muted);line-height:1.5;margin-top:7px}
.em-foot-unsub{font-size:11px;margin-top:9px}
.em-foot-unsub a{color:var(--sage);font-weight:600}
.em-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.em-preset{text-align:left;background:#201811;border:1px solid var(--line);border-radius:10px;padding:12px 13px;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.em-preset:hover{border-color:var(--gold);box-shadow:0 2px 12px rgba(201,168,76,.16)}
.em-preset.on{border-color:var(--gold);background:#201811;box-shadow:inset 0 0 0 1px var(--gold)}
.em-preset-nm{font-family:Lora,Georgia,serif;font-weight:700;font-size:14px;color:var(--ink)}
.em-preset-cap{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
.em-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}
.em-act{border:1px solid var(--line);background:#201811;border-radius:9px;padding:10px 18px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink)}
.em-act:hover{border-color:var(--gold)}
.em-act-primary{background:var(--gold);border-color:var(--gold);color:#1c1510}
.em-act-primary:hover{filter:brightness(.96)}
.em-flash{font-size:12px;color:var(--sage);opacity:0;transition:opacity .25s}
@media(max-width:900px){
  .em-build{grid-template-columns:1fr}
  .em-col-canvas{position:static}
  .em-presets{grid-template-columns:1fr 1fr}
}
@media(max-width:560px){
  .em-palette{grid-template-columns:1fr 1fr}
  .em-presets{grid-template-columns:1fr}
  .em-bk,.em-bk-header,.em-bk-cta,.em-bk-social,.em-bk-footer{padding-left:16px;padding-right:16px}
  .em-hero-h{font-size:21px}
}

/* ── flows ── */
.em-flows-kpi{margin-bottom:14px}
.em-flows-list{display:flex;flex-direction:column;gap:16px;margin-top:12px}
.em-flow{padding:16px 16px 14px}
.em-flow-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #332a20}
.em-flow-ttl{display:flex;align-items:center;gap:11px}
.em-flow-ico{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#201811;font-size:17px;flex:0 0 auto}
.em-flow-name{font-size:17px;color:#1c1510;line-height:1.15}
.em-flow-sub{color:#7a6e60;margin-top:2px;letter-spacing:.04em}
.em-canvas-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;padding:4px 0 2px}
.em-node{flex:0 1 auto;min-width:158px;max-width:220px;background:#201811;border:1px solid #332a20;border-left-width:4px;border-radius:9px;padding:9px 11px 10px;box-shadow:0 1px 2px rgba(28,21,16,.04)}
.em-node-h{display:flex;align-items:center;gap:7px;margin-bottom:5px}
.em-node-ico{width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#201811;font-size:11px;flex:0 0 auto}
.em-node-k{color:#7a6e60;font-size:10px;letter-spacing:.07em}
.em-node-t{font-size:13.5px;color:#1c1510;line-height:1.22;font-weight:600}
.em-node-b{font-size:11.5px;line-height:1.34;margin-top:4px;color:#7a6e60}
.em-node-b b{color:#d9c07a;font-weight:600}
.em-node-cond{background:#201811}
.em-node-goal{background:#201811}
.em-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 2px;align-self:center;flex:0 0 auto;min-width:34px}
.em-arrow svg{display:block}
.em-arrow-lbl{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#7a6e60;margin-top:1px;text-align:center;line-height:1.1;max-width:46px}
.em-fstats{display:flex;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid #332a20;flex-wrap:wrap}
.em-fstat{flex:1 1 90px;display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:#201811;border:1px solid #332a20;border-radius:8px}
.em-fstat-v{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:#1c1510}
.em-fstat-l{color:#7a6e60}
.em-flows-foot{margin-top:16px}
@media (max-width:640px){
.em-canvas-flow{flex-direction:column;align-items:stretch}
.em-node{max-width:none;min-width:0;width:100%}
.em-arrow{flex-direction:row;min-width:0;padding:3px 0}
.em-arrow svg{transform:none}
.em-arrow-lbl{margin-top:0;margin-left:6px;max-width:none}
}

/* ── audiences ── */
.em-seg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.em-seg{display:flex;flex-direction:column;gap:10px}
.em-seg-hd{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.em-dot{width:9px;height:9px;border-radius:50%;flex:none}
.em-seg-name{font-size:16px;font-weight:700;color:#1c1510;flex:1;min-width:0;line-height:1.15}
.em-seg-hint{font-size:12px;line-height:1.45;margin:0}
.em-rules{display:flex;flex-wrap:wrap;gap:6px}
.em-rule{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-family:'JetBrains Mono',monospace;padding:3px 8px;border-radius:6px;border:1px solid;white-space:nowrap}
.em-rule .em-op{color:#7a6e60;font-weight:700;padding:0 1px}
.em-reachbar{height:7px;border-radius:5px;background:#332a20;overflow:hidden;margin-top:2px}
.em-reach-fill{height:100%;border-radius:5px;transition:width .4s ease}
.em-reach-line{font-size:13px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.em-reach-no{color:#c4683a;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.02em}
.em-reach-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.em-reach-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:220px}
.em-reach-legend li{display:flex;align-items:center;gap:8px;font-size:13px}
.em-sw{width:11px;height:11px;border-radius:3px;flex:none}
.em-lg-nm{flex:1;color:#1c1510}
.em-lg-v{color:#7a6e60;font-family:'JetBrains Mono',monospace;font-size:12px;white-space:nowrap}
.em-builder{display:flex;flex-direction:column;gap:14px}
.em-build-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.em-build-tag{flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:5px 10px;border-radius:6px;border:1px solid;align-self:flex-start;white-space:nowrap}
.em-build-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1;min-width:0}
.em-join{font-size:10px;font-weight:800;letter-spacing:.05em;padding:0 4px;align-self:center}
.em-and{color:#d9c07a}
.em-or{color:#c9a84c}
.em-fields-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;border-top:1px solid #332a20;padding-top:14px}
.em-field{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:#201811;border-radius:7px;border:1px solid #332a20}
.em-field-n{font-size:12px;font-weight:700;color:#1c1510;font-family:'JetBrains Mono',monospace}
.em-field-ex{font-size:11px;line-height:1.35}

/* ── abtest ── */
.em-ab-table{width:100%;border-collapse:collapse}
.em-ab-table th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#7a6e60;font-weight:600;padding:8px 10px;border-bottom:1px solid #332a20;white-space:nowrap}
.em-ab-table td{padding:11px 10px;border-bottom:1px solid #201811;vertical-align:top}
.em-ab-table tr:last-child td{border-bottom:none}
.em-ab-table tr:hover td{background:#201811}
.em-ab-c{text-align:center;white-space:nowrap}
.em-ab-name{font-family:Lora,Georgia,serif;font-size:14px;color:#1c1510;line-height:1.25;margin-bottom:3px;max-width:240px}
.em-ab-var{display:flex;gap:8px;flex-wrap:nowrap}
.em-ab-m{display:flex;flex-direction:column;align-items:center;min-width:42px;padding:4px 6px;border:1px solid #332a20;border-radius:7px;background:#201811;line-height:1}
.em-ab-m b{font-family:'JetBrains Mono',monospace;font-size:12px;color:#1c1510;font-weight:600}
.em-ab-m i{font-style:normal;font-size:9px;letter-spacing:.02em;color:#7a6e60;margin-top:3px;text-transform:uppercase}
.em-ab-win .em-ab-m{border-color:#d9c07a;background:#201811}
.em-ab-win .em-ab-m b{color:#3c6549}
.em-ab-pos{font-family:'JetBrains Mono',monospace;font-weight:600;color:#d9c07a}
.em-ab-neg{font-family:'JetBrains Mono',monospace;font-weight:600;color:#c4683a}
.mono{font-family:'JetBrains Mono',monospace}
.em-ab-show{display:flex;flex-direction:column;gap:12px}
.em-ab-verdict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px dashed #332a20;font-size:13px}
.em-ab-up{font-family:'JetBrains Mono',monospace;color:#d9c07a;font-weight:700;font-size:15px}
.em-ab-note{margin-top:14px;line-height:1.55}
@media(max-width:760px){.em-ab-var{gap:5px}.em-ab-m{min-width:38px;padding:3px 4px}.em-ab-name{max-width:none}}

/* ── deliverability ── */
.em-auth{display:flex;flex-direction:column;gap:8px}
.em-auth-h{display:flex;align-items:center;justify-content:space-between;gap:8px}
.em-auth-k{font-size:16px;font-weight:700;letter-spacing:.02em}
.em-auth-rec{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--ink);background:#201811;border:1px solid var(--line);border-radius:6px;padding:6px 8px;line-height:1.4;word-break:break-all}
.em-auth-note{font-size:11px;color:var(--muted);line-height:1.35}
.em-gauge{margin-bottom:16px}
.em-gauge:last-child{margin-bottom:0}
.em-gauge-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px}
.em-gauge-v{font-family:Lora,serif;font-size:26px;font-weight:700;line-height:1}
.em-gauge-u{font-size:12px;color:var(--muted);font-weight:400}
.em-gauge-track{height:11px;border-radius:11px;background:#201811;border:1px solid var(--line);overflow:hidden}
.em-gauge-fill{height:100%;border-radius:11px}
.em-gauge-sub{font-size:12px;color:var(--muted);margin-top:7px}
.em-warm{display:flex;align-items:flex-end;gap:10px;height:150px;margin-top:8px}
.em-warm-step{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.em-warm-bar{width:100%;max-width:54px;height:100px;background:#201811;border-radius:6px 6px 0 0;display:flex;align-items:flex-end;overflow:hidden}
.em-warm-fill{width:100%;border-radius:6px 6px 0 0;min-height:3px;transition:height .3s}
.em-warm-d{font-size:11px;font-weight:600;margin-top:7px;color:var(--ink)}
.em-warm-cap{font-size:9.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px}
.em-pl-legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;font-size:11px;color:var(--muted)}
.em-pl-legend span{display:inline-flex;align-items:center;gap:6px}
.em-pl-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.em-pl{margin-bottom:15px}
.em-pl:last-child{margin-bottom:0}
.em-pl-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px}
.em-pl-name{font-size:14px;font-weight:700}
.em-pl-share{color:var(--muted)}
.em-pl-track{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#201811;border:1px solid var(--line)}
.em-pl-seg{height:100%}
.em-pl-num{display:flex;gap:14px;margin-top:5px;font-size:11px;font-family:'JetBrains Mono',monospace}
.em-iss{display:flex;flex-direction:column;gap:1px}
.em-iss-row{display:flex;align-items:stretch;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}
.em-iss-row:last-child{border-bottom:0}
.em-iss-bar{width:3px;border-radius:3px;flex:none}
.em-iss-body{flex:1;min-width:0}
.em-iss-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:4px}
.em-iss-t{font-weight:600;font-size:13.5px}
.em-iss-d{font-size:12px;color:var(--muted);line-height:1.45}
.em-iss-act{flex:none;align-self:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 10px;background:#201811;white-space:nowrap}
@media(max-width:900px){.em-iss-act{display:none}.em-warm-cap{font-size:8px}}

/* ── analytics ── */
.em-heat-wrap{ margin-top:14px; overflow-x:auto; }
.em-heat-hours{ display:grid; grid-template-columns:38px repeat(24,1fr); gap:3px; margin-bottom:5px; min-width:560px; }
.em-heat-hl{ font-family:'JetBrains Mono',monospace; font-size:9px; color:#7a6e60; text-align:center; line-height:1; }
.em-heat-row{ display:grid; grid-template-columns:38px repeat(24,1fr); gap:3px; margin-bottom:3px; align-items:center; min-width:560px; }
.em-heat-day{ font-family:'JetBrains Mono',monospace; font-size:10px; color:#7a6e60; text-align:right; padding-right:6px; }
.em-heat-cell{ aspect-ratio:1/1; min-height:14px; border-radius:3px; border:1px solid rgba(224,216,204,.45); transition:transform .12s ease, box-shadow .12s ease; cursor:default; }
.em-heat-cell:hover{ transform:scale(1.35); box-shadow:0 2px 8px rgba(28,21,16,.22); border-color:#c9a84c; position:relative; z-index:2; }
.em-heat-legend{ display:flex; align-items:center; gap:6px; margin-top:12px; flex-wrap:wrap; }
.em-heat-swatch{ width:18px; height:12px; border-radius:3px; border:1px solid rgba(224,216,204,.5); }
.em-heat-peak{ margin-left:auto; font-size:11px; color:#c4683a; font-weight:600; background:#201811; border:1px solid #332a20; padding:3px 9px; border-radius:20px; }
.em-coh{ margin-top:14px; display:flex; flex-direction:column; gap:9px; }
.em-coh-row{ display:grid; grid-template-columns:64px 1fr 44px; align-items:center; gap:10px; }
.em-coh-w{ font-family:'JetBrains Mono',monospace; font-size:11px; color:#7a6e60; }
.em-coh-track{ height:14px; background:#201811; border-radius:7px; overflow:hidden; }
.em-coh-fill{ display:block; height:100%; border-radius:7px; background:linear-gradient(90deg,#d9c07a,#c9a84c); transition:width .5s ease; }
.em-coh-v{ font-size:12px; color:#1c1510; font-weight:600; text-align:right; }
.em-coh-note{ margin-top:10px; color:#7a6e60; }
.em-cmap{ margin-top:14px; display:flex; flex-direction:column; gap:11px; }
.em-cmap-row{ display:grid; grid-template-columns:26px 1fr 44px; align-items:center; gap:11px; }
.em-cmap-rank{ width:24px; height:24px; line-height:24px; text-align:center; border-radius:50%; background:#201811; color:#7a6e60; font-size:11px; font-weight:600; }
.em-cmap-body{ display:flex; flex-direction:column; gap:3px; min-width:0; }
.em-cmap-t{ font-size:13px; color:#1c1510; font-weight:600; }
.em-cmap-z{ color:#7a6e60; }
.em-cmap-track{ height:8px; background:#201811; border-radius:5px; overflow:hidden; margin-top:2px; }
.em-cmap-fill{ display:block; height:100%; border-radius:5px; transition:width .5s ease; }
.em-cmap-pct{ font-size:13px; color:#1c1510; font-weight:700; text-align:right; }

/* profiles: search + nav */
.plbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.plsearch{flex:1;min-width:240px;padding:10px 14px;border:1px solid #332a20;border-radius:10px;background:#201811;font:inherit;font-size:14px;color:#1c1510}
.plsearch:focus{outline:none;border-color:#c9a84c;box-shadow:0 0 0 3px rgba(201,168,76,.18)}
.plchips{display:flex;gap:7px;flex-wrap:wrap}
.plchip{padding:6px 13px;border:1px solid #332a20;border-radius:20px;background:#201811;font-size:13px;cursor:pointer;color:#7a6e60;white-space:nowrap}
.plchip.on{background:#1c1510;color:#201811;border-color:#1c1510}
.plchip:hover{border-color:#c9a84c}
.plpager{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;font-size:13px;color:#7a6e60}
.plpager .pg{display:flex;gap:6px;align-items:center}
.plpager button{padding:6px 12px;border:1px solid #332a20;border-radius:8px;background:#201811;cursor:pointer;font:inherit;font-size:13px;color:#1c1510}
.plpager button:disabled{opacity:.4;cursor:default}

/* ===== DARK PASS — console re-theme to deck aesthetic (colours only) ===== */
:root{--panel:#1d160e;--line:rgba(239,231,214,.13);--ink:#efe7d6;--muted:#9b8e79}
body{background:radial-gradient(1100px 620px at 84% -10%,rgba(201,168,76,.08),transparent 60%),linear-gradient(180deg,#1d160e 0%,#15100b 46%,#120d08 100%) !important}
.side{border-right:1px solid rgba(239,231,214,.08)}
h1,h2,h3,h4{color:#fbf7ee}
.label,.sec,.cap{color:#9b8e79}
th{color:#9b8e79 !important}
th,td{border-color:rgba(239,231,214,.1) !important}
tr:hover td{background:rgba(239,231,214,.03) !important}
input,select,textarea{background:#241b12;color:#efe7d6;border:1px solid rgba(239,231,214,.16)}
::placeholder{color:#8a7c66}
</style></head><body>
<aside class="side">
  <div class="brand"><b class="serif">Axiom</b><span class="bd">US · CCPA</span></div>
  <nav class="nav" id="nav"></nav>
  <div class="ft" id="sub"></div>
</aside>
<div class="backdrop" id="bd"></div>
<main class="content">
  <header class="mtop"><span class="mbrand">Axiom</span><button class="burger" id="burger" aria-label="Menu">☰</button></header>
  <div class="top"><h1 class="serif" id="title">Overview</h1><div class="sp"></div><select id="tenant"></select></div>
  <div id="err"></div>
  <div id="view"></div>
</main>
<script>
const TONE={gold:'#c9a84c',sage:'#d9c07a',rust:'#c4683a',ink:'#efe7d6',muted:'#9b8e79',line:'#3a2f25'};
const $=s=>document.querySelector(s);
const nf=n=>(n||0).toLocaleString('en-US');
const rub=n=>'$'+nf(Math.round(n||0));
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDt=t=>t?new Date(t).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit'}):'—';
const SECTIONS=[
  ['overview','Overview','▦'],['today','Today','◆'],['profiles','Profiles','◉'],['segments','Segments & flows','◑'],
  ['sources','Sources','⇲'],['email','Email','✉'],['consent','Consent · CCPA/CPRA','⚖'],['services','Services','◰']
];
let TENANT=null, OV=null, cur='overview';

function tile(l,v,h,t){return '<div class="card tile"><p class="label">'+esc(l)+'</p><div class="v" style="color:'+(TONE[t]||TONE.ink)+'">'+esc(v)+'</div>'+(h?'<div class="h">'+esc(h)+'</div>':'')+'</div>';}
function hbars(bars){if(!bars.length)return '<div class="muted">—</div>';const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));
  return '<div class="bars">'+bars.map(b=>'<div class="bar"><div class="tp"><span style="font-weight:600">'+esc(b.label)+'</span><span class="cap">'+esc(b.caption||nf(b.value))+'</span></div><div class="track"><div class="fill" style="width:'+Math.min(100,b.value/max*100)+'%;background:'+(TONE[b.tone]||TONE.sage)+'"></div></div></div>').join('')+'</div>';}
function donut(sl){const size=180,stroke=28,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r,total=sl.reduce((s,x)=>s+x.value,0)||1;let off=0;
  const arcs=sl.filter(s=>s.value>0).map(s=>{const dash=s.value/total*circ;const el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';off+=dash;return el;}).join('');
  const leg='<ul class="legend">'+sl.map(s=>'<li><span class="sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="nm">'+esc(s.label)+'</span> <span class="cap" style="color:'+TONE.muted+'">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%</span></li>').join('')+'</ul>';
  return '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+'<text x="'+c+'" y="'+(c-1)+'" text-anchor="middle" font-family="Lora,serif" font-size="28" font-weight="700" fill="'+TONE.ink+'">'+nf(total)+'</text><text x="'+c+'" y="'+(c+17)+'" text-anchor="middle" font-size="10" letter-spacing="1" fill="'+TONE.muted+'">PROFILES</text></svg>'+leg+'</div>';}
function vbars(bars){const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));let peak=0;bars.forEach((b,i)=>{if(b.value>bars[peak].value)peak=i;});
  var step=Math.max(1,Math.ceil(bars.length/12));return '<div class="vb">'+bars.map((b,i)=>'<div class="col"><div class="rect" title="'+esc(b.label)+': '+nf(b.value)+'" style="height:'+Math.max(2,b.value/max*128)+'px;background:'+TONE.gold+';opacity:'+(i===peak?1:.5)+'"></div><div class="x">'+((i%step===0||i===bars.length-1)?esc(b.label):'')+'</div></div>').join('')+'</div>';}
function svc(s){return '<div class="card svc"><div class="hd"><span class="label"><span class="dot" style="background:'+(TONE[s.tone]||TONE.sage)+'"></span>'+esc(s.name)+'</span><span class="stat"><span class="d"></span>'+esc(s.status)+'</span></div><div class="m">'+esc(s.metric)+'</div><div class="c">'+esc(s.caption)+'</div></div>';}
function chart(title,sub,inner){return '<div class="card"><h2 class="serif">'+esc(title)+'</h2><div class="st">'+esc(sub)+'</div>'+inner+'</div>';}
function badge(t,tone){const c=TONE[tone]||TONE.muted;return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;border:1px solid '+c+'66;color:'+c+';background:'+c+'14">'+esc(t)+'</span>';}
const lc=k=>(OV.lifecycle.find(x=>x.label===k)||{value:0}).value;

// ─── sections ───
/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  EMAIL MODULE · tabbed (sub-tabs). Insert BEFORE const VIEWS.          ║
   ║  ES5, string concatenation only. No backticks, no dollar-brace         ║
   ║  interpolation. Depends on identifiers already declared in scope:      ║
   ║  $ / esc/nf/rub/tile/chart/hbars/donut/vbars/badge/lc/TONE/OV.         ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

/* sub-tab state and builder model.
   EMAIL_TABS/EMAIL_SUBTABS are declared as const (referenceable by name in the
   front-end scope); the builder model lives on window.* so it survives
   re-renders and stays reachable from inline onclick handlers. */
const EMAIL_TABS = {};
var emailTab = 'campaigns';
window.emailTab = emailTab;
if (typeof window.builderBlocks === 'undefined') window.builderBlocks = null;
if (typeof window.builderSubject === 'undefined') window.builderSubject = '';
if (typeof window.builderPreset === 'undefined') window.builderPreset = 'welcome';

/* ────────────────────────────────────────────────────────────────────────
   campaigns PANEL ("Campaigns", ✉)
   ──────────────────────────────────────────────────────────────────────── */
function em_campaigns_pct(n){
  var s = (Math.round(n*10)/10).toString();
  return s + '%';
}
function em_campaigns_bar(pct, toneKey){
  var w = pct; if(w<0) w=0; if(w>100) w=100;
  var col = (TONE && TONE[toneKey]) ? TONE[toneKey] : (TONE? TONE.gold : '#c9a84c');
  return '<span class="em-mini"><span class="em-mini-fill" style="width:'+w+'%;background:'+col+'"></span></span>';
}
function em_campaigns_statusBadge(st){
  if(st==='sent')      return badge('Sent','sage');
  if(st==='sending')   return badge('Sending','gold');
  if(st==='scheduled') return badge('Scheduled','ink');
  if(st==='draft')     return badge('Draft','rust');
  if(st==='paused')    return badge('Paused','rust');
  if(st==='ab')        return badge('A/B test','gold');
  return badge(st,'ink');
}
function em_campaigns_typeBadge(tp){
  if(tp==='flow') return '<span class="em-typ em-typ-flow">⤵ Flow</span>';
  return '<span class="em-typ em-typ-bc">⇶ Broadcast</span>';
}
function em_campaigns_model(){
  var active   = (typeof lc==='function') ? lc('Active') : 0;
  var sleepers = (typeof lc==='function') ? lc('Dormant')   : 0;
  var fresh    = (typeof lc==='function') ? lc('New')    : 0;
  var lost     = (typeof lc==='function') ? lc('Lost') : 0;
  var rev = (OV && OV.orders && OV.orders.revenue) ? OV.orders.revenue : 0;
  function part(base, k){ return Math.max(0, Math.round(base*k)); }
  var rows = [];
  (function(){
    var sent = part(active, 0.92);
    rows.push({
      name:'June eco edit: reusables for summer',
      tmpl:'summer-eco-picks.liquid',
      type:'broadcast', status:'sent',
      when:'Jun 14 · 10 AM', whenHint:'sent',
      recipients:sent,
      openRate:42.7, clickRate:9.8, unsubRate:0.21,
      revenue: Math.round(rev*0.18),
      tone:'sage', ab:null
    });
  })();
  (function(){
    var sent = part(fresh, 1.0) + part(active, 0.12);
    rows.push({
      name:'Meet ecoma.com: why we left the marketplaces',
      tmpl:'welcome-brand-story.liquid',
      type:'broadcast', status:'ab',
      when:'Jun 21 · 12:30 PM', whenHint:'A/B complete',
      recipients:sent,
      openRate:51.4, clickRate:13.1, unsubRate:0.14,
      revenue: Math.round(rev*0.11),
      tone:'gold',
      ab:{
        a:{subj:'Why we left Amazon and Walmart — and what it means for you', open:47.9},
        b:{subj:'ecoma.com now sells direct: −20% off the marketplace markup', open:54.8},
        winner:'B', uplift:14.4
      }
    });
  })();
  (function(){
    var sent = part(active, 0.34);
    rows.push({
      name:'Abandoned cart · reminder +3 h',
      tmpl:'abandoned-cart-3h.liquid',
      type:'flow', status:'sending',
      when:'continuous', whenHint:'trigger: cart',
      recipients:sent,
      openRate:58.2, clickRate:21.6, unsubRate:0.09,
      revenue: Math.round(rev*0.14),
      tone:'rust', ab:null
    });
  })();
  (function(){
    var sent = part(sleepers, 0.78);
    rows.push({
      name:'We missed you · −15% on an eco bundle',
      tmpl:'winback-sleepers.liquid',
      type:'flow', status:'sent',
      when:'Jun 8–28', whenHint:'3-email cascade',
      recipients:sent,
      openRate:33.5, clickRate:7.4, unsubRate:0.62,
      revenue: Math.round(rev*0.06),
      tone:'gold', ab:null
    });
  })();
  (function(){
    var sent = part(active, 0.95) + part(fresh, 0.6);
    rows.push({
      name:'July new arrivals: plastic-free home cleaning',
      tmpl:'july-plastic-free.liquid',
      type:'broadcast', status:'scheduled',
      when:'Jul 2 · 9:30 AM', whenHint:'to the "verified" segment',
      recipients:sent,
      openRate:0, clickRate:0, unsubRate:0,
      revenue:0,
      tone:'ink', ab:null, projected:true
    });
  })();
  (function(){
    rows.push({
      name:'Guide: how to read eco-cosmetics labels',
      tmpl:'guide-cosmetic-labels.liquid',
      type:'broadcast', status:'draft',
      when:'—', whenHint:'not sent',
      recipients:0,
      openRate:0, clickRate:0, unsubRate:0,
      revenue:0,
      tone:'rust', ab:null, projected:true
    });
  })();
  (function(){
    rows.push({
      name:'Post-purchase · caring for reusables (flow)',
      tmpl:'post-purchase-care.liquid',
      type:'flow', status:'draft',
      when:'—', whenHint:'trigger setup',
      recipients:0,
      openRate:0, clickRate:0, unsubRate:0,
      revenue:0,
      tone:'rust', ab:null, projected:true
    });
  })();
  return rows;
}
EMAIL_TABS.campaigns = function(){
  var rows = em_campaigns_model();
  var totalSent=0, revEmail=0, wSum=0, wOpen=0, reachable=0;
  var consentTotal = (OV && OV.consent && OV.consent.total) ? OV.consent.total : 0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(r.recipients>0 && (r.status==='sent'||r.status==='sending'||r.status==='ab')){
      totalSent += r.recipients;
      revEmail  += r.revenue;
      wSum      += r.recipients;
      wOpen     += r.recipients * r.openRate;
    }
  }
  var avgOpen = wSum>0 ? (wOpen/wSum) : 0;
  reachable = 0;
  if(OV && OV.consent && OV.consent.purposes){
    for(var p=0;p<OV.consent.purposes.length;p++){
      var pp=OV.consent.purposes[p];
      var key=(pp.purpose||'')+' '+(pp.label||'');
      if(key.toLowerCase().indexOf('email')>=0 || key.toLowerCase().indexOf('market')>=0 || key.toLowerCase().indexOf('newsletter')>=0){
        reachable = pp.count; break;
      }
    }
  }
  if(!reachable && consentTotal) reachable = Math.round(consentTotal*0.62);
  var profiles = (OV && OV.kpi && OV.kpi.profiles) ? OV.kpi.profiles : 0;
  var reachPct = profiles>0 ? Math.round(reachable/profiles*100) : 0;
  var h = '';
  h += '<div class="note">'
     + '<b class="serif">CCPA/CPRA consent gate — fail-closed.</b> '
     + 'Campaigns send only to profiles with verified <code>marketing_email</code> consent. '
     + 'Reachable for send: <b>'+nf(reachable)+'</b> of '+nf(profiles)+' profiles ('+reachPct+'%). '
     + 'Profiles without verified consent are excluded from recipients automatically; every email footer carries an unsubscribe link and sender identification (CAN-SPAM).'
     + '</div>';
  h += '<div class="grid four" style="margin-top:14px">';
  h += tile('Sent this period', nf(totalSent), rows.length+' campaigns and flows', 'ink');
  h += tile('Average opens', em_campaigns_pct(avgOpen), 'weighted by volume', 'gold');
  h += tile('Reachable with consent', nf(reachable), reachPct+'% of base · CCPA/CPRA', 'sage');
  h += tile('Email revenue', rub(revEmail), 'last-touch attribution', 'rust');
  h += '</div>';
  var inner = '';
  inner += '<div class="tw"><table>';
  inner += '<tr>'
        + '<th>Campaign</th>'
        + '<th>Template</th>'
        + '<th>Type</th>'
        + '<th>Status</th>'
        + '<th>Schedule</th>'
        + '<th style="text-align:right">Recipients</th>'
        + '<th style="text-align:right">Opens</th>'
        + '<th style="text-align:right">Clicks</th>'
        + '<th style="text-align:right">Unsubs</th>'
        + '<th style="text-align:right">Revenue</th>'
        + '</tr>';
  for(var j=0;j<rows.length;j++){
    var c = rows[j];
    var planned = !!c.projected;
    inner += '<tr'+(planned?' class="em-row-soft"':'')+'>';
    inner += '<td><span class="em-cname serif">'+esc(c.name)+'</span></td>';
    inner += '<td><code class="em-tmpl">'+esc(c.tmpl)+'</code></td>';
    inner += '<td>'+em_campaigns_typeBadge(c.type)+'</td>';
    inner += '<td>'+em_campaigns_statusBadge(c.status)+'</td>';
    inner += '<td><span class="em-when">'+esc(c.when)+'</span><span class="em-when-hint">'+esc(c.whenHint)+'</span></td>';
    if(c.recipients>0){
      inner += '<td style="text-align:right" class="em-num">'+nf(c.recipients)+'</td>';
    } else {
      inner += '<td style="text-align:right" class="muted">—</td>';
    }
    if(c.openRate>0){
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.openRate)+em_campaigns_bar(c.openRate,'gold')+'</td>';
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.clickRate)+em_campaigns_bar(c.clickRate,'sage')+'</td>';
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.unsubRate)+em_campaigns_bar(c.unsubRate,'rust')+'</td>';
    } else {
      inner += '<td style="text-align:right" class="muted">—</td>';
      inner += '<td style="text-align:right" class="muted">—</td>';
      inner += '<td style="text-align:right" class="muted">—</td>';
    }
    if(c.revenue>0){
      inner += '<td style="text-align:right" class="em-num"><b>'+rub(c.revenue)+'</b></td>';
    } else {
      inner += '<td style="text-align:right" class="muted">—</td>';
    }
    inner += '</tr>';
    if(c.ab){
      var ab=c.ab;
      inner += '<tr class="em-cab-row"><td colspan="10">';
      inner += '<div class="em-cab">';
      inner += '<span class="label">A/B on subject line</span>';
      inner += '<div class="em-cab-grid">';
      inner += '<div class="em-cab-var'+(ab.winner==='A'?' em-cab-win':'')+'">'
            + '<span class="em-cab-tag">A'+(ab.winner==='A'?' · winner':'')+'</span>'
            + '<span class="em-cab-subj">'+esc(ab.a.subj)+'</span>'
            + '<span class="em-cab-open">opens '+em_campaigns_pct(ab.a.open)+'</span>'
            + em_campaigns_bar(ab.a.open,'muted')
            + '</div>';
      inner += '<div class="em-cab-var'+(ab.winner==='B'?' em-cab-win':'')+'">'
            + '<span class="em-cab-tag">B'+(ab.winner==='B'?' · winner':'')+'</span>'
            + '<span class="em-cab-subj">'+esc(ab.b.subj)+'</span>'
            + '<span class="em-cab-open">opens '+em_campaigns_pct(ab.b.open)+'</span>'
            + em_campaigns_bar(ab.b.open,'gold')
            + '</div>';
      inner += '</div>';
      inner += '<span class="em-cab-uplift">Winner <b>'+esc(ab.winner)+'</b> · open-rate lift +'+em_campaigns_pct(ab.uplift)+' — sent to the rest of the segment automatically.</span>';
      inner += '</div>';
      inner += '</td></tr>';
    }
  }
  inner += '</table></div>';
  inner += '<div class="em-legend">'
        + '<span>'+em_campaigns_typeBadge('broadcast')+' one-time send to a segment</span>'
        + '<span>'+em_campaigns_typeBadge('flow')+' triggered automation (auto)</span>'
        + '<span class="muted">Opens/Clicks/Unsubs — % of delivered. Revenue — last-touch attribution over 14 days.</span>'
        + '</div>';
  h += chart('Campaigns and automations', 'Broadcasts and flows for tenant ecoma · verified recipients only', inner);
  return h;
};

/* ────────────────────────────────────────────────────────────────────────
   builder PANEL («Builder», ▧)
   ──────────────────────────────────────────────────────────────────────── */
var EM_BLOCK_TYPES = [
  ['header',   'Header / logo',   '◳'],
  ['hero',     'Hero banner',     '▤'],
  ['text',     'Text',            '¶'],
  ['cta',      'CTA button',      '⬛'],
  ['products', 'Product grid',    '▦'],
  ['promo',    'Promo code',      '٪'],
  ['divider',  'Divider',         '─'],
  ['social',   'Social icons',    '◎'],
  ['footer',   'Footer CAN-SPAM', '⚖']
];
var EM_TYPE_LABEL = {};
(function () { for (var i = 0; i < EM_BLOCK_TYPES.length; i++) EM_TYPE_LABEL[EM_BLOCK_TYPES[i][0]] = EM_BLOCK_TYPES[i][1]; })();
function em_builder_defaults(type) {
  if (type === 'header') return { brand: 'ecoma', tagline: 'eco-friendly home goods' };
  if (type === 'hero') return { title: 'Clean. Honest. Plastic-free.', sub: 'Home cleaning and cosmetics your family can trust', emoji: '🌿' };
  if (type === 'text') return { body: 'Hi {{first_name}}! Thanks for choosing mindful living. We have gathered the things that actually work — no harsh chemicals, no excess packaging.' };
  if (type === 'cta') return { label: 'Shop the catalog', url: '{{site_url}}/catalog' };
  if (type === 'products') return { title: 'This week\\'s picks', items: [
    { name: 'Laundry concentrate', price: 24, cap: 'lasts 60 loads' },
    { name: 'Eco cleaning kit', price: 39, cap: '5 products · 0% phosphates' },
    { name: 'Reusable sponges', price: 12, cap: 'replaces 6 paper-towel rolls' }
  ] };
  if (type === 'promo') return { code: 'ECO15', text: 'take 15% off your first order direct', expires: '7 days' };
  if (type === 'divider') return {};
  if (type === 'social') return { vk: 'instagram.com/ecoma', tg: 'tiktok.com/@ecoma' };
  if (type === 'footer') return { advertiser: 'Ecoma Inc., EIN 87-2041558', addr: '2261 Market St #4521, San Francisco, CA 94114' };
  return {};
}
var EM_PRESETS = {
  welcome:   { subject: 'Welcome to ecoma — and 15% off to start', blocks: ['header', 'hero', 'text', 'promo', 'cta', 'social', 'footer'] },
  abandoned: { subject: 'You left something in your cart, {{first_name}}', blocks: ['header', 'text', 'products', 'cta', 'footer'] },
  reengage:  { subject: 'Long time no see — come back for new eco arrivals', blocks: ['header', 'hero', 'text', 'promo', 'cta', 'social', 'footer'] },
  comeback:  { subject: 'Same product — cheaper than the marketplace', blocks: ['header', 'hero', 'text', 'products', 'cta', 'footer'] },
  arrivals:  { subject: 'This week\\'s new arrivals at ecoma: eco, no compromises', blocks: ['header', 'hero', 'products', 'cta', 'social', 'footer'] },
  receipt:   { subject: 'Thanks for your order! Receipt and delivery status', blocks: ['header', 'text', 'divider', 'cta', 'footer'] }
};
var EM_PRESET_META = [
  ['welcome',   'Welcome',                'onboard new subscribers · CAN-SPAM + promo'],
  ['abandoned', 'Abandoned cart',         'cart items · recovery'],
  ['reengage',  '60-day re-engagement',   'sleepers · wake up with a promo code'],
  ['comeback',  'Win back from marketplaces','direct price beats Amazon/Walmart'],
  ['arrivals',  'New arrivals',           'new-product showcase · social channels'],
  ['receipt',   'Receipt',                'transactional · order status']
];
var EM_VARS = ['first_name', 'product.title', 'cart.items', 'promo.code', 'unsubscribe_url'];
function em_builder_makeBlocks(presetName) {
  var pr = EM_PRESETS[presetName] || EM_PRESETS.welcome;
  var arr = [];
  for (var i = 0; i < pr.blocks.length; i++) {
    var t = pr.blocks[i];
    arr.push({ type: t, data: em_builder_defaults(t) });
  }
  return arr;
}
function em_builder_ensure() {
  if (!window.builderBlocks) {
    window.builderBlocks = em_builder_makeBlocks(window.builderPreset || 'welcome');
    window.builderSubject = (EM_PRESETS[window.builderPreset] || EM_PRESETS.welcome).subject;
  }
}
function em_builder_blockHtml(b) {
  var d = b.data || {};
  if (b.type === 'header') {
    return '<div class="em-bk em-bk-header">' +
      '<table width="100%"><tr>' +
      '<td class="em-logo"><span class="em-leaf">🌿</span><b>' + esc(d.brand) + '</b></td>' +
      '<td class="em-tag">' + esc(d.tagline) + '</td>' +
      '</tr></table></div>';
  }
  if (b.type === 'hero') {
    return '<div class="em-bk em-bk-hero">' +
      '<div class="em-hero-emoji">' + esc(d.emoji || '🌿') + '</div>' +
      '<div class="em-hero-h serif">' + esc(d.title) + '</div>' +
      '<div class="em-hero-s">' + esc(d.sub) + '</div></div>';
  }
  if (b.type === 'text') {
    return '<div class="em-bk em-bk-text"><p>' + esc(d.body) + '</p></div>';
  }
  if (b.type === 'cta') {
    return '<div class="em-bk em-bk-cta"><a class="em-btn" href="' + esc(d.url) + '">' + esc(d.label) + '</a></div>';
  }
  if (b.type === 'products') {
    var cells = '';
    for (var i = 0; i < (d.items || []).length; i++) {
      var it = d.items[i];
      cells += '<td class="em-prod">' +
        '<div class="em-prod-img">🧴</div>' +
        '<div class="em-prod-name">' + esc(it.name) + '</div>' +
        '<div class="em-prod-cap">' + esc(it.cap) + '</div>' +
        '<div class="em-prod-price">' + rub(it.price) + '</div>' +
        '<div class="em-prod-buy">Add to cart</div></td>';
    }
    return '<div class="em-bk em-bk-products">' +
      (d.title ? '<div class="em-prod-title serif">' + esc(d.title) + '</div>' : '') +
      '<table width="100%"><tr>' + cells + '</tr></table></div>';
  }
  if (b.type === 'promo') {
    return '<div class="em-bk em-bk-promo">' +
      '<div class="em-promo-txt">' + esc(d.text) + '</div>' +
      '<div class="em-promo-code">' + esc(d.code) + '</div>' +
      '<div class="em-promo-exp">with promo code · valid ' + esc(d.expires) + '</div></div>';
  }
  if (b.type === 'divider') {
    return '<div class="em-bk em-bk-divider"><span class="em-dot">∴</span></div>';
  }
  if (b.type === 'social') {
    return '<div class="em-bk em-bk-social">' +
      '<a class="em-soc em-soc-vk" href="https://' + esc(d.vk) + '">IG</a>' +
      '<a class="em-soc em-soc-tg" href="https://' + esc(d.tg) + '">TT</a>' +
      '<div class="em-soc-cap">follow us on social · direct connection, off-marketplace</div></div>';
  }
  if (b.type === 'footer') {
    return '<div class="em-bk em-bk-footer">' +
      '<div class="em-foot-adv">Sender: ' + esc(d.advertiser) + '. ' + esc(d.addr) + '.</div>' +
      '<div class="em-foot-law">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent).</div>' +
      '<div class="em-foot-unsub"><a href="{{unsubscribe_url}}">Unsubscribe</a> · one click, no confirmation needed</div></div>';
  }
  return '';
}
function em_builder_canvasHtml() {
  em_builder_ensure();
  var bks = window.builderBlocks;
  if (!bks.length) return '<div class="em-empty">Empty. Add blocks from the palette on the left →</div>';
  var html = '';
  for (var i = 0; i < bks.length; i++) html += em_builder_blockHtml(bks[i]);
  return html;
}
function em_builder_inboxHtml() {
  em_builder_ensure();
  var subj = window.builderSubject || '(no subject)';
  return '<div class="em-inbox">' +
    '<div class="em-inbox-av">🌿</div>' +
    '<div class="em-inbox-body">' +
      '<div class="em-inbox-from"><b>ecoma</b> <span class="em-inbox-mail">&lt;hello@ecoma.com&gt;</span></div>' +
      '<div class="em-inbox-subj" id="em-subj-preview">' + esc(subj) + '</div>' +
      '<div class="em-inbox-snip">' + esc((window.builderBlocks[0] && window.builderBlocks[0].type === 'hero' ? (window.builderBlocks[0].data.sub || '') : 'eco-friendly home goods direct from ecoma.com')) + '</div>' +
    '</div></div>';
}
function em_builder_stackHtml() {
  em_builder_ensure();
  var bks = window.builderBlocks;
  if (!bks.length) return '<div class="muted" style="font-size:12px">no blocks</div>';
  var out = '';
  for (var i = 0; i < bks.length; i++) {
    var ic = '◦';
    for (var k = 0; k < EM_BLOCK_TYPES.length; k++) if (EM_BLOCK_TYPES[k][0] === bks[i].type) ic = EM_BLOCK_TYPES[k][2];
    out += '<div class="em-st-row">' +
      '<span class="em-st-ic">' + ic + '</span>' +
      '<span class="em-st-nm">' + esc(EM_TYPE_LABEL[bks[i].type] || bks[i].type) + '</span>' +
      '<span class="em-st-ctl">' +
        '<button class="em-mv" title="up" onclick="moveBlock(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="em-mv" title="down" onclick="moveBlock(' + i + ',1)"' + (i === bks.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="em-mv em-del" title="delete" onclick="removeBlock(' + i + ')">✕</button>' +
      '</span></div>';
  }
  return out;
}
function em_builder_repaint() {
  var canvas = document.getElementById('em-canvas');
  if (canvas) canvas.innerHTML = em_builder_canvasHtml();
  var stack = document.getElementById('em-stack');
  if (stack) stack.innerHTML = em_builder_stackHtml();
  var inbox = document.getElementById('em-inbox-wrap');
  if (inbox) inbox.innerHTML = em_builder_inboxHtml();
  var cnt = document.getElementById('em-count');
  if (cnt) cnt.textContent = String((window.builderBlocks || []).length);
}
window.addBlock = function (type) {
  em_builder_ensure();
  window.builderBlocks.push({ type: type, data: em_builder_defaults(type) });
  em_builder_repaint();
};
window.removeBlock = function (i) {
  em_builder_ensure();
  if (i < 0 || i >= window.builderBlocks.length) return;
  window.builderBlocks.splice(i, 1);
  em_builder_repaint();
};
window.moveBlock = function (i, dir) {
  em_builder_ensure();
  var j = i + dir;
  var b = window.builderBlocks;
  if (j < 0 || j >= b.length) return;
  var tmp = b[i]; b[i] = b[j]; b[j] = tmp;
  em_builder_repaint();
};
window.loadPreset = function (name) {
  window.builderPreset = name;
  window.builderBlocks = em_builder_makeBlocks(name);
  window.builderSubject = (EM_PRESETS[name] || EM_PRESETS.welcome).subject;
  var inp = document.getElementById('em-subject-input');
  if (inp) inp.value = window.builderSubject;
  var els = document.querySelectorAll('.em-preset');
  for (var z = 0; z < els.length; z++) {
    if (els[z].getAttribute('data-preset') === name) els[z].classList.add('on'); else els[z].classList.remove('on');
  }
  em_builder_repaint();
};
window.setSubject = function (v) {
  window.builderSubject = v;
  var p = document.getElementById('em-subj-preview');
  if (p) p.textContent = v || '(no subject)';
};
window.emInsertVar = function (v) {
  var inp = document.getElementById('em-subject-input');
  if (inp) {
    inp.value = (inp.value || '') + '{{' + v + '}}';
    window.setSubject(inp.value);
    inp.focus();
  }
};
window.emFlash = function (msg) {
  var el = document.getElementById('em-flash');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(window._emFlashT);
  window._emFlashT = setTimeout(function () { el.style.opacity = '0'; }, 2200);
};
/* aliases for the consistent renderCanvas/renderStack contract */
function renderCanvas(){ return em_builder_canvasHtml(); }
function renderStack(){ return em_builder_stackHtml(); }
EMAIL_TABS.builder = function () {
  em_builder_ensure();
  var palette = '';
  for (var i = 0; i < EM_BLOCK_TYPES.length; i++) {
    var t = EM_BLOCK_TYPES[i];
    palette += '<button class="em-palbtn" onclick="addBlock(\\'' + t[0] + '\\')">' +
      '<span class="em-pal-ic">' + t[2] + '</span><span class="em-pal-nm">' + esc(t[1]) + '</span><span class="em-pal-plus">＋</span></button>';
  }
  var presets = '';
  for (var pz = 0; pz < EM_PRESET_META.length; pz++) {
    var m = EM_PRESET_META[pz];
    var on = (window.builderPreset === m[0]) ? ' on' : '';
    presets += '<button class="em-preset' + on + '" data-preset="' + m[0] + '" onclick="loadPreset(\\'' + m[0] + '\\')">' +
      '<div class="em-preset-nm">' + esc(m[1]) + '</div>' +
      '<div class="em-preset-cap">' + esc(m[2]) + '</div></button>';
  }
  var vars = '';
  for (var v = 0; v < EM_VARS.length; v++) {
    vars += '<button class="em-var" onclick="emInsertVar(\\'' + EM_VARS[v] + '\\')" title="insert into subject">{{ ' + esc(EM_VARS[v]) + ' }}</button>';
  }
  var reach = lc('Active') + lc('Dormant') + lc('New') + lc('Lost');
  var econs = 0;
  for (var q = 0; q < OV.consent.purposes.length; q++) {
    if (/Email/.test(OV.consent.purposes[q].label)) { econs = OV.consent.purposes[q].count || 0; break; }
  }
  var blkCount = window.builderBlocks.length;
  var head =
    '<div class="note">Build your email by clicking: block palette on the left, live preview on the right. ' +
    'Templates and variables below. Before sending, AXIOM checks consent (fail-closed) — we only email subscribers with a verified <b>marketing_email</b>.</div>' +
    '<div class="grid k3" style="margin-bottom:16px">' +
      tile('Email-reachable', nf(reach), nf(econs) + ' with consent (fail-closed)', 'rust') +
      tile('Blocks in email', String(blkCount), 'visual builder', 'gold') +
      tile('Template format', '.liquid', 'export to email engine', 'sage') +
    '</div>';
  var subjBar =
    '<div class="card em-subject-card">' +
      '<p class="label">Subject line</p>' +
      '<input id="em-subject-input" class="em-input" type="text" value="' + esc(window.builderSubject) + '" ' +
        'oninput="setSubject(this.value)" placeholder="What\\'s the email about?">' +
      '<p class="label" style="margin-top:14px">How the subscriber sees it</p>' +
      '<div id="em-inbox-wrap">' + em_builder_inboxHtml() + '</div>' +
    '</div>';
  var left =
    '<div class="em-col-left">' +
      '<div class="card em-pal-card"><div class="sec" style="margin:0 0 10px"><p class="label">Block palette</p></div>' +
        '<div class="em-palette">' + palette + '</div></div>' +
      '<div class="card em-stack-card" style="margin-top:16px">' +
        '<div class="sec" style="margin:0 0 10px"><p class="label">Email blocks (<span id="em-count">' + blkCount + '</span>)</p></div>' +
        '<div id="em-stack">' + em_builder_stackHtml() + '</div></div>' +
      '<div class="card em-vars-card" style="margin-top:16px">' +
        '<div class="sec" style="margin:0 0 8px"><p class="label">Liquid variables</p></div>' +
        '<div class="em-vars" id="em-vars">' + vars + '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:8px">filled in at send time from the profile and catalog</div></div>' +
    '</div>';
  var right =
    '<div class="em-col-canvas">' +
      '<div class="em-canvas-bar">' +
        '<span class="em-cb-dot"></span><span class="em-cb-dot"></span><span class="em-cb-dot"></span>' +
        '<span class="em-cb-w">600px wide · works across email clients</span>' +
      '</div>' +
      '<div class="em-letter"><div id="em-canvas">' + em_builder_canvasHtml() + '</div></div>' +
    '</div>';
  var actions =
    '<div class="em-actions">' +
      '<button class="em-act em-act-primary" onclick="emFlash(\\'Template saved to library (.liquid)\\')">Save template</button>' +
      '<button class="em-act" onclick="emFlash(\\'Test sent to hello@ecoma.com · check your inbox\\')">Send test</button>' +
      '<button class="em-act" onclick="emFlash(\\'Liquid exported: ' + blkCount + ' blocks\\')">Export liquid</button>' +
      '<span id="em-flash" class="em-flash"></span>' +
    '</div>';
  var gallery =
    '<div class="card" style="margin-top:16px"><div class="sec" style="margin:0 0 12px">' +
      '<p class="label">Ready-made templates</p>' +
      '<h2 class="serif" style="font-size:17px;margin:2px 0 0">Load a block set in one click</h2></div>' +
      '<div class="em-presets">' + presets + '</div></div>';
  return head + subjBar +
    '<div class="em-build">' + left + right + '</div>' +
    actions + gallery;
};

/* ────────────────────────────────────────────────────────────────────────
   flows PANEL ("Journeys", ⟳)
   ──────────────────────────────────────────────────────────────────────── */
function em_flows_kpi(key, fallback){
  try{ if(OV && OV.kpi && typeof OV.kpi[key] === 'number'){ return OV.kpi[key]; } }catch(e){}
  return fallback;
}
function em_flows_arrow(label){
  var s = '';
  s += '<div class="em-arrow">';
  s += '<svg width="22" height="34" viewBox="0 0 22 34" aria-hidden="true">';
  s += '<line x1="11" y1="0" x2="11" y2="26" stroke="' + TONE.line + '" stroke-width="2"/>';
  s += '<path d="M5 22 L11 32 L17 22 Z" fill="' + TONE.muted + '"/>';
  s += '</svg>';
  if(label){ s += '<span class="em-arrow-lbl">' + esc(label) + '</span>'; }
  s += '</div>';
  return s;
}
function em_flows_node(kind, title, body, toneKey){
  var ico = {trigger:'⚡', mail:'✉', wait:'⏳', cond:'◇', branch:'⤳', goal:'★'}[kind] || '•';
  var tone = TONE[toneKey] || TONE.muted;
  var s = '';
  s += '<div class="em-node em-node-' + esc(kind) + '" style="border-left-color:' + tone + '">';
  s += '<div class="em-node-h">';
  s += '<span class="em-node-ico" style="background:' + tone + '">' + ico + '</span>';
  s += '<span class="em-node-k label">' + esc({trigger:'Trigger', mail:'Email', wait:'Delay', cond:'Condition', branch:'Branch', goal:'Goal'}[kind] || 'Step') + '</span>';
  s += '</div>';
  s += '<div class="em-node-t serif">' + esc(title) + '</div>';
  if(body){ s += '<div class="em-node-b muted">' + body + '</div>'; }
  s += '</div>';
  return s;
}
function em_flows_stats(inflow, conv, revenue){
  var s = '';
  s += '<div class="em-fstats">';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + nf(inflow) + '</span><span class="em-fstat-l label">in flight</span></div>';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + conv + '%</span><span class="em-fstat-l label">conversion</span></div>';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + rub(revenue) + '</span><span class="em-fstat-l label">revenue</span></div>';
  return s + '</div>';
}
function em_flows_card(flow){
  var s = '';
  s += '<div class="card em-flow">';
  s += '<div class="em-flow-head">';
  s += '<div class="em-flow-ttl">';
  s += '<span class="em-flow-ico" style="background:' + (TONE[flow.tone] || TONE.gold) + '">' + flow.glyph + '</span>';
  s += '<div><div class="serif em-flow-name">' + esc(flow.name) + '</div>';
  s += '<div class="label em-flow-sub">' + esc(flow.sub) + '</div></div>';
  s += '</div>';
  s += badge(flow.active ? 'active' : 'paused', flow.active ? 'sage' : 'muted');
  s += '</div>';
  s += '<div class="em-canvas-flow">';
  for(var i=0;i<flow.steps.length;i++){
    var st = flow.steps[i];
    s += em_flows_node(st.kind, st.title, st.body || '', st.tone || flow.tone);
    if(i < flow.steps.length - 1){
      s += em_flows_arrow(flow.steps[i+1].edge || '');
    }
  }
  s += '</div>';
  s += em_flows_stats(flow.inflow, flow.conv, flow.revenue);
  s += '</div>';
  return s;
}
function em_flows_model(){
  var welcome = lc('New');
  var active = lc('Active');
  var sleeping = lc('Dormant');
  var lost = lc('Lost');
  var orders = (OV && OV.orders) ? OV.orders : {count:0, revenue:0};
  var avgCheck = orders.count > 0 ? Math.round(orders.revenue / orders.count) : 59;
  var fWelcome = Math.round(welcome * 0.62);
  var fAbandon = Math.round(active * 0.18);
  var fReact   = Math.round(sleeping * 0.74);
  var fReturn  = Math.round((sleeping + lost) * 0.21);
  var fPost    = Math.round(active * 0.41);
  return [
    {
      name:'Welcome series', sub:'onboarding • 3 emails / 7 days',
      glyph:'✦', tone:'gold', active:true,
      inflow:fWelcome, conv:34, revenue:Math.round(fWelcome * 0.34 * avgCheck * 0.42),
      steps:[
        {kind:'trigger', title:'Sign-up / registration', body:'<b>signup</b> event + verified <b>marketing_email</b>'},
        {kind:'mail', title:'Email 1 — "Welcome"', body:'brand story "left Amazon & Walmart" + 10% off code', edge:'immediately'},
        {kind:'wait', title:'Wait 2 days', body:'window for the first order'},
        {kind:'cond', title:'Opened email 1?', body:'branch on open event', edge:''},
        {kind:'mail', title:'Email 2 — eco-friendly home goods picks', body:'reusables + eco cosmetics, top categories', edge:'yes / no'},
        {kind:'wait', title:'Wait 3 days'},
        {kind:'goal', title:'Goal: first order', body:'exit flow on purchase', edge:''}
      ]
    },
    {
      name:'Abandoned cart', sub:'recovery • 3 touches / 48 h',
      glyph:'⛟', tone:'rust', active:true,
      inflow:fAbandon, conv:27, revenue:Math.round(fAbandon * 0.27 * avgCheck),
      steps:[
        {kind:'trigger', title:'Cart without checkout', body:'<b>cart_abandoned</b> event, > 1 h idle'},
        {kind:'wait', title:'Wait 1 hour', edge:''},
        {kind:'mail', title:'Email 1 — "You left items behind"', body:'cart contents + "Return to cart" button'},
        {kind:'cond', title:'Placed the order?', body:'check <b>order_created</b>', edge:'after 12 h'},
        {kind:'mail', title:'Email 2 — reviews + free shipping', body:'social proof', edge:'no'},
        {kind:'wait', title:'Wait 24 hours'},
        {kind:'mail', title:'Email 3 — 7% off code (24 h)', body:'final touch, deadline'},
        {kind:'goal', title:'Goal: cart checkout', edge:''}
      ]
    },
    {
      name:'Win-back dormant', sub:'win-back • 90+ days without an order',
      glyph:'☼', tone:'sage', active:true,
      inflow:fReact, conv:11, revenue:Math.round(fReact * 0.11 * avgCheck * 1.1),
      steps:[
        {kind:'trigger', title:'"Dormant" segment', body:'90 days without an <b>order</b>, consent active'},
        {kind:'mail', title:'Email 1 — "We miss you"', body:'what is new in the plastic-free home cleaning lineup'},
        {kind:'wait', title:'Wait 4 days', edge:''},
        {kind:'cond', title:'Opened / clicked?', body:'engagement scoring', edge:''},
        {kind:'branch', title:'Engaged → special offer', body:'15% off a favorite category', edge:'yes'},
        {kind:'branch', title:'Silent → final email', body:'confirm interest or reduce frequency', edge:'no'},
        {kind:'goal', title:'Goal: repeat order / re-opt-in', edge:''}
      ]
    },
    {
      name:'Off-marketplace return', sub:'migration • Amazon/Walmart → ecoma.com',
      glyph:'⇲', tone:'gold', active:true,
      inflow:fReturn, conv:19, revenue:Math.round(fReturn * 0.19 * avgCheck * 1.25),
      steps:[
        {kind:'trigger', title:'Customer from a marketplace', body:'<b>Amazon / Walmart</b> source in profile history'},
        {kind:'mail', title:'Email 1 — "Better on our site"', body:'direct price without marketplace fees + sign-up bonus'},
        {kind:'wait', title:'Wait 3 days', edge:''},
        {kind:'cond', title:'Registered on the site?', body:'<b>signup</b> event on ecoma.com', edge:''},
        {kind:'mail', title:'Email 2 — history transfer + loyalty', body:'stackable discount for direct orders', edge:'no'},
        {kind:'goal', title:'Goal: first direct order', body:'break free from the marketplace', edge:''}
      ]
    },
    {
      name:'Post-purchase / upsell', sub:'post-purchase • cross-sell + review',
      glyph:'✚', tone:'sage', active:true,
      inflow:fPost, conv:23, revenue:Math.round(fPost * 0.23 * avgCheck * 0.6),
      steps:[
        {kind:'trigger', title:'Order delivered', body:'<b>order_delivered</b> event'},
        {kind:'wait', title:'Wait 2 days', edge:''},
        {kind:'mail', title:'Email 1 — "How was your purchase?"', body:'review request + customer care'},
        {kind:'wait', title:'Wait 5 days', edge:''},
        {kind:'cond', title:'Left a review?', body:'engagement tracking', edge:''},
        {kind:'mail', title:'Email 2 — upsell', body:'related eco-friendly home goods for the order (cross-sell)', edge:''},
        {kind:'goal', title:'Goal: repeat order', edge:''}
      ]
    }
  ];
}
EMAIL_TABS.flows = function(){
  var flows = em_flows_model();
  var activeCount = 0, totalIn = 0, totalRev = 0;
  for(var i=0;i<flows.length;i++){
    if(flows[i].active){ activeCount++; }
    totalIn += flows[i].inflow;
    totalRev += flows[i].revenue;
  }
  var s = '';
  s += '<div class="grid k3 em-flows-kpi">';
  s += tile('Active flows', nf(activeCount) + ' / ' + nf(flows.length), 'trigger sequences running', 'gold');
  s += tile('Profiles in flows', nf(totalIn), 'reached by triggered email', 'sage');
  s += tile('CCPA/CPRA gate', 'ON', 'fail-closed on verified marketing_email', 'rust');
  s += '</div>';
  s += '<div class="note">';
  s += '<b>How to read the diagram.</b> Each sequence starts with a <b>trigger</b> (a profile event), ';
  s += 'then runs <b>emails</b>, <b>delays</b> ("wait N days"), <b>conditions</b> (opened / purchased) and <b>branches</b>. ';
  s += 'An email only goes out on active consent (verified <span class="idn">marketing_email</span>); ';
  s += 'without consent the profile silently drops out of the step — <b>fail-closed</b>. Every email footer carries a required unsubscribe + ';
  s += 'sender identification (CAN-SPAM).';
  s += '</div>';
  s += '<div class="sec">Trigger sequences (' + nf(flows.length) + ')</div>';
  s += '<div class="em-flows-list">';
  for(var jj=0;jj<flows.length;jj++){
    s += em_flows_card(flows[jj]);
  }
  s += '</div>';
  s += '<div class="note em-flows-foot">';
  s += '<b>Flows summary.</b> Triggered email brings in roughly <b>' + rub(totalRev) + '</b> ';
  s += 'per month across ' + nf(totalIn) + ' profiles in flow. Trigger sequences are ecoma\\'s primary channel for direct ';
  s += 'customer relationships after going off-marketplace.';
  s += '</div>';
  return s;
};

/* ────────────────────────────────────────────────────────────────────────
   audiences PANEL ("Segments", ◑)
   ──────────────────────────────────────────────────────────────────────── */
function em_audiences_emailRate(){
  var reach=lc('New')+lc('Active')+lc('Dormant')+lc('Lost');
  var em=(OV.consent.purposes.find(function(p){return /Email|marketing_email/.test(p.label)||/marketing_email/.test(p.purpose||'');})||{count:0}).count||0;
  return reach?Math.min(0.96,em/reach):0;
}
function em_audiences_segments(){
  var base=em_audiences_emailRate();
  var aov=OV.orders.count?Math.round(OV.orders.revenue/OV.orders.count):55;
  return [
    {key:'active',name:'Active buyers',tone:'sage',size:lc('Active'),rate:Math.min(0.97,base*1.18),
      hint:'Bought recently — best reach and response. Upsell, new arrivals.',
      rules:[{f:'event',op:'=',v:'order_completed'},{f:'recency',op:'<',v:'30 days'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'sleep',name:'Dormant 30–60 days',tone:'rust',size:Math.round(lc('Dormant')*0.62),rate:Math.min(0.95,base*0.92),
      hint:'Engaged once, then went quiet. Win back with a discount or a curated pick.',
      rules:[{f:'recency',op:'30–60 d',v:'no purchase'},{f:'event',op:'had',v:'add_to_cart'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'cart',name:'Abandoned carts',tone:'gold',size:Math.round(OV.orders.count*0.40),rate:Math.min(0.96,base*1.05),
      hint:'Added to cart in last 72h, never checked out. Trigger nudge.',
      rules:[{f:'event',op:'=',v:'add_to_cart'},{f:'NOT event',op:'≠',v:'order_completed'},{f:'recency',op:'<',v:'72 hours'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'vip',name:'High AOV · VIP',tone:'gold',size:Math.round(lc('Active')*0.14),rate:Math.min(0.98,base*1.22),
      hint:'Above-average order value ('+rub(aov)+'×2). Members-only offers, early access.',
      rules:[{f:'order total',op:'>',v:rub(aov*2)},{f:'orders',op:'≥',v:'3'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'noopen',name:'Subscribed, never opened',tone:'muted',size:Math.round((lc('Active')+lc('Dormant'))*0.21),rate:0.0,
      hint:'Consent on file, but 5+ emails with no open → re-permission or TikTok. We do NOT send by email.',
      rules:[{f:'marketing_email',op:'=',v:'verified'},{f:'open_rate',op:'=',v:'0 over 5 emails'},{f:'action',op:'→',v:'re-permission'}]},
    {key:'mpback',name:'Won back from Amazon/Walmart',tone:'rust',size:lc('Lost'),rate:Math.min(0.90,base*0.78),
      hint:'Purchase history on marketplaces, moved to our own site. Loyalty transfer, direct channel.',
      rules:[{f:'source',op:'∈',v:'Amazon, Walmart'},{f:'event',op:'had',v:'order_completed'},{f:'marketing_email',op:'=',v:'verified'}]}
  ];
}
function em_audiences_chip(rule){
  var verified=/marketing_email/.test(rule.f)&&/verified/.test(rule.v);
  var negate=/NOT |≠/.test(rule.f)||/≠/.test(rule.op);
  var bg=verified?TONE.sage:(negate?TONE.rust:TONE.muted);
  var ico=verified?'✓ ':(negate?'⊘ ':'');
  return '<span class="em-rule" style="border-color:'+bg+'55;background:'+bg+'12;color:'+(verified?TONE.sage:TONE.ink)+'">'+
    ico+'<b style="color:'+TONE.muted+';font-weight:600">'+esc(rule.f)+'</b> <span class="em-op">'+esc(rule.op)+'</span> <b>'+esc(rule.v)+'</b></span>';
}
function em_audiences_card(s){
  var reach=Math.round(s.size*s.rate);
  var noCons=s.size-reach;
  var pct=s.size?Math.round(s.rate*100):0;
  var dead=s.rate<=0;
  var chips=s.rules.map(em_audiences_chip).join('');
  var bar=dead?
    '<div class="em-reachbar"><div class="em-reach-fill" style="width:0%;background:'+TONE.rust+'"></div></div>':
    '<div class="em-reachbar"><div class="em-reach-fill" style="width:'+pct+'%;background:'+(TONE[s.tone]||TONE.sage)+'"></div></div>';
  var reachLine=dead?
    '<span class="em-reach-no">we do NOT send by email · fail-closed</span>':
    '<span style="color:'+TONE.sage+';font-weight:700">'+nf(reach)+'</span> <span class="muted">reachable with consent · '+pct+'%</span>';
  return '<div class="card em-seg">'+
    '<div class="em-seg-hd">'+
      '<span class="em-dot" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span>'+
      '<span class="em-seg-name serif">'+esc(s.name)+'</span>'+
      badge(nf(s.size)+' profiles',s.tone==='muted'?'muted':s.tone)+
    '</div>'+
    '<p class="em-seg-hint muted">'+esc(s.hint)+'</p>'+
    '<div class="em-rules">'+chips+'</div>'+
    bar+
    '<div class="em-reach-line">'+reachLine+(noCons>0&&!dead?' <span class="muted" style="font-size:11px">· '+nf(noCons)+' no consent (skipped)</span>':'')+'</div>'+
  '</div>';
}
function em_audiences_builder(){
  var andRules=[
    {f:'event',op:'=',v:'order_completed'},
    {f:'recency',op:'<',v:'30 days'},
    {f:'marketing_email',op:'=',v:'verified'}
  ];
  var orRules=[
    {f:'source',op:'=',v:'Instagram'},
    {f:'source',op:'=',v:'TikTok'},
    {f:'city',op:'=',v:'San Francisco'}
  ];
  var fields=[
    {n:'event',ex:'order_completed · add_to_cart · page_view'},
    {n:'frequency',ex:'orders ≥ 3 · visits ≥ 5'},
    {n:'recency',ex:'< 30d · 30–60d · > 90d'},
    {n:'source',ex:'ecoma.com · Instagram · TikTok · Amazon/Walmart'},
    {n:'city',ex:'San Francisco · NYC · other regions'},
    {n:'marketing_email',ex:'verified (required to send)'}
  ];
  var andHtml=andRules.map(em_audiences_chip).join('<span class="em-join em-and">AND</span>');
  var orHtml=orRules.map(em_audiences_chip).join('<span class="em-join em-or">OR</span>');
  var fieldHtml=fields.map(function(f){
    return '<div class="em-field"><span class="em-field-n">'+esc(f.n)+'</span><span class="em-field-ex muted">'+esc(f.ex)+'</span></div>';
  }).join('');
  return '<div class="em-builder">'+
    '<div class="em-build-row"><span class="em-build-tag" style="background:'+TONE.sage+'14;color:'+TONE.sage+';border-color:'+TONE.sage+'55">ALL conditions · AND</span>'+
      '<div class="em-build-chips">'+andHtml+'</div></div>'+
    '<div class="em-build-row"><span class="em-build-tag" style="background:'+TONE.gold+'14;color:'+TONE.gold+';border-color:'+TONE.gold+'55">ANY condition · OR</span>'+
      '<div class="em-build-chips">'+orHtml+'</div></div>'+
    '<div class="em-fields-grid">'+fieldHtml+'</div>'+
  '</div>';
}
function em_audiences_reachDonut(){
  var totalCons=(OV.consent.purposes.find(function(p){return /Email|marketing_email/.test(p.label);})||{count:0}).count||0;
  var totalReach=lc('New')+lc('Active')+lc('Dormant')+lc('Lost');
  var unsub=Math.round(totalCons*0.07);
  var withCnet=totalCons-unsub;
  var without=Math.max(0,totalReach-totalCons);
  var slices=[
    {label:'With consent (verified)',value:withCnet,tone:'sage'},
    {label:'Unsubscribed',value:unsub,tone:'rust'},
    {label:'No consent — not sending',value:without,tone:'muted'}
  ];
  var total=withCnet+unsub+without||1;
  var leg='<ul class="em-reach-legend">'+slices.map(function(s){
    return '<li><span class="em-sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="em-lg-nm">'+esc(s.label)+'</span><span class="em-lg-v">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%</span></li>';
  }).join('')+'</ul>';
  var size=170,stroke=26,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r,off=0;
  var arcs=slices.filter(function(s){return s.value>0;}).map(function(s){
    var dash=s.value/total*circ;
    var el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';
    off+=dash;return el;
  }).join('');
  var svg='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+
    '<text x="'+c+'" y="'+(c-2)+'" text-anchor="middle" font-family="Lora,serif" font-size="24" font-weight="700" fill="'+TONE.sage+'">'+nf(withCnet)+'</text>'+
    '<text x="'+c+'" y="'+(c+15)+'" text-anchor="middle" font-size="9" letter-spacing="1" fill="'+TONE.muted+'">REACHABLE</text></svg>';
  return '<div class="em-reach-wrap">'+svg+leg+'</div>';
}
EMAIL_TABS.audiences=function(){
  var segs=em_audiences_segments();
  var totalSize=segs.reduce(function(s,x){return s+x.size;},0);
  var totalReach=segs.reduce(function(s,x){return s+Math.round(x.size*x.rate);},0);
  var sendable=segs.filter(function(x){return x.rate>0;}).length;
  var cards=segs.map(em_audiences_card).join('');
  return ''+
    '<div class="note">Dynamic recipient segments: conditions are applied to live profiles, and size and reach are computed on the fly. '+
      '<b>Fail-closed CCPA/CPRA</b> — without <b>marketing_email = verified</b>, a profile never enters an email send, even if it matches the segment.</div>'+
    '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Segments',String(segs.length),sendable+' email-sendable','ink')+
      tile('In segments',nf(totalSize),'profiles covered by rules','gold')+
      tile('Reachable · email',nf(totalReach),'with verified consent','sage')+
      tile('Consent gate','fail-closed','no verified → skipped','rust')+
    '</div>'+
    chart('Reach by consent','Of total audience: who can actually be emailed (CCPA/CPRA)',em_audiences_reachDonut())+
    '<div class="sec" style="margin-top:18px"><p class="label">Builder</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Dynamic segments</h2></div>'+
    '<div class="em-seg-grid">'+cards+'</div>'+
    '<div class="sec" style="margin-top:18px"><p class="label">Visual rule builder</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">AND / OR · conditions</h2></div>'+
    '<div class="card">'+em_audiences_builder()+'</div>';
};

/* ────────────────────────────────────────────────────────────────────────
   abtest panel («A/B tests», ⚗)
   ──────────────────────────────────────────────────────────────────────── */
function em_abtest_pct(n){
  var s = (Math.round(n*10)/10).toFixed(1);
  return s + '%';
}
function em_abtest_lift(n){
  var v = Math.round(n*10)/10;
  var s = (v>0?'+':'') + (v.toFixed(1));
  return s + '%';
}
function em_abtest_sig(conf, winner){
  if (winner === '—') return badge('collecting', 'ink');
  if (conf >= 95) return badge('p<0.05 · 95%+', 'sage');
  if (conf >= 90) return badge('borderline · 90%', 'gold');
  return badge('low data', 'rust');
}
function em_abtest_varcell(o, c, cv, win){
  var cls = win ? ' em-ab-win' : '';
  return '<div class="em-ab-var'+cls+'">'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(o)+'</b><i>open</i></span>'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(c)+'</b><i>click</i></span>'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(cv)+'</b><i>conv.</i></span>'+
  '</div>';
}
function em_abtest_model(){
  var baseSend = (typeof lc === 'function') ? lc('Active') + lc('New') : 4200;
  if (!baseSend || baseSend < 1) baseSend = 4200;
  var T = [];
  T.push({
    name:'Subject: "Plastic-free" vs "−30% on eco bundle"',
    dim:'Subject line',
    status:'running',
    sample: Math.round(baseSend*0.46),
    progress: 62,
    a:{label:'A · "Plastic-free"', o:31.4, c:5.1, cv:1.2},
    b:{label:'B · "−30% eco bundle"', o:34.8, c:6.4, cv:1.6},
    metric:'open',
    lift:33.3, conf:88, winner:'—'
  });
  T.push({
    name:'Timing: 9 AM vs 7 PM (ET)',
    dim:'Send time',
    status:'running',
    sample: Math.round(baseSend*0.51),
    progress: 78,
    a:{label:'A · morning 9 AM', o:33.0, c:5.8, cv:1.4},
    b:{label:'B · evening 7 PM', o:35.9, c:6.9, cv:1.7},
    metric:'click',
    lift:19.0, conf:93, winner:'—'
  });
  T.push({
    name:'CTA: "Buy now" vs "Pick your eco bundle"',
    dim:'CTA button',
    status:'complete',
    sample: Math.round(baseSend*0.88),
    progress: 100,
    a:{label:'A · "Buy now"', o:36.2, c:5.9, cv:1.5},
    b:{label:'B · "Pick your eco bundle"', o:36.4, c:7.6, cv:2.1},
    metric:'click',
    lift:28.8, conf:97, winner:'B'
  });
  T.push({
    name:'Content: customer review vs ingredients/certifications',
    dim:'Content block',
    status:'complete',
    sample: Math.round(baseSend*0.92),
    progress: 100,
    a:{label:'A · customer review', o:35.1, c:6.7, cv:1.8},
    b:{label:'B · ingredients + eco certification', o:35.6, c:7.1, cv:2.4},
    metric:'conv',
    lift:33.3, conf:96, winner:'B'
  });
  T.push({
    name:'Subject: emoji 🌿 vs no emoji',
    dim:'Subject line',
    status:'complete',
    sample: Math.round(baseSend*0.84),
    progress: 100,
    a:{label:'A · "🌿 Eco home care"', o:33.8, c:6.2, cv:1.6},
    b:{label:'B · "Eco home care"', o:37.0, c:6.6, cv:1.7},
    metric:'open',
    lift:9.5, conf:95, winner:'B'
  });
  return T;
}
EMAIL_TABS.abtest = function(){
  var T = em_abtest_model();
  var i, t;
  var running = 0, done = 0, liftSum = 0, liftCnt = 0;
  for (i=0;i<T.length;i++){
    t = T[i];
    if (t.status === 'running') running++; else done++;
    if (t.winner !== '—'){ liftSum += t.lift; liftCnt++; }
  }
  var avgLift = liftCnt ? (liftSum/liftCnt) : 0;
  var rev = (typeof OV!=='undefined' && OV.orders && OV.orders.revenue) ? OV.orders.revenue : 1200000;
  var emailShare = Math.round(rev * 0.18);
  var uplift = Math.round(emailShare * (avgLift/100) * 0.45);
  var out = '';
  out += '<div class="grid k3" style="margin-bottom:14px">';
  out += tile('Active tests', nf(running), done + ' completed this period', 'ink');
  out += tile('Avg winner lift', em_abtest_lift(avgLift), 'on the target metric', 'sage');
  out += tile('A/B revenue uplift', rub(uplift), 'attributed to email channel', 'gold');
  out += '</div>';
  var show = T[3];
  var showInner = hbars([
    {label:'A · '+show.a.label.replace('A · ',''), value:show.a.cv, tone:TONE.muted, caption:'conv. '+em_abtest_pct(show.a.cv)},
    {label:'B · '+show.b.label.replace('B · ',''), value:show.b.cv, tone:TONE.sage, caption:'conv. '+em_abtest_pct(show.b.cv)+'  ·  '+em_abtest_lift(show.lift)}
  ]);
  out += chart(
    'Showcase: ' + esc(show.name),
    'Target metric — conversion to order · sample ' + nf(show.sample) + ' · confidence 96%',
    '<div class="em-ab-show">'+ showInner +
      '<div class="em-ab-verdict">'+
        badge('Winner B', 'sage') + ' ' +
        '<span class="muted">lineup + ECO-certified badge lifted conversion by </span>' +
        '<b class="em-ab-up">'+ em_abtest_lift(show.lift) +'</b>' +
      '</div>'+
    '</div>'
  );
  var rows = '';
  for (i=0;i<T.length;i++){
    t = T[i];
    var st = (t.status === 'running')
      ? badge('running · '+t.progress+'%', 'gold')
      : badge('completed', 'sage');
    var winB = (t.winner === 'B');
    var winA = (t.winner === 'A');
    var aCell = em_abtest_varcell(t.a.o, t.a.c, t.a.cv, winA);
    var bCell = em_abtest_varcell(t.b.o, t.b.c, t.b.cv, winB);
    var liftCls = (t.lift>0?'em-ab-pos':'em-ab-neg');
    var metricRu = (t.metric==='open'?'opens':(t.metric==='click'?'clicks':'conversion'));
    rows += '<tr>'+
      '<td><div class="em-ab-name">'+esc(t.name)+'</div>'+
          '<div class="label">'+esc(t.dim)+' · goal: '+metricRu+'</div></td>'+
      '<td>'+st+'</td>'+
      '<td>'+aCell+'</td>'+
      '<td>'+bCell+'</td>'+
      '<td class="em-ab-c"><span class="mono">'+nf(t.sample)+'</span></td>'+
      '<td class="em-ab-c"><span class="'+liftCls+'">'+em_abtest_lift(t.lift)+'</span></td>'+
      '<td class="em-ab-c">'+(t.winner==='—'?'<span class="muted">—</span>':'<b>'+esc(t.winner)+'</b>')+'</td>'+
      '<td>'+em_abtest_sig(t.conf, t.winner)+'</td>'+
    '</tr>';
  }
  var table =
    '<div class="tw"><table class="em-ab-table">'+
      '<thead><tr>'+
        '<th>Test</th>'+
        '<th>Status</th>'+
        '<th>Variant A</th>'+
        '<th>Variant B</th>'+
        '<th class="em-ab-c">Sample</th>'+
        '<th class="em-ab-c">Lift</th>'+
        '<th class="em-ab-c">Winner</th>'+
        '<th>Significance</th>'+
      '</tr></thead>'+
      '<tbody>'+ rows +'</tbody>'+
    '</table></div>';
  out += chart('A/B test registry', running+' running · '+done+' completed · confidence threshold 95%', table);
  out += '<div class="note em-ab-note">'+
    '<b>How we read the result.</b> A winner is locked in only once it reaches statistical significance of '+
    '<b>95%</b> (p&lt;0.05) and the minimum sample. Tests flagged "insufficient data" are not rolled to prod — '+
    'we keep collecting. The campaign on the winning variant ships only to verified '+
    '<span class="mono">marketing_email</span> (fail-closed, CCPA/CPRA), and the footer with the unsubscribe link and sender '+
    'identification (CAN-SPAM) is kept in both variants.'+
  '</div>';
  return out;
};

/* ────────────────────────────────────────────────────────────────────────
   deliverability panel ("Deliverability", ◆)
   ──────────────────────────────────────────────────────────────────────── */

EMAIL_TABS.deliverability = function(){
  var reach=lc('Active')+lc('Dormant')+lc('New')+lc('Lost');
  var econs=(OV.consent.purposes.find(function(p){return /Email/.test(p.label);})||{}).count||0;
  var sent30=Math.round((econs||lc('Active'))*1.35);
  var deliveredPct=98.6, bouncePct=1.4, complaintPct=0.04, unsubPct=0.21;
  var delivered=Math.round(sent30*deliveredPct/100);
  var bounced=sent30-delivered;
  var complaints=Math.round(sent30*complaintPct/100);
  var unsubs=Math.round(sent30*unsubPct/100);
  var auth=[
    {k:'SPF',rec:'v=spf1 include:_spf.ecoma.com ~all',st:'configured',tone:'sage',note:'softfail ~all · all senders accounted for'},
    {k:'DKIM',rec:'selector axm._domainkey · 2048-bit',st:'signed',tone:'sage',note:'key rotation every 90 days'},
    {k:'DMARC',rec:'p=none · rua=mailto:dmarc@ecoma.com',st:'monitoring',tone:'rust',note:'reports collected · policy not yet tightened'},
    {k:'BIMI',rec:'logo in inbox (Gmail/Outlook)',st:'not configured',tone:'muted',note:'VMC certificate required'}
  ];
  var authCards='<div class="grid four">'+auth.map(function(a){
    return '<div class="card em-auth"><div class="em-auth-h"><span class="em-auth-k serif">'+esc(a.k)+'</span>'+badge(a.st,a.tone)+'</div><div class="em-auth-rec">'+esc(a.rec)+'</div><div class="em-auth-note">'+esc(a.note)+'</div></div>';
  }).join('')+'</div>';
  var repDomain=92, repIp=88;
  function gauge(label,val,sub){
    var tone = val>=85?TONE.sage:(val>=65?TONE.gold:TONE.rust);
    var word = val>=85?'excellent':(val>=65?'normal':'at risk');
    return '<div class="em-gauge"><div class="em-gauge-top"><span class="label">'+esc(label)+'</span><span class="em-gauge-v" style="color:'+tone+'">'+val+'<span class="em-gauge-u">/100</span></span></div>'+
      '<div class="em-gauge-track"><div class="em-gauge-fill" style="width:'+val+'%;background:'+tone+'"></div></div>'+
      '<div class="em-gauge-sub"><span style="color:'+tone+';font-weight:600">'+word+'</span> · '+esc(sub)+'</div></div>';
  }
  var repBlock=chart('Domain & IP reputation','Aggregate scoring across Gmail Postmaster / Outlook SNDS / Yahoo',
    gauge('Domain ecoma.com',repDomain,'complaints '+complaintPct.toFixed(2)+'% · on Gmail allowlist')+
    gauge('Sending IP',repIp,'dedicated · SpamHaus / UCEPROTECT clean'));
  var warm=[
    {d:'Wk 1',cap:'2,000/day',pct:14},{d:'Wk 2',cap:'6,000/day',pct:33},
    {d:'Wk 3',cap:'14,000/day',pct:62},{d:'Wk 4',cap:'24,000/day',pct:88},
    {d:'Now',cap:'at target volume',pct:100}
  ];
  var warmBars='<div class="em-warm">'+warm.map(function(w,i){
    var done=w.pct>=100;
    var tone=done?TONE.sage:(i===warm.length-2?TONE.gold:TONE.muted);
    return '<div class="em-warm-step"><div class="em-warm-bar"><div class="em-warm-fill" style="height:'+w.pct+'%;background:'+tone+'"></div></div><div class="em-warm-d">'+esc(w.d)+'</div><div class="em-warm-cap">'+esc(w.cap)+'</div></div>';
  }).join('')+'</div>';
  var warmBlock=chart('Domain warm-up','Gradual volume ramp — reputation built over 4 weeks','<div class="note">Warm-up complete: reached the target of '+nf(24000)+' emails/day with no inbox-rate drop. Further growth in steps of ≤30%/week.</div>'+warmBars);
  var prov=[
    {p:'Gmail',share:38,inbox:95,promo:4,spam:1},
    {p:'Outlook',share:34,inbox:93,promo:6,spam:1},
    {p:'Apple Mail',share:21,inbox:88,promo:11,spam:1},
    {p:'Yahoo',share:7,inbox:90,promo:7,spam:3}
  ];
  function placementRow(x){
    return '<div class="em-pl"><div class="em-pl-h"><span class="em-pl-name serif">'+esc(x.p)+'</span><span class="cap em-pl-share">'+x.share+'% of list</span></div>'+
      '<div class="em-pl-track">'+
        '<div class="em-pl-seg" style="width:'+x.inbox+'%;background:'+TONE.sage+'" title="Inbox '+x.inbox+'%"></div>'+
        '<div class="em-pl-seg" style="width:'+x.promo+'%;background:'+TONE.gold+'" title="Promotions '+x.promo+'%"></div>'+
        '<div class="em-pl-seg" style="width:'+x.spam+'%;background:'+TONE.rust+'" title="Spam '+x.spam+'%"></div>'+
      '</div>'+
      '<div class="em-pl-num"><span style="color:'+TONE.sage+'">Inbox '+x.inbox+'%</span><span style="color:'+TONE.gold+'">Promotions '+x.promo+'%</span><span style="color:'+TONE.rust+'">Spam '+x.spam+'%</span></div></div>';
  }
  var placementBlock=chart('Inbox placement by US provider','Where the email lands: Inbox / Promotions / Spam',
    '<div class="em-pl-legend"><span><i style="background:'+TONE.sage+'"></i>Inbox</span><span><i style="background:'+TONE.gold+'"></i>Promotions</span><span><i style="background:'+TONE.rust+'"></i>Spam</span></div>'+
    prov.map(placementRow).join(''));
  var healthTiles='<div class="grid k4" style="margin-bottom:16px">'+
    tile('Delivered',deliveredPct.toFixed(1)+'%',nf(delivered)+' of '+nf(sent30),'sage')+
    tile('Bounces',bouncePct.toFixed(1)+'%',nf(bounced)+' bounce · benchmark <2%','gold')+
    tile('Complaints',complaintPct.toFixed(2)+'%',nf(complaints)+' spam · benchmark <0.1%','sage')+
    tile('Unsubscribes',unsubPct.toFixed(2)+'%',nf(unsubs)+' unsub · CAN-SPAM in every email','rust')+'</div>';
  var issues=[
    {sev:'warning',tone:'rust',t:'Soft-bounce spike on Gmail',d:'+1.9 pts in 48h (mailbox full / temporary deferral). We recommend throttling Gmail volume and enabling a 6h retry.',act:'throttle volume'},
    {sev:'recommendation',tone:'gold',t:'DMARC p=none — tighten to quarantine',d:'Reports clean for 14 days, no spoofing. Moving to p=quarantine will block domain spoofing and raise postmaster trust.',act:'p=quarantine'},
    {sev:'recommendation',tone:'gold',t:'Enable BIMI + VMC',d:'Gmail and Outlook will show the ecoma.com logo in the email list → higher open-rate and stronger brand recognition.',act:'set up BIMI'},
    {sev:'ok',tone:'sage',t:'List-Unsubscribe one-click active',d:'List-Unsubscribe and List-Unsubscribe-Post headers are set — one-click unsubscribe, meeting the Gmail/Yahoo requirement (CCPA/CPRA · CAN-SPAM).',act:'compliant'},
    {sev:'ok',tone:'sage',t:'Fail-closed consent gate',d:'We send only to verified marketing_email. '+nf(econs)+' addresses with confirmed consent out of '+nf(reach)+' reachable.',act:'compliant'}
  ];
  var issuesList='<div class="em-iss">'+issues.map(function(x){
    return '<div class="em-iss-row"><div class="em-iss-bar" style="background:'+(TONE[x.tone]||TONE.muted)+'"></div>'+
      '<div class="em-iss-body"><div class="em-iss-top">'+badge(x.sev,x.tone)+'<span class="em-iss-t">'+esc(x.t)+'</span></div>'+
      '<div class="em-iss-d">'+esc(x.d)+'</div></div>'+
      '<div class="em-iss-act">'+esc(x.act)+' →</div></div>';
  }).join('')+'</div>';
  var issuesBlock=chart('Issues & recommendations','Postmaster signals and priority reputation actions',issuesList);
  return healthTiles+
    chart('Sender authentication · ecoma.com','SPF / DKIM / DMARC / BIMI — protecting the domain from spoofing',authCards)+
    '<div class="grid two" style="margin-top:16px">'+repBlock+warmBlock+'</div>'+
    '<div style="margin-top:16px">'+placementBlock+'</div>'+
    '<div style="margin-top:16px">'+issuesBlock+'</div>'+
    '<div class="note" style="margin-top:16px">CCPA/CPRA · CAN-SPAM: every email carries a mandatory unsubscribe link (one-click List-Unsubscribe) and sender identification (CAN-SPAM) for Ecoma Inc. We send only to verified marketing_email (fail-closed).</div>';
};

/* ────────────────────────────────────────────────────────────────────────
   analytics panel ("Analytics", ▦)
   ──────────────────────────────────────────────────────────────────────── */
var EM_AN_SHARE = 0.26;
function em_analytics_dailyRev(){
  var d = (OV && OV.daily) ? OV.daily : [];
  var total = (OV && OV.orders && OV.orders.revenue) ? OV.orders.revenue : 1200000;
  var emailTotal = Math.round(total * EM_AN_SHARE);
  var i, w, sumW = 0, weights = [];
  for(i=0;i<d.length;i++){
    var base = (d[i] && typeof d[i].value==='number') ? d[i].value : 1;
    w = base * (0.82 + 0.36*Math.abs(Math.sin(i*0.7)));
    weights.push(w); sumW += w;
  }
  if(sumW<=0) sumW = 1;
  var arr = [];
  for(i=0;i<d.length;i++){
    var rev = Math.round(emailTotal * (weights[i]/sumW));
    arr.push({ label:(d[i] && d[i].label)? d[i].label : ('d'+(i+1)), value: rev });
  }
  return arr;
}
function em_analytics_sum(arr, key){
  var s=0,i; for(i=0;i<arr.length;i++){ s += (arr[i] && arr[i][key]) ? arr[i][key] : 0; } return s;
}
function em_analytics_heatCell(day, hour){
  var morning = Math.exp(-Math.pow(hour-10,2)/14);
  var evening = Math.exp(-Math.pow(hour-20,2)/10);
  var night   = (hour>=0 && hour<=6) ? 0.05 : 0;
  var hourW = morning*0.85 + evening*1.0 + night;
  var dayW = [1.0,0.97,0.95,0.93,0.88,0.62,0.55][day];
  var v = hourW * dayW;
  if(v>1) v=1;
  return v;
}
function em_analytics_heatColor(v){
  if(v < 0.04) return '#201811';
  var a = 0.12 + v*0.88;
  var r = Math.round(201 + (196-201)*v);
  var g = Math.round(168 + (104-168)*v*0.8);
  var b = Math.round(76  + (58-76)*v*0.6);
  return 'rgba('+r+','+g+','+b+','+a.toFixed(3)+')';
}
function em_analytics_heatmap(){
  var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var h, d;
  var html = '<div class="em-heat-wrap">';
  html += '<div class="em-heat-hours"><span class="em-heat-corner"></span>';
  for(h=0;h<24;h++){
    var hl = (h%3===0) ? (h<10?('0'+h):(''+h)) : '';
    html += '<span class="em-heat-hl">'+hl+'</span>';
  }
  html += '</div>';
  var peakDay=0, peakHour=0, peakV=0;
  for(d=0;d<7;d++){
    html += '<div class="em-heat-row"><span class="em-heat-day">'+days[d]+'</span>';
    for(h=0;h<24;h++){
      var v = em_analytics_heatCell(d,h);
      if(v>peakV){ peakV=v; peakDay=d; peakHour=h; }
      var pct = Math.round(v*100);
      var col = em_analytics_heatColor(v);
      html += '<span class="em-heat-cell" style="background:'+col+'" title="'+days[d]+' '+(h<10?('0'+h):(''+h))+':00 — '+pct+'% opens"></span>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="em-heat-legend"><span class="label">less</span>';
  var steps=[0.05,0.25,0.45,0.65,0.85,1.0], s;
  for(s=0;s<steps.length;s++){
    html += '<span class="em-heat-swatch" style="background:'+em_analytics_heatColor(steps[s])+'"></span>';
  }
  html += '<span class="label">more</span>';
  html += '<span class="em-heat-peak mono">Peak: '+days[peakDay]+' '+(peakHour<10?('0'+peakHour):(''+peakHour))+':00</span>';
  html += '</div>';
  return html;
}
function em_analytics_cohort(){
  var weeks = [
    {w:'Wk 0', open:62},
    {w:'Wk 1', open:54},
    {w:'Wk 2', open:47},
    {w:'Wk 3', open:41},
    {w:'Wk 4', open:36},
    {w:'Wk 6', open:29},
    {w:'Wk 8', open:24},
    {w:'Wk 12', open:19}
  ];
  var i, html = '<div class="em-coh">';
  for(i=0;i<weeks.length;i++){
    var o = weeks[i].open;
    html += '<div class="em-coh-row">';
    html += '<span class="em-coh-w">'+esc(weeks[i].w)+'</span>';
    html += '<span class="em-coh-track"><span class="em-coh-fill" style="width:'+o+'%"></span></span>';
    html += '<span class="em-coh-v mono">'+o+'%</span>';
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="em-coh-note label">Open rate by week since signup. Declining engagement signals the need for re-onboarding and sleeper segmentation.</div>';
  return html;
}
function em_analytics_clickmap(){
  var links = [
    {t:'"Shop now" button',          z:'hero CTA',    pct:34, tone:TONE.gold},
    {t:'Product card #1',            z:'curated set', pct:21, tone:TONE.sage},
    {t:'Promo code ECO-15',          z:'banner',      pct:16, tone:TONE.rust},
    {t:'"Reusables" section',        z:'navigation',  pct:11, tone:TONE.sage},
    {t:'Product card #2',            z:'curated set', pct:8,  tone:TONE.gold},
    {t:'Instagram / TikTok',         z:'footer',      pct:6,  tone:TONE.muted},
    {t:'Unsubscribe (CAN-SPAM)',     z:'footer',      pct:4,  tone:TONE.muted}
  ];
  var i, html = '<div class="em-cmap">';
  for(i=0;i<links.length;i++){
    var L = links[i];
    html += '<div class="em-cmap-row">';
    html += '<span class="em-cmap-rank mono">'+(i+1)+'</span>';
    html += '<span class="em-cmap-body">';
    html += '<span class="em-cmap-t">'+esc(L.t)+'</span>';
    html += '<span class="em-cmap-z label">'+esc(L.z)+'</span>';
    html += '<span class="em-cmap-track"><span class="em-cmap-fill" style="width:'+L.pct+'%;background:'+L.tone+'"></span></span>';
    html += '</span>';
    html += '<span class="em-cmap-pct mono">'+L.pct+'%</span>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}
EMAIL_TABS.analytics = function(){
  var H = '';
  var rev = em_analytics_dailyRev();
  var emailRev = em_analytics_sum(rev,'value');
  var totalRev = (OV && OV.orders && OV.orders.revenue) ? OV.orders.revenue : Math.round(emailRev/EM_AN_SHARE);
  var sharePct = totalRev>0 ? Math.round(emailRev/totalRev*100) : 0;
  if(sharePct>100) sharePct=100;
  var avgCheck = 49;
  var emailOrders = Math.max(1, Math.round(emailRev/avgCheck));
  var sent30 = Math.max(1, Math.round((lc('Active')+lc('Dormant')+lc('New'))*1.6));
  var cost = Math.max(1, Math.round(sent30*0.30));
  var roi = Math.round(emailRev/cost);
  if(roi<1) roi=1;
  H += '<div class="grid four">';
  H += tile('Email revenue · 30d', rub(emailRev), 'direct channel contribution', 'gold');
  H += tile('Share of total revenue', sharePct+'%', 'of '+rub(totalRev)+' in sales', 'sage');
  H += tile('Email AOV', rub(avgCheck), nf(emailOrders)+' orders from email', 'ink');
  H += tile('Channel ROI', '×'+roi, 'per $1 spent — $'+roi, 'rust');
  H += '</div>';
  H += chart('Open heatmap', 'When ecoma subscribers open emails — day of week × hour, in local time', em_analytics_heatmap());
  var i, vb = [];
  for(i=0;i<rev.length;i++){
    vb.push({ label: rev[i].label, value: Math.round(rev[i].value/1000) });
  }
  H += chart('Email revenue by day', 'thousands of $ per day over the last 30 days (source OV.daily)', vbars(vb));
  H += '<div class="grid two">';
  var tpl = [
    {label:'reactivation-sleeping.liquid', k:0.31, tone:'gold', caption:'reactivate dormant'},
    {label:'weekly-eco-digest.liquid',     k:0.24, tone:'sage', caption:'weekly digest'},
    {label:'abandoned-cart.liquid',        k:0.21, tone:'rust', caption:'abandoned cart'},
    {label:'welcome-series-3.liquid',      k:0.14, tone:'sage', caption:'welcome, email 3'},
    {label:'restock-favorites.liquid',     k:0.10, tone:'gold', caption:'back in stock'}
  ];
  var tb = [];
  for(i=0;i<tpl.length;i++){
    var tv = Math.round(emailRev*tpl[i].k);
    tb.push({ label: tpl[i].label, value: tv, tone: tpl[i].tone, caption: tpl[i].caption+' · '+rub(tv) });
  }
  H += chart('Top templates by revenue', 'which .liquid files drive money', hbars(tb));
  H += chart('Email click map', 'where people tap — top links, % of all clicks', em_analytics_clickmap());
  H += '</div>';
  H += chart('Engagement cohort', 'open retention by week after signup', em_analytics_cohort());
  H += '<div class="note">';
  H += '<div class="sec">What the data says</div>';
  H += 'Opens peak on <b>weekday evenings 7–9 PM</b> — the best send window. ';
  H += 'Template <b>reactivation-dormant.liquid</b> drives ' + rub(Math.round(emailRev*0.31)) + ' (31% of channel revenue) on minimal volume. ';
  H += 'Engagement drops from 62% to 19% by week 12 — dormant users deserve their own segment. ';
  H += 'All sends go only to verified <code>marketing_email</code> (fail-closed, CCPA/CPRA); promotional emails include an unsubscribe link and sender identification per CAN-SPAM.';
  H += '</div>';
  return H;
};

/* ────────────────────────────────────────────────────────────────────────
   SUB-TAB NAV + ROUTER
   ──────────────────────────────────────────────────────────────────────── */
const EMAIL_SUBTABS = [
  ['campaigns','Campaigns','✉'],
  ['builder','Builder','▧'],
  ['flows','Flows','⟳'],
  ['audiences','Audiences','◑'],
  ['abtest','A/B tests','⚗'],
  ['deliverability','Deliverability','◆'],
  ['analytics','Analytics','▦']
];
function em_validTab(id){
  for(var i=0;i<EMAIL_SUBTABS.length;i++){ if(EMAIL_SUBTABS[i][0]===id) return true; }
  return false;
}
function em_tabFromUrl(){
  try{
    var q=new URLSearchParams(location.search).get('tab');
    if(q && em_validTab(q)) return q;
  }catch(e){}
  return null;
}
/* sub-tab switching: updates emailTab, syncs ?tab into the URL (replaceState on the current
   path, keeping tenant), re-renders ONLY #view ($ = document.querySelector) */
window.emailTo = function(tab){
  if(!em_validTab(tab)) tab='campaigns';
  window.emailTab = tab; emailTab = tab;
  try{
    var sp=new URLSearchParams(location.search);
    sp.set('tab', tab);
    var qs=sp.toString();
    history.replaceState(history.state, '', location.pathname + (qs?('?'+qs):''));
  }catch(e){}
  var v=$('#view');
  if(v) v.innerHTML=emailRender();
};
function emailRender(){
  /* on entry, pick up ?tab from the URL (deep-link), then rely on window.emailTab state */
  var urlTab=em_tabFromUrl();
  if(urlTab) { window.emailTab=urlTab; emailTab=urlTab; }
  if(!em_validTab(window.emailTab)) window.emailTab='campaigns';
  emailTab=window.emailTab;
  var nav='<div class="em-tabs">';
  for(var i=0;i<EMAIL_SUBTABS.length;i++){
    var s=EMAIL_SUBTABS[i];
    var on=(s[0]===emailTab)?' on':'';
    nav+='<button class="em-tab'+on+'" onclick="emailTo(\\''+s[0]+'\\')">'+
      '<span class="em-tab-ic">'+s[2]+'</span><span class="em-tab-lb">'+esc(s[1])+'</span></button>';
  }
  nav+='</div>';
  var fn=EMAIL_TABS[emailTab]||EMAIL_TABS.campaigns;
  var body=fn();
  return '<div class="em-module">'+nav+'<div class="em-panel">'+body+'</div></div>';
}


/* ── MERGED section: Segments + Flows (em-tab sub-tabs, data-segtab) ── */
var SEG_SUBTABS=[['audience','Segments','◑'],['flows','Flows','⟳']];
function seg_validSub(id){return id==='audience'||id==='flows';}
if(typeof window.segTab==='undefined') window.segTab=null;
window.segTo=function(tab){
  if(!seg_validSub(tab)) tab='audience';
  window.segTab=tab;
  try{var path=(tab==='flows')?'/automations':'/segments';var sp=new URLSearchParams(location.search);var qs=sp.toString();
    history.replaceState(history.state,'',path+(qs?('?'+qs):''));}catch(e){}
  var v=$('#view'); if(v) v.innerHTML=segRender();
};
function SEG_AUDIENCE(){
  const total=OV.lifecycle.reduce((s,x)=>s+x.value,0)||1;
  const o=OV.orders, aov=o.count?Math.round(o.revenue/o.count):0;
  const risk=lc('Dormant')+lc('Lost');
  const ACT={'New':{act:'Onboarding: first email and a signup bonus — while interest is hot',ch:'Email · IG'},'Active':{act:'Upsell and grow basket size while the customer is warm',ch:'Email · SMS'},'Dormant':{act:'Re-engage: "we missed you" and a personal pick',ch:'Email'},'Lost':{act:'Win-back: bring marketplace leavers to your own site',ch:'Email · IG'}};
  const cards=OV.lifecycle.map(l=>{const a=ACT[l.label]||{act:'',ch:''};const pct=Math.round(l.value/total*100);
    return '<div class="card act"><div><div class="nm">'+esc(l.label)+' <span class="muted" style="font-weight:400">· '+esc(l.desc)+'</span></div><div class="big" style="color:'+TONE[l.tone]+'">'+nf(l.value)+'</div><div class="c" style="color:var(--muted)">'+pct+'% of base</div></div><div><div class="c">'+esc(a.act)+'</div><div style="margin:8px 0">'+badge(a.ch,l.tone)+'</div><span class="cta" data-segtab="flows" style="cursor:pointer">Set up a flow →</span></div></div>';}).join('');
  return '<div class="grid k4" style="margin-bottom:16px">'+
    tile('Total profiles',nf(OV.kpi.profiles),nf(OV.kpi.identified)+' identified','ink')+
    tile('Active',nf(lc('Active')),'visiting and buying','sage')+
    tile('At churn risk',nf(risk),'dormant and lost','rust')+
    tile('Avg order',rub(aov),nf(o.count)+' orders','gold')+'</div>'+
    '<div class="grid two">'+
      chart('Lifecycle','Each profile in one segment by visit recency',donut(OV.lifecycle))+
      chart('Share and priority','Segment size and where to look first',hbars(OV.lifecycle.slice().sort((a,b)=>b.value-a.value).map(l=>({label:l.label,value:l.value,tone:l.tone,caption:nf(l.value)+' · '+Math.round(l.value/total*100)+'%'}))))+
    '</div>'+
    '<div class="sec"><p class="label">Who needs what</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Segment → ready flow</h2></div>'+
    '<div class="grid two">'+cards+'</div>'+
    '<div class="note" style="margin-top:16px">Segments are live: a profile shifts recency and moves to another group. Launch an action in the Flows tab — it runs only on those who consented (CCPA/CPRA gate).</div>';
}
function SEG_FLOWS(){
  var j=[{n:'Win back lost',ch:'Email + SMS',f:lc('Lost'),conv:6.2,last:'today 08:40',seg:'Lost'},{n:'Re-engage dormant',ch:'Email',f:lc('Dormant'),conv:9.1,last:'today 09:15',seg:'Dormant'},{n:'Onboard new',ch:'Email + Instagram',f:lc('New'),conv:24,last:'2h ago',seg:'New'},{n:'Upsell active',ch:'SMS',f:lc('Active'),conv:14,last:'today 07:05',seg:'Active'},{n:'Abandoned cart',ch:'Email',f:Math.round(OV.orders.count*0.4),conv:31,last:'15m ago',seg:'Trigger: cart'}];
  var inflight=j.reduce(function(s,x){return s+x.f;},0);
  var rows=j.map(function(x){return '<tr><td style="font-weight:600">'+x.n+'</td><td class="muted">'+x.seg+'</td><td class="muted">'+x.ch+'</td><td>'+nf(x.f)+'</td><td>'+x.conv+'%</td><td>'+badge('active','sage')+'</td><td class="muted">'+x.last+'</td></tr>';}).join('');
  return '<div class="grid k3" style="margin-bottom:16px">'+tile('Flows active',String(j.length),'on schedule','sage')+tile('In flight',nf(inflight),'profiles in funnels','gold')+tile('CCPA gate','on','marketing_messaging fail-closed','rust')+'</div>'+
    '<div class="note">Flows run on segments: each takes its group and walks it step by step (trigger → wait → email → goal). Social and SMS go through the CCPA/CPRA consent gate.</div>'+
    chart('Flows on segments','Orchestrator: email · Instagram · SMS · consent gate','<div class="tw"><table><thead><tr><th>Flow</th><th>Segment</th><th>Channel</th><th>In flight</th><th>Conv.</th><th>Status</th><th>Last run</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
}
function segRender(){
  if(window.segTab==null) window.segTab=(location.pathname.indexOf('automations')>=0?'flows':'audience');
  if(!seg_validSub(window.segTab)) window.segTab='audience';
  var nav='<div class="em-tabs">';
  for(var i=0;i<SEG_SUBTABS.length;i++){var t=SEG_SUBTABS[i];var on=(t[0]===window.segTab)?' on':'';
    nav+='<button class="em-tab'+on+'" data-segtab="'+t[0]+'"><span class="em-tab-ic">'+t[2]+'</span><span class="em-tab-lb">'+esc(t[1])+'</span></button>';}
  nav+='</div>';
  var body=(window.segTab==='flows')?SEG_FLOWS():SEG_AUDIENCE();
  return '<div class="em-module">'+nav+'<div class="em-panel">'+body+'</div></div>';
}


/* ── Profiles: search + filters + pagination (client-side, over the loaded list) ── */
if(typeof window.PROFILES==='undefined'){window.PROFILES=[];window.plQuery='';window.plFilter='all';window.plPage=1;}
function plLifecycle(p){var now=new Date().getTime();var D=86400000;var af=now-(p.firstSeen?Date.parse(p.firstSeen):0);var al=now-(p.lastSeen?Date.parse(p.lastSeen):0);if(af<=7*D)return 'New';if(al<=7*D)return 'Active';if(al<=30*D)return 'Dormant';return 'Lost';}
function plTableHtml(rows){
  if(!rows.length)return '<div class="card"><div class="muted">Nothing found — change the search or filter.</div></div>';
  var ST={'New':'sage','Active':'gold','Dormant':'rust','Lost':'muted'};
  var body=rows.map(function(p){
    var who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">anonymous</span>';
    var seg=plLifecycle(p);
    var ch=(p.events||[]).slice(0,3).map(function(e){return '<span class="chip">'+esc(e.event)+'·'+e.count+'</span>';}).join('');
    var src=esc(p.origin||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td>'+badge(seg,ST[seg])+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+(p.count||0)+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  return '<div class="card" style="padding:0;overflow:hidden"><div class="tw"><table><thead><tr><th>Profile</th><th>Who</th><th>Segment</th><th>City</th><th>Events</th><th>Revenue</th><th>Activity</th><th>Source</th><th>Actions</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
function plPager(total,pages,page,start,shown){
  var info='Showing '+(total?(nf(start+1)+'–'+nf(start+shown)):'0')+' of '+nf(total)+' profiles';
  var prev='<button data-plpage="'+(page-1)+'"'+(page<=1?' disabled':'')+'>← Prev</button>';
  var next='<button data-plpage="'+(page+1)+'"'+(page>=pages?' disabled':'')+'>Next →</button>';
  return '<div class="plpager"><span>'+info+'</span><span class="pg">'+prev+'<span style="padding:0 6px">page '+page+' / '+pages+'</span>'+next+'</span></div>';
}
window.plRenderTable=function(){
  var el=$('#pltbl'); if(!el)return;
  var list=window.PROFILES||[]; var q=(window.plQuery||'').toLowerCase().trim(); var ff=window.plFilter||'all';
  var filtered=list.filter(function(p){
    if(ff==='identified'&&!p.userId)return false;
    if(ff==='anon'&&p.userId)return false;
    if(ff==='buyers'&&!(p.revenue>0))return false;
    if((ff==='New'||ff==='Active'||ff==='Dormant'||ff==='Lost')&&plLifecycle(p)!==ff)return false;
    if(q){var hay=((p.name||'')+' '+(p.userId||'')+' '+(p.id||'')+' '+(p.city||'')+' '+(p.origin||'')+' '+(p.lastEvent||'')).toLowerCase();if(hay.indexOf(q)<0)return false;}
    return true;
  });
  var total=filtered.length, size=25, pages=Math.max(1,Math.ceil(total/size));
  if(window.plPage>pages)window.plPage=pages; if(window.plPage<1)window.plPage=1;
  var start=(window.plPage-1)*size; var rows=filtered.slice(start,start+size);
  el.innerHTML=plTableHtml(rows)+plPager(total,pages,window.plPage,start,rows.length);
};
window.plSearch=function(v){window.plQuery=v;window.plPage=1;window.plRenderTable();};
window.plSetFilter=function(ff){window.plFilter=ff;window.plPage=1;var cs=document.querySelectorAll('[data-plfilter]');for(var i=0;i<cs.length;i++){cs[i].classList.toggle('on',cs[i].getAttribute('data-plfilter')===ff);}window.plRenderTable();};
window.plGo=function(pg){window.plPage=pg;window.plRenderTable();};

const VIEWS={
  today(){const o=OV.orders,aov=o.count?Math.round(o.revenue/o.count):0;
    const cards=[
      {nm:'Revenue this period',big:rub(o.revenue),c:nf(o.count)+' orders · avg '+rub(aov),tone:'gold',cta:'report'},
      {nm:'Win back the lost',big:nf(lc('Lost')),c:'left for marketplaces, long gone → win-back',tone:'rust',cta:'campaign'},
      {nm:'Wake the dormant',big:nf(lc('Dormant')),c:'visited 7–30 days ago → re-engage',tone:'gold',cta:'campaign'},
      {nm:'Convert the new',big:nf(lc('New')),c:'first visit ≤7 days → onboarding',tone:'sage',cta:'flow'},
      {nm:'Retain the active',big:nf(lc('Active')),c:'bought recently → upsell',tone:'sage',cta:'segment'},
      {nm:'Top source',big:(OV.sources[0]||{}).label||'—',c:'your own site beat the marketplaces',tone:'rust',cta:'attribution'}];
    return '<div class="note">Where the money is: rules over segments pick the action, Axiom writes the copy. Below — priority by volume × value.</div><div class="grid k3">'+
      cards.map(c=>'<div class="card act"><div><div class="nm">'+esc(c.nm)+'</div><div class="big" style="color:'+TONE[c.tone]+'">'+esc(c.big)+'</div></div><div><div class="c">'+esc(c.c)+'</div><span class="cta">'+esc(c.cta)+' →</span></div></div>').join('')+'</div>';},
  overview(){const k=OV.kpi,o=OV.orders;
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Profiles',nf(k.profiles),nf(k.identified)+' identified','ink')+tile('Revenue',rub(o.revenue),nf(o.count)+' orders','gold')+
      tile('Events',nf(k.events),nf(k.active1)+' in 24h','sage')+tile('Active 7 days',nf(k.active7),'events this week','rust')+'</div>'+
      chart('Activity by day','Events over 30 days',vbars(OV.daily))+
      '<div class="grid two" style="margin-top:16px">'+
      chart('Lifecycle','Each profile in one segment (by visit recency)',donut(OV.lifecycle))+
      chart('Traffic sources','Where profiles come from',hbars(OV.sources))+
      chart('Top events','What they do on the site',hbars(OV.topEvents))+
      chart('Consent · CCPA/CPRA','Processing purposes',OV.consent.total?hbars(OV.consent.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">no records</div>')+'</div>';},
  profiles(){
    window.plQuery=''; window.plFilter='all'; window.plPage=1;
    var CH=[['all','All'],['identified','Identified'],['anon','Anonymous'],['buyers','Buyers'],['Active','Active'],['Dormant','Dormant'],['Lost','Lost'],['New','New']];
    var chips=CH.map(function(c){var on=(c[0]==='all')?' on':'';return '<button class="plchip'+on+'" data-plfilter="'+c[0]+'">'+esc(c[1])+'</button>';}).join('');
    return '<div class="plbar"><input id="plq" class="plsearch" type="search" placeholder="Search: name, ID, city, source, event…" oninput="plSearch(this.value)"><div class="plchips">'+chips+'</div></div><div id="pltbl" class="muted">Loading profiles…</div>';
  },
  segments(){return segRender();},
    sources(){
    const src=OV.sources, total=src.reduce((s,x)=>s+x.value,0)||1;
    const val=l=>{const x=src.find(s=>s.label===l);return x?x.value:0;};
    const mp=val('Wildberries')+val('Ozon');
    const own=total-mp;
    const SOC=['Instagram','TikTok','Reddit','YouTube','X (Twitter)','Pinterest'];
    const social=src.filter(s=>SOC.indexOf(s.label)>=0);
    const socSum=social.reduce((a,s)=>a+s.value,0);
    const split=[{label:'Owned site and social',value:own,tone:'sage'},{label:'Marketplaces (Amazon/Walmart)',value:mp,tone:'rust'}];
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Sources',String(src.length),'platforms','ink')+
      tile('Top source',(src[0]||{}).label||'—',nf((src[0]||{}).value||0)+' events','gold')+
      tile('Owned vs marketplace',Math.round(own/total*100)+'%','non-marketplace share','sage')+
      tile('Social',nf(socSum),social.length+' platforms','rust')+'</div>'+
      '<div class="note">Your own site vs marketplaces: <b>'+esc((src[0]||{}).label||'')+'</b> is bigger than Amazon and Walmart. The marketplace owns the contact — your own traffic stays yours.</div>'+
      '<div class="grid two">'+
        chart('Traffic sources','Rolled up by platform',hbars(src))+
        chart('Owned vs marketplace','Who owns the customer',donut(split))+
      '</div>'+
      '<div class="grid two" style="margin-top:16px">'+
        chart('US social','Instagram · TikTok · Reddit · YouTube — where demand is',social.length?hbars(social):'<div class="muted">no social traffic this period</div>')+
        chart('Activity by day','All sources, events over 30 days',vbars(OV.daily))+
      '</div>';
  },
    email(){return emailRender();},
    consent(){
    const c=OV.consent, k=OV.kpi;
    const pv=p=>{const x=c.purposes.find(q=>new RegExp(p).test(q.label));return x?x.count:0;};
    const email=pv('Email'), msg=pv('messaging'), cross=pv('Cross-border');
    const checks=[
      ['Per-purpose consent','Consent for each purpose separately, no pre-checked boxes','sage','met'],
      ['Signed log','Immutable hash-chain record: who chose what and when — proof for an audit','gold','active'],
      ['Right to delete (DSAR)','Consumer request → export and delete their data','sage','built in'],
      ['Cross-border',cross?'cross-border transfer consents on file':'cross-border transfer denied by default','rust',cross?'on file':'default-deny'],
      ['US data hosting','Visitor data stays in the US','sage','US'],
      ['Send gate','Emails and messages go only to those with verified consent','gold','fail-closed']];
    const jr=c.total?[['#'+nf(c.total),'personal_data · marketing_email','CMP · ecoma.com','just now'],['#'+nf(c.total-1),'analytics','CMP · ecoma.com','3m'],['#'+nf(Math.max(1,c.total-2)),'personal_data · marketing_messaging','CMP · ecoma.com','18m']]:[];
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Consent records',nf(c.total),'signed hash-chain','sage')+
      tile('Purposes',String(c.purposes.length),'all per-purpose','gold')+
      tile('Emailable',nf(email),'verified marketing_email','rust')+
      tile('Reachable by SMS',nf(msg),'verified messaging','ink')+'</div>'+
      '<div class="grid two">'+
        chart('Purposes · CCPA/CPRA','Consent distribution by purpose',c.total?hbars(c.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">no records</div>')+
        chart('Reachability by channel','Who you can contact by consent',hbars([{label:'Email marketing',value:email,tone:'rust'},{label:'SMS / messaging',value:msg,tone:'sage'},{label:'Total records',value:c.total,tone:'gold'}]))+
      '</div>'+
      '<div class="sec"><p class="label">Compliance</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">CCPA/CPRA checklist</h2></div>'+
      '<div class="grid k3">'+checks.map(x=>'<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>'+esc(x[0])+'</b>'+badge(x[3],x[2])+'</div><p class="muted" style="font-size:13.5px;margin:8px 0 0;line-height:1.5">'+esc(x[1])+'</p></div>').join('')+'</div>'+
      '<div class="sec"><p class="label">Log</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Recent consents (hash-chain)</h2></div>'+
      '<div class="card"><div class="tw"><table><thead><tr><th>Record</th><th>Purposes</th><th>Where</th><th>When</th><th>Signature</th></tr></thead><tbody>'+
        (jr.length?jr.map(r=>'<tr><td class="id">'+esc(r[0])+'</td><td class="muted">'+esc(r[1])+'</td><td class="muted">'+esc(r[2])+'</td><td class="muted">'+esc(r[3])+'</td><td>'+badge('valid','sage')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">no records</td></tr>')+
      '</tbody></table></div></div>';
  },
    services(){
    const k=OV.kpi, c=OV.consent;
    const used=k.profiles;
    const limProfiles = used<2000?5000 : used<8000?10000 : used<40000?50000 : 100000;
    const limEvents = limProfiles*10;
    const planName = limProfiles<=5000?'Start' : limProfiles<=10000?'Growth' : 'Business';
    const mods=[
      {name:'CDP · unified customer base',tone:'gold',on:true,price:0,priceLbl:'plan core',use:k.profiles,lim:limProfiles,unit:'profiles'},
      {name:'Web tracker · events',tone:'sage',on:true,price:0,priceLbl:'included',use:k.events,lim:limEvents,unit:'events/mo'},
      {name:'Profiles and segments',tone:'gold',on:true,price:0,priceLbl:'included',use:k.identified,lim:limProfiles,unit:'identified'},
      {name:'Consent · CCPA/CPRA',tone:'rust',on:true,price:29,use:c.total,lim:null,unit:'records'},
      {name:'Email marketing · Quill',tone:'rust',on:true,price:49,use:null,lim:null,unit:''},
      {name:'Instagram · social signals',tone:'sage',on:false,price:19,use:null,lim:null,unit:''},
      {name:'SMS · messaging',tone:'gold',on:false,price:19,use:null,lim:null,unit:''},
      {name:'YouTube · video',tone:'rust',on:false,price:15,use:null,lim:null,unit:''},
      {name:'Google Analytics · web',tone:'sage',on:false,price:0,priceLbl:'included',use:null,lim:null,unit:''}
    ];
    const base=79;
    const addons=mods.filter(m=>m.on&&m.price>0).reduce((s2,m)=>s2+m.price,0);
    const total=base+addons;
    const fillPct=Math.min(100,Math.round(k.profiles/limProfiles*100));
    function ubar(lbl,use,lim,unit,tone){var pct=lim?Math.min(100,Math.round(use/lim*100)):0;var col=(pct>85?TONE.rust:TONE[tone]);
      return '<div class="bar"><div class="tp"><span style="font-weight:600">'+lbl+'</span><span class="cap">'+nf(use)+(lim?(' / '+nf(lim)):'')+(unit?(' '+unit):'')+(lim?(' · '+pct+'%'):'')+'</span></div><div class="track"><div class="fill" style="width:'+(lim?pct:8)+'%;background:'+col+'"></div></div></div>';}
    const rows=mods.map(m=>{
      const st=m.on?badge('connected','sage'):badge('available','muted');
      const price=m.price>0?('$'+nf(m.price)+'/mo'):(m.priceLbl||'included');
      const usage=(m.lim!=null)?(nf(m.use)+' / '+nf(m.lim)+(m.unit?(' '+m.unit):'')):(m.use!=null?(nf(m.use)+(m.unit?(' '+m.unit):'')):'—');
      const act=m.on?'<span class="muted cap">active</span>':'<span class="cta">Connect →</span>';
      return '<tr><td style="font-weight:600">'+esc(m.name)+'</td><td>'+st+'</td><td class="muted">'+usage+'</td><td style="font-weight:600">'+price+'</td><td>'+act+'</td></tr>';
    }).join('');
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Plan',planName,'up to '+nf(limProfiles)+' profiles','ink')+
      tile('Cost',rub(total)+'/mo',nf(mods.filter(m=>m.on).length)+' services connected','gold')+
      tile('Next charge','Aug 1','auto-renew','sage')+
      tile('Limit used',fillPct+'%',nf(k.profiles)+' of '+nf(limProfiles)+' profiles','rust')+'</div>'+
      chart('Plan usage','How much of your plan limit is used','<div class="bars">'+ubar('Profiles',k.profiles,limProfiles,'profiles','gold')+ubar('Events this period',k.events,limEvents,'events','sage')+ubar('Consent records',c.total,null,'records','rust')+'</div>')+
      '<div class="sec"><p class="label">Subscription</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Connected services, cost, and limits</h2></div>'+
      '<div class="card"><div class="tw"><table><thead><tr><th>Service</th><th>Status</th><th>Usage / limit</th><th>Cost</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
      '<div class="note" style="margin-top:16px">Connected services are billed on the '+planName+' plan — '+rub(total)+'/mo. Profile limit — '+nf(limProfiles)+'; we suggest the next plan as you approach it. Available services connect in one click and add to the bill.</div>';
  }
};

function renderProfiles(list){
  if(!list.length){$('#pl').outerHTML='<div class="muted">No profiles</div>';return;}
  const rows=list.map(p=>{
    const who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">anonymous</span>';
    const ch=p.events.slice(0,3).map(e=>'<span class="chip">'+esc(e.event)+'·'+e.count+'</span>').join('');
    const src=esc((window._mapLabel?window._mapLabel(p.origin):p.origin)||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+p.count+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.firstSeen)+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  const html='<table><thead><tr><th>Profile</th><th>Who</th><th>City</th><th>Events</th><th>Revenue</th><th>First</th><th>Last</th><th>Source</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table><div class="muted" style="margin-top:8px">Showing '+list.length+' profiles (by last activity)</div>';
  const el=$('#pl'); if(el) el.outerHTML='<div class="tw">'+html+'</div>'; else $('#view').innerHTML='<div class="tw">'+html+'</div>';
}

function showErr(e){$('#err').innerHTML=e?'<div class="err">Error: '+esc(e)+'</div>':'';}
async function j(u){const r=await fetch(u);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));return r.json();}

const isSec=id=>SECTIONS.some(s=>s[0]===id);
function secFromPath(){const seg=(location.pathname.replace(/\\/+$/,'')||'/').slice(1);if(seg==='automations'){window.segTab='flows';return 'segments';}if(seg==='segments'&&window.segTab==null)window.segTab='audience';return isSec(seg)?seg:'overview';}
function navTo(id){if(!isSec(id))return;if(id==='segments')window.segTab='audience';const q=location.search;if(location.pathname!=='/'+id)history.pushState({id:id},'','/'+id+q);setActive(id);}
function syncTenantUrl(){var t=$('#tenant').value;var sp=new URLSearchParams(location.search);if(t)sp.set('tenant',t);else sp.delete('tenant');if(cur!=='email')sp.delete('tab');var qs=sp.toString();var bp=(cur==='segments'&&window.segTab==='flows')?'/automations':('/'+cur);history.replaceState({id:cur},'',bp+(qs?'?'+qs:''));}
function setActive(id){
  cur=id; const meta=SECTIONS.find(s=>s[0]===id);
  $('#title').textContent=meta?meta[1]:id;
  document.title=(meta?meta[1]:id)+' · Axiom';
  document.body.classList.remove('menu');
  document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('on',a.dataset.id===id));
  if(!OV){return;}
  $('#view').innerHTML=(VIEWS[id]||VIEWS.overview)();
  if(id==='profiles') j('/api/profiles?tenant='+encodeURIComponent(TENANT)+'&limit=500').then(function(list){window.PROFILES=list||[];window.plPage=1;window.plRenderTable();}).catch(e=>showErr(e.message||e));
}
async function load(){
  showErr(''); TENANT=$('#tenant').value; $('#sub').textContent='tenant: '+TENANT; syncTenantUrl();
  try{ OV=await j('/api/overview?tenant='+encodeURIComponent(TENANT)); setActive(cur); }
  catch(e){ showErr(e.message||e); }
}
async function init(){
  cur=secFromPath();
  $('#nav').innerHTML=SECTIONS.map(s=>'<a href="/'+s[0]+'" data-id="'+s[0]+'"><span class="ic">'+s[2]+'</span>'+s[1]+'</a>').join('');
  document.querySelectorAll('.nav a').forEach(a=>a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();navTo(a.dataset.id);});
  window.onpopstate=()=>setActive(secFromPath());document.addEventListener('click',function(e){if(!e.target||!e.target.closest)return;var sg=e.target.closest('[data-segtab]');if(sg){e.preventDefault();window.segTo(sg.getAttribute('data-segtab'));return;}var pf=e.target.closest('[data-plfilter]');if(pf){e.preventDefault();window.plSetFilter(pf.getAttribute('data-plfilter'));return;}var pp=e.target.closest('[data-plpage]');if(pp){if(pp.disabled)return;e.preventDefault();window.plGo(parseInt(pp.getAttribute('data-plpage'),10));return;}});
  $('#burger').onclick=()=>document.body.classList.toggle('menu');
  $('#bd').onclick=()=>document.body.classList.remove('menu');
  try{
    const cfg=await j('/api/config'); const ts=await j('/api/tenants');
    if(!ts.length){showErr('No tenants (cdp_events_* empty)');return;}
    $('#tenant').innerHTML=ts.map(t=>'<option value="'+esc(t.tenant)+'">'+esc(t.tenant)+' ('+nf(t.docs)+')</option>').join('');
    const qt=new URLSearchParams(location.search).get('tenant');
    if(qt&&ts.some(t=>t.tenant===qt))$('#tenant').value=qt;
    if(cfg.locked)$('#tenant').style.display='none';
    $('#tenant').onchange=load; load();
  }catch(e){showErr(e.message||e);}
}
init();
</script></body></html>`;
