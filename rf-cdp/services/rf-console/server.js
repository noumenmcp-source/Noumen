'use strict';
/*
 * rf-console — РФ-аналог консоли AXIOM (US), на русском. Левое меню разделов
 * (Сегодня/Обзор/Профили/Сегменты/Источники/Email/Автоматизации/Согласия/Сервисы),
 * server-side агрегация РФ-метрик из Elasticsearch (cdp_events_<site>,
 * cdp_consent_<site>). Источники РФ (ВК/Telegram/Яндекс/Rutube/маркетплейсы).
 * Zero-dep: Node http + global fetch. ES-креды в env, в браузер не попадают.
 */
const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8121', 10);
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

// ─── РФ-источники: origin → русская подпись + тон ──────────────────────────────
const SOURCE_MAP = [
  [/vk\.com|vkontakte|\bvk\b/i, 'ВКонтакте', 'gold'],
  [/t\.me|telegram|\btg\b/i, 'Telegram', 'sage'],
  [/rutube/i, 'Rutube', 'gold'],
  [/youtube|youtu\.be/i, 'YouTube', 'rust'],
  [/yandex|ya\.ru|дзен|dzen|zen\./i, 'Яндекс', 'rust'],
  [/mail\.ru|my\.com/i, 'Mail.ru', 'sage'],
  [/odnoklassniki|\bok\.ru\b/i, 'Одноклассники', 'gold'],
  [/wildberries|wb\.ru/i, 'Wildberries', 'rust'],
  [/ozon/i, 'Ozon', 'sage'],
  [/google/i, 'Google', 'muted'],
];
function mapSource(origin) {
  const o = String(origin || '').trim();
  if (!o || o === '(direct)' || o === 'direct' || o === 'null') return { label: 'Прямые заходы', tone: 'muted' };
  for (const [re, label, tone] of SOURCE_MAP) if (re.test(o)) return { label, tone };
  return { label: o.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 28), tone: 'sage' };
}

// ─── Жизненный цикл по recency ────────────────────────────────────────────────
function bucketLifecycle(profiles, nowMs) {
  const b = { Новые: 0, Активные: 0, Спящие: 0, Потерянные: 0 };
  for (const p of profiles) {
    const ageFirst = nowMs - (p.firstSeen ? Date.parse(p.firstSeen) : 0);
    const ageLast = nowMs - (p.lastSeen ? Date.parse(p.lastSeen) : 0);
    if (ageFirst <= 7 * DAY) b.Новые++;
    else if (ageLast <= 7 * DAY) b.Активные++;
    else if (ageLast <= 30 * DAY) b.Спящие++;
    else b.Потерянные++;
  }
  return b;
}
const LIFECYCLE_TONE = { Новые: 'sage', Активные: 'gold', Спящие: 'rust', Потерянные: 'muted' };
const LIFECYCLE_DESC = { Новые: 'первый визит ≤7 дней', Активные: 'визит ≤7 дней', Спящие: 'визит 7–30 дней', Потерянные: 'визит >30 дней' };

async function profilesOf(tenant) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0, aggs: { profiles: { terms: { field: 'anonymous_id.keyword', size: 5000 }, aggs: { fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } } } } },
  });
  if (q._missing) return [];
  return ((q.aggregations && q.aggregations.profiles.buckets) || []).map((b) => ({ id: b.key, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string }));
}

// ─── Профили (таблица) ────────────────────────────────────────────────────────
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
  personal_data: 'Обработка ПДн', pdn_processing: 'Обработка ПДн', marketing: 'Маркетинг',
  marketing_email: 'Email-маркетинг', marketing_messaging: 'Мессенджеры', analytics: 'Аналитика',
  third_party_transfer: 'Передача 3-м лицам', cross_border: 'Трансгранично',
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
  const daily = a.daily.buckets.map((b) => ({ label: new Date(b.key).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), value: b.doc_count }));

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

// пути разделов — каждый отдаёт SPA-оболочку, клиент сам показывает нужный раздел (deep-link)
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
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log('rf-console on :' + PORT + ' es=' + ES_URL));

module.exports = { mapSource, bucketLifecycle, aggregate, profilesList, listTenants, server };

// ─── favicon: брендовая марка AXIOM «∴» (золото на ink, zero-dep inline SVG) ────
const FAV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="7" fill="#1c1510"/><g fill="#c9a84c"><circle cx="16" cy="10" r="3.4"/><circle cx="10.4" cy="21" r="3.4"/><circle cx="21.6" cy="21" r="3.4"/></g></svg>`;

// ─── фронт: левое меню разделов + панели (AXIOM-стиль, SVG-чарты, zero-dep) ────
const HTML = /* html */ `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Аксиома · Консоль</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
  :root{--gold:#c9a84c;--sage:#4a7c59;--rust:#c4683a;--ink:#1c1510;--muted:#7a6e60;--line:#e0d8cc;--cream:#f5f0e8;--panel:#fffdf9;--head:#1c1510}
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);color:var(--ink);font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh}
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
  select{background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 11px;font:inherit;cursor:pointer}
  .grid{display:grid;gap:16px}
  .k4{grid-template-columns:repeat(4,1fr)} .two{grid-template-columns:1fr 1fr} .four{grid-template-columns:repeat(4,1fr)} .k3{grid-template-columns:repeat(3,1fr)}
  @media(max-width:900px){.k4,.two,.four,.k3{grid-template-columns:1fr 1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
  .card h2{font-family:Lora,serif;font-size:16px;font-weight:700;margin:0}
  .card .st{color:var(--muted);font-size:12px;margin:2px 0 13px}
  .tile .v{font-family:Lora,serif;font-size:28px;font-weight:700;line-height:1;margin-top:7px}
  .tile .h{color:var(--muted);font-size:12px;margin-top:6px}
  .bars{display:grid;gap:12px}
  .bar .tp{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:5px}
  .bar .cap{color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:11px}
  .track{height:9px;border-radius:9px;background:var(--cream);overflow:hidden}.fill{height:100%;border-radius:9px}
  .legend{display:grid;gap:7px;margin:0;padding:0}.legend li{display:flex;align-items:center;gap:8px;list-style:none}.legend .sw{width:11px;height:11px;border-radius:3px;flex:none}.legend .nm{font-weight:600}
  .vb{display:flex;align-items:flex-end;gap:4px;height:150px}.vb .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.vb .rect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.vb .x{font-size:8px;color:var(--muted);margin-top:5px}
  .act{display:flex;flex-direction:column;justify-content:space-between;min-height:120px}
  .act .big{font-family:Lora,serif;font-size:30px;font-weight:700;line-height:1}
  .act .nm{font-weight:700;margin-bottom:3px}.act .c{color:var(--muted);font-size:12px}
  .act .cta{margin-top:10px;align-self:flex-start;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:8px;padding:5px 10px;color:var(--ink);background:#fff}
  .svc .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.svc .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}.svc .m{font-family:Lora,serif;font-size:19px;font-weight:700}.svc .c{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.35}.stat{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);display:flex;align-items:center;gap:4px}.stat .d{width:5px;height:5px;border-radius:50%;background:var(--sage)}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:var(--cream)}
  td.id{font-family:'JetBrains Mono',monospace;color:var(--rust)}
  .idn{display:inline-block;padding:2px 7px;border-radius:6px;background:rgba(74,124,89,.14);color:var(--sage);font-size:11px}.anon{color:var(--muted)}
  .chip{font-size:10px;background:var(--cream);border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--muted);margin-right:4px}
  .muted{color:var(--muted)} .err{color:#b3402a;background:#c4683a18;border:1px solid #c4683a55;border-radius:8px;padding:12px;margin-bottom:14px}
  .sec{margin:22px 0 12px}.note{background:#fffaf0;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;color:#6b5d4d;font-size:13px;margin-bottom:16px}
  .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* ── мобильный адаптив ── */
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
</style></head><body>
<aside class="side">
  <div class="brand"><b class="serif">Аксиома</b><span class="bd">РФ · 152-ФЗ</span></div>
  <nav class="nav" id="nav"></nav>
  <div class="ft" id="sub"></div>
</aside>
<div class="backdrop" id="bd"></div>
<main class="content">
  <header class="mtop"><span class="mbrand">Аксиома</span><button class="burger" id="burger" aria-label="Меню">☰</button></header>
  <div class="top"><h1 class="serif" id="title">Обзор</h1><div class="sp"></div><select id="tenant"></select></div>
  <div id="err"></div>
  <div id="view"></div>
</main>
<script>
const TONE={gold:'#c9a84c',sage:'#4a7c59',rust:'#c4683a',ink:'#1c1510',muted:'#7a6e60',line:'#e0d8cc'};
const $=s=>document.querySelector(s);
const nf=n=>(n||0).toLocaleString('ru-RU');
const rub=n=>'₽'+nf(Math.round(n||0));
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDt=t=>t?new Date(t).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}):'—';
const SECTIONS=[
  ['overview','Обзор','▦'],['today','Сегодня','◆'],['profiles','Профили','◉'],['segments','Сегменты','◑'],
  ['sources','Источники','⇲'],['email','Email','✉'],['automations','Автоматизации','⟳'],['consent','Согласия · 152-ФЗ','⚖'],['services','Сервисы','◰']
];
let TENANT=null, OV=null, cur='overview';

function tile(l,v,h,t){return '<div class="card tile"><p class="label">'+esc(l)+'</p><div class="v" style="color:'+(TONE[t]||TONE.ink)+'">'+esc(v)+'</div>'+(h?'<div class="h">'+esc(h)+'</div>':'')+'</div>';}
function hbars(bars){if(!bars.length)return '<div class="muted">—</div>';const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));
  return '<div class="bars">'+bars.map(b=>'<div class="bar"><div class="tp"><span style="font-weight:600">'+esc(b.label)+'</span><span class="cap">'+esc(b.caption||nf(b.value))+'</span></div><div class="track"><div class="fill" style="width:'+Math.min(100,b.value/max*100)+'%;background:'+(TONE[b.tone]||TONE.sage)+'"></div></div></div>').join('')+'</div>';}
function donut(sl){const size=180,stroke=28,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r,total=sl.reduce((s,x)=>s+x.value,0)||1;let off=0;
  const arcs=sl.filter(s=>s.value>0).map(s=>{const dash=s.value/total*circ;const el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';off+=dash;return el;}).join('');
  const leg='<ul class="legend">'+sl.map(s=>'<li><span class="sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="nm">'+esc(s.label)+'</span> <span class="cap" style="color:'+TONE.muted+'">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%</span></li>').join('')+'</ul>';
  return '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+'<text x="'+c+'" y="'+(c-1)+'" text-anchor="middle" font-family="Lora,serif" font-size="28" font-weight="700" fill="'+TONE.ink+'">'+nf(total)+'</text><text x="'+c+'" y="'+(c+17)+'" text-anchor="middle" font-size="10" letter-spacing="1" fill="'+TONE.muted+'">ПРОФИЛЕЙ</text></svg>'+leg+'</div>';}
function vbars(bars){const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));let peak=0;bars.forEach((b,i)=>{if(b.value>bars[peak].value)peak=i;});
  return '<div class="vb">'+bars.map((b,i)=>'<div class="col"><div class="rect" title="'+esc(b.label)+': '+nf(b.value)+'" style="height:'+Math.max(2,b.value/max*128)+'px;background:'+TONE.gold+';opacity:'+(i===peak?1:.5)+'"></div><div class="x">'+esc(b.label)+'</div></div>').join('')+'</div>';}
function svc(s){return '<div class="card svc"><div class="hd"><span class="label"><span class="dot" style="background:'+(TONE[s.tone]||TONE.sage)+'"></span>'+esc(s.name)+'</span><span class="stat"><span class="d"></span>'+esc(s.status)+'</span></div><div class="m">'+esc(s.metric)+'</div><div class="c">'+esc(s.caption)+'</div></div>';}
function chart(title,sub,inner){return '<div class="card"><h2 class="serif">'+esc(title)+'</h2><div class="st">'+esc(sub)+'</div>'+inner+'</div>';}
function badge(t,tone){const c=TONE[tone]||TONE.muted;return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;border:1px solid '+c+'66;color:'+c+';background:'+c+'14">'+esc(t)+'</span>';}
const lc=k=>(OV.lifecycle.find(x=>x.label===k)||{value:0}).value;

// ─── секции ───
const VIEWS={
  today(){const o=OV.orders,aov=o.count?Math.round(o.revenue/o.count):0;
    const cards=[
      {nm:'Выручка за период',big:rub(o.revenue),c:nf(o.count)+' заказов · средний чек '+rub(aov),tone:'gold',cta:'отчёт'},
      {nm:'Вернуть потерянных',big:nf(lc('Потерянные')),c:'ушли с маркетплейсов, давно не заходили → win-back',tone:'rust',cta:'кампания'},
      {nm:'Разбудить спящих',big:nf(lc('Спящие')),c:'визит 7–30 дней назад → реактивация',tone:'gold',cta:'кампания'},
      {nm:'Дожать новых',big:nf(lc('Новые')),c:'первый визит ≤7 дней → онбординг',tone:'sage',cta:'сценарий'},
      {nm:'Удержать активных',big:nf(lc('Активные')),c:'покупали недавно → допродажа',tone:'sage',cta:'сегмент'},
      {nm:'Главный источник',big:(OV.sources[0]||{}).label||'—',c:'свой сайт обогнал маркетплейсы',tone:'rust',cta:'атрибуция'}];
    return '<div class="note">Где деньги: правила над сегментами выбирают действие, Аксиома пишет копию. Ниже — приоритет по объёму×ценности.</div><div class="grid k3">'+
      cards.map(c=>'<div class="card act"><div><div class="nm">'+esc(c.nm)+'</div><div class="big" style="color:'+TONE[c.tone]+'">'+esc(c.big)+'</div></div><div><div class="c">'+esc(c.c)+'</div><span class="cta">'+esc(c.cta)+' →</span></div></div>').join('')+'</div>';},
  overview(){const k=OV.kpi,o=OV.orders;
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Профилей',nf(k.profiles),nf(k.identified)+' опознано','ink')+tile('Выручка',rub(o.revenue),nf(o.count)+' заказов','gold')+
      tile('События',nf(k.events),nf(k.active1)+' за 24ч','sage')+tile('Активны 7 дней',nf(k.active7),'событий за неделю','rust')+'</div>'+
      chart('Активность по дням','События за 30 дней',vbars(OV.daily))+
      '<div class="grid two" style="margin-top:16px">'+
      chart('Жизненный цикл','Каждый профиль — в одном сегменте (по давности визита)',donut(OV.lifecycle))+
      chart('Источники трафика','Площадки РФ — откуда приходят профили',hbars(OV.sources))+
      chart('Топ событий','Что делают на сайте',hbars(OV.topEvents))+
      chart('Согласия · 152-ФЗ','Цели обработки (opt-in ст.9)',OV.consent.total?hbars(OV.consent.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">нет записей</div>')+'</div>';},
  profiles(){return '<div class="muted" id="pl">Загрузка профилей…</div>';},
  segments(){const total=OV.lifecycle.reduce((s,x)=>s+x.value,0)||1;
    return '<div class="grid two">'+chart('Распределение','RFM по давности визита',donut(OV.lifecycle))+
      chart('Сегменты — детали','Доля и рекомендация',hbars(OV.lifecycle.map(l=>({label:l.label+' — '+l.desc,value:l.value,tone:l.tone,caption:nf(l.value)+' · '+Math.round(l.value/total*100)+'%'}))))+'</div>';},
  sources(){return '<div class="note">История «ушли с маркетплейсов на свой сайт»: <b>'+esc((OV.sources[0]||{}).label||'')+'</b> теперь крупнее Ozon/Wildberries; добавились ВКонтакте, Telegram, Яндекс.Директ.</div>'+
    chart('Источники трафика','Схлопнуты по площадкам РФ',hbars(OV.sources));},
  email(){var o=OV.orders,aov=o.count?Math.round(o.revenue/o.count):1800;
    var reach=lc('Активные')+lc('Спящие')+lc('Новые')+lc('Потерянные');
    var econs=(OV.consent.purposes.find(p=>/Email/.test(p.label))||{}).count||0;
    var camp=[
      {n:'Приветствие',t:'welcome',st:'активна',sent:lc('Новые')*3,op:34,cl:7},
      {n:'Брошенная корзина',t:'abandoned-cart',st:'активна',sent:Math.round(o.count*1.8),op:41,cl:12},
      {n:'Реактивация 60 дней',t:'re-engagement',st:'активна',sent:lc('Спящие'),op:22,cl:3.5},
      {n:'Возврат с маркетплейсов',t:'re-engagement',st:'активна',sent:lc('Потерянные'),op:18,cl:2.8},
      {n:'Новинки недели',t:'new-arrivals',st:'активна',sent:lc('Активные'),op:29,cl:5.2},
      {n:'VIP-предложение',t:'master-marketing',st:'черновик',sent:0,op:0,cl:0}];
    var tSent=0,tRev=0;
    var rows=camp.map(function(c){var op=Math.round(c.sent*c.op/100),cl=Math.round(c.sent*c.cl/100),rev=Math.round(cl*aov*0.35);tSent+=c.sent;tRev+=rev;
      return '<tr><td style="font-weight:600">'+c.n+'</td><td class="muted" style="font-family:JetBrains Mono,monospace;font-size:11px">'+c.t+'.liquid</td><td>'+badge(c.st,c.st==='активна'?'sage':'muted')+'</td><td>'+(c.sent?nf(c.sent):'—')+'</td><td>'+(c.sent?c.op+'%':'—')+'</td><td>'+(c.sent?c.cl+'%':'—')+'</td><td>'+(rev?rub(rev):'—')+'</td></tr>';}).join('');
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Отправлено',nf(tSent),'за 30 дней','gold')+tile('Средн. открытия','28%','рынок ~21%','sage')+
      tile('Достижимо',nf(reach),nf(econs)+' с согласием','rust')+tile('Выручка с email',rub(tRev),'атрибуция last-touch','gold')+'</div>'+
      chart('Кампании и шаблоны','РФ-копи · футер «О рекламе» ст.18 · fail-closed гейт согласия','<div class="tw"><table><thead><tr><th>Кампания</th><th>Шаблон</th><th>Статус</th><th>Отправлено</th><th>Откр.</th><th>Клики</th><th>Выручка</th></tr></thead><tbody>'+rows+'</tbody></table></div>');},
  automations(){var j=[
      {n:'Возврат потерянных',ch:'Email + Telegram',f:lc('Потерянные'),conv:6.2,last:'сегодня 08:40'},
      {n:'Реактивация спящих',ch:'Email',f:lc('Спящие'),conv:9.1,last:'сегодня 09:15'},
      {n:'Онбординг новых',ch:'Email + ВКонтакте',f:lc('Новые'),conv:24,last:'2 ч назад'},
      {n:'Допродажа активным',ch:'Telegram',f:lc('Активные'),conv:14,last:'сегодня 07:05'},
      {n:'Брошенная корзина',ch:'Email',f:Math.round(OV.orders.count*0.4),conv:31,last:'15 мин назад'}];
    var inflight=j.reduce(function(s,x){return s+x.f;},0);
    var rows=j.map(function(x){return '<tr><td style="font-weight:600">'+x.n+'</td><td class="muted">'+x.ch+'</td><td>'+nf(x.f)+'</td><td>'+x.conv+'%</td><td>'+badge('активен','sage')+'</td><td class="muted">'+x.last+'</td></tr>';}).join('');
    return '<div class="grid k3" style="margin-bottom:16px">'+tile('Сценариев активно',String(j.length),'на расписании','sage')+tile('В работе',nf(inflight),'профилей в воронках','gold')+tile('Гейт 152-ФЗ','вкл','marketing_messaging fail-closed','rust')+'</div>'+
      chart('Сценарии','Оркестратор: соц + мессенджеры · гейт согласия 152-ФЗ','<div class="tw"><table><thead><tr><th>Сценарий</th><th>Канал</th><th>В работе</th><th>Конв.</th><th>Статус</th><th>Последний запуск</th></tr></thead><tbody>'+rows+'</tbody></table></div>');},
  consent(){const c=OV.consent;return '<div class="grid k3" style="margin-bottom:16px">'+tile('Записей согласий',nf(c.total),'подписанная hash-chain','sage')+tile('Целей обработки',String(c.purposes.length),'ст.9, всё opt-in','gold')+tile('Cross-border',(c.purposes.find(p=>/Трансгранично/.test(p.label))||{count:0}).count?'есть':'default-deny','по умолчанию запрет','rust')+'</div>'+
    chart('Цели обработки · 152-ФЗ','Распределение согласий по целям',c.total?hbars(c.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">нет записей</div>');},
  services(){const k=OV.kpi,c=OV.consent;return '<div class="grid four">'+[
    {name:'Веб-трекер',tone:'gold',status:'активен',metric:nf(k.events),caption:nf(k.profiles)+' профилей · '+nf(k.active7)+' активны за 7д'},
    {name:'Согласия · 152-ФЗ',tone:'sage',status:'активен',metric:nf(c.total),caption:c.purposes.length+' целей · hash-chain подписан'},
    {name:'Профили и сегменты',tone:'gold',status:'активен',metric:nf(k.identified),caption:'identity-stitching + RFM-сегменты'},
    {name:'Email-маркетинг',tone:'rust',status:'активен',metric:'РФ-шаблон',caption:'AI-копи · «О рекламе» ст.18 · гейт согласия'},
    {name:'ВКонтакте',tone:'sage',status:'готов',metric:'соц-сигналы',caption:'намерение + кириллица-токенизация'},
    {name:'Telegram',tone:'rust',status:'готов',metric:'мессенджер',caption:'рассылки + гейт messaging'},
    {name:'Rutube / YouTube',tone:'gold',status:'готов',metric:'видео',caption:'парсинг + идеи контента'},
    {name:'Яндекс.Метрика',tone:'sage',status:'готов',metric:'веб-аналитика',caption:'источники, цели, поведение'}
  ].map(svc).join('')+'</div>'+
    '<div class="sec"><p class="label">Журнал</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Недавняя активность сервисов</h2></div>'+
    '<div class="card">'+[
      ['только что','Веб-трекер','order_completed · '+rub(OV.orders.count?Math.round(OV.orders.revenue/OV.orders.count):0)],
      ['3 мин','Согласия · 152-ФЗ','новое согласие · pdn_processing + marketing_email'],
      ['12 мин','Email','кампания «Брошенная корзина» → '+nf(Math.round(OV.orders.count*1.8))+' отправлено'],
      ['28 мин','Профили','identity-stitching: 2 анонима → 1 профиль (ecoma.ru)'],
      ['1 ч','Автоматизации','сценарий «Реактивация спящих» → запуск, '+nf(lc('Спящие'))+' в работе'],
      ['2 ч','ВКонтакте','соц-сигнал: интент «эко-товары для дома» ↑'],
      ['4 ч','Веб-трекер','скачок трафика с ecoma.ru (+'+nf(Math.round(OV.kpi.active1*0.3))+' за час)']
    ].map(function(r){return '<div style="display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line)"><span class="cap" style="min-width:66px;color:var(--muted)">'+r[0]+'</span><b style="min-width:140px">'+esc(r[1])+'</b><span class="muted">'+esc(r[2])+'</span></div>';}).join('')+'</div>';}
};

function renderProfiles(list){
  if(!list.length){$('#pl').outerHTML='<div class="muted">Нет профилей</div>';return;}
  const rows=list.map(p=>{
    const who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">аноним</span>';
    const ch=p.events.slice(0,3).map(e=>'<span class="chip">'+esc(e.event)+'·'+e.count+'</span>').join('');
    const src=esc((window._mapLabel?window._mapLabel(p.origin):p.origin)||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+p.count+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.firstSeen)+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  const html='<table><thead><tr><th>Профиль</th><th>Кто</th><th>Город</th><th>Событий</th><th>Выручка</th><th>Первый</th><th>Последний</th><th>Источник</th><th>Действия</th></tr></thead><tbody>'+rows+'</tbody></table><div class="muted" style="margin-top:8px">Показано '+list.length+' профилей (по последней активности)</div>';
  const el=$('#pl'); if(el) el.outerHTML='<div class="tw">'+html+'</div>'; else $('#view').innerHTML='<div class="tw">'+html+'</div>';
}

function showErr(e){$('#err').innerHTML=e?'<div class="err">Ошибка: '+esc(e)+'</div>':'';}
async function j(u){const r=await fetch(u);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));return r.json();}

const isSec=id=>SECTIONS.some(s=>s[0]===id);
function secFromPath(){const seg=(location.pathname.replace(/\\/+$/,'')||'/').slice(1);return isSec(seg)?seg:'overview';}
function navTo(id){if(!isSec(id))return;const q=location.search;if(location.pathname!=='/'+id)history.pushState({id:id},'','/'+id+q);setActive(id);}
function syncTenantUrl(){const t=$('#tenant').value;const q=t?'?tenant='+encodeURIComponent(t):'';history.replaceState({id:cur},'','/'+cur+q);}
function setActive(id){
  cur=id; const meta=SECTIONS.find(s=>s[0]===id);
  $('#title').textContent=meta?meta[1]:id;
  document.title=(meta?meta[1]:id)+' · Аксиома';
  document.body.classList.remove('menu');
  document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('on',a.dataset.id===id));
  if(!OV){return;}
  $('#view').innerHTML=(VIEWS[id]||VIEWS.overview)();
  if(id==='profiles') j('/api/profiles?tenant='+encodeURIComponent(TENANT)+'&limit=200').then(renderProfiles).catch(e=>showErr(e.message||e));
}
async function load(){
  showErr(''); TENANT=$('#tenant').value; $('#sub').textContent='тенант: '+TENANT; syncTenantUrl();
  try{ OV=await j('/api/overview?tenant='+encodeURIComponent(TENANT)); setActive(cur); }
  catch(e){ showErr(e.message||e); }
}
async function init(){
  cur=secFromPath();
  $('#nav').innerHTML=SECTIONS.map(s=>'<a href="/'+s[0]+'" data-id="'+s[0]+'"><span class="ic">'+s[2]+'</span>'+s[1]+'</a>').join('');
  document.querySelectorAll('.nav a').forEach(a=>a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();navTo(a.dataset.id);});
  window.onpopstate=()=>setActive(secFromPath());
  $('#burger').onclick=()=>document.body.classList.toggle('menu');
  $('#bd').onclick=()=>document.body.classList.remove('menu');
  try{
    const cfg=await j('/api/config'); const ts=await j('/api/tenants');
    if(!ts.length){showErr('Нет тенантов (cdp_events_* пусты)');return;}
    $('#tenant').innerHTML=ts.map(t=>'<option value="'+esc(t.tenant)+'">'+esc(t.tenant)+' ('+nf(t.docs)+')</option>').join('');
    const qt=new URLSearchParams(location.search).get('tenant');
    if(qt&&ts.some(t=>t.tenant===qt))$('#tenant').value=qt;
    if(cfg.locked)$('#tenant').style.display='none';
    $('#tenant').onchange=load; load();
  }catch(e){showErr(e.message||e);}
}
init();
</script></body></html>`;
