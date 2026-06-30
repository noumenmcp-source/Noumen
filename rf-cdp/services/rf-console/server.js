'use strict';
/*
 * rf-console — РФ-аналог аналитической консоли AXIOM (US /overview), на русском.
 *
 * Полностью server-side агрегирует РФ-метрики из Elasticsearch (события
 * cdp_events_<site>, согласия cdp_consent_<site>) и отдаёт аналитический дашборд
 * в фирменном стиле AXIOM (кремовый/тёмный, Lora, gold/sage/rust) с РФ-метриками
 * (профили, жизненный цикл по recency, активность) и РФ-источниками
 * (ВКонтакте/Telegram/Яндекс/Rutube/YouTube/веб-трекер). Зависимостей ноль:
 * Node http + global fetch. ES-креды в env, в браузер не попадают.
 *
 * РФ-специфика сохранена: 152-ФЗ согласия, кириллица в подписях, источники РФ.
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

// ─── РФ-источники: origin/utm → русская подпись + тон ──────────────────────────
const SOURCE_MAP = [
  [/vk\.com|vkontakte|\bvk\b/i, 'ВКонтакте', 'gold'],
  [/t\.me|telegram|\btg\b/i, 'Telegram', 'sage'],
  [/rutube/i, 'Rutube', 'gold'],
  [/youtube|youtu\.be/i, 'YouTube', 'rust'],
  [/yandex|ya\.ru|дзен|dzen|zen\./i, 'Яндекс', 'rust'],
  [/mail\.ru|my\.com/i, 'Mail.ru', 'sage'],
  [/odnoklassniki|\bok\.ru\b/i, 'Одноклассники', 'gold'],
  [/google|youtu/i, 'Google', 'muted'],
];
function mapSource(origin) {
  const o = String(origin || '').trim();
  if (!o || o === '(direct)' || o === 'direct' || o === 'null') return { label: 'Прямые заходы', tone: 'muted' };
  for (const [re, label, tone] of SOURCE_MAP) if (re.test(o)) return { label, tone };
  // оставить домен как есть (без протокола), реферал
  return { label: o.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 28), tone: 'sage' };
}

// ─── Жизненный цикл по recency (РФ-сегменты) ───────────────────────────────────
function bucketLifecycle(profiles, nowMs) {
  const b = { Новые: 0, Активные: 0, Спящие: 0, Потерянные: 0 };
  for (const p of profiles) {
    const first = p.firstSeen ? Date.parse(p.firstSeen) : 0;
    const last = p.lastSeen ? Date.parse(p.lastSeen) : 0;
    const ageFirst = nowMs - first;
    const ageLast = nowMs - last;
    if (ageFirst <= 7 * DAY) b.Новые++;
    else if (ageLast <= 7 * DAY) b.Активные++;
    else if (ageLast <= 30 * DAY) b.Спящие++;
    else b.Потерянные++;
  }
  return b;
}
const LIFECYCLE_TONE = { Новые: 'sage', Активные: 'gold', Спящие: 'rust', Потерянные: 'muted' };
const LIFECYCLE_DESC = { Новые: 'первый визит ≤7 дней', Активные: 'визит ≤7 дней', Спящие: 'визит 7–30 дней', Потерянные: 'визит >30 дней' };

async function profilesOf(tenant, nowMs) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    aggs: {
      profiles: {
        terms: { field: 'anonymous_id.keyword', size: 2000 },
        aggs: { fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } } },
      },
    },
  });
  if (q._missing) return [];
  const buckets = (q.aggregations && q.aggregations.profiles.buckets) || [];
  return buckets.map((b) => ({ id: b.key, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string }));
}

// РФ-метки целей обработки (152-ФЗ): purpose → русская подпись
const PURPOSE_RU = {
  personal_data: 'Обработка ПДн', pdn_processing: 'Обработка ПДн', marketing: 'Маркетинг',
  marketing_email: 'Email-маркетинг', marketing_messaging: 'Мессенджеры', analytics: 'Аналитика',
  third_party_transfer: 'Передача 3-м лицам', cross_border: 'Трансгранично',
};
async function consentStats(tenant) {
  const q = await es('/cdp_consent_' + tenant + '/_search', {
    size: 0, track_total_hits: true,
    aggs: { purposes: { terms: { field: 'consent.purposes.keyword', size: 12 } } },
  }).catch(() => ({ _missing: true }));
  if (q._missing) return { total: 0, purposes: [] };
  const total = (q.hits && q.hits.total && q.hits.total.value) || 0;
  const purposes = ((q.aggregations && q.aggregations.purposes.buckets) || [])
    .map((b) => ({ purpose: b.key, label: PURPOSE_RU[b.key] || b.key, count: b.doc_count }));
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
      sources: { terms: { field: 'origin.keyword', size: 20 } },
      events: { terms: { field: 'event.keyword', size: 8 } },
      daily: { date_histogram: { field: 'ts', calendar_interval: 'day', min_doc_count: 0, extended_bounds: { min: 'now-13d/d', max: 'now/d' } } },
    },
  });
  if (main._missing) throw new Error('index not found');
  const a = main.aggregations;

  // источники: схлопнуть по русской подписи (несколько origin → один источник)
  const srcMap = new Map();
  for (const b of a.sources.buckets) {
    const m = mapSource(b.key);
    const cur = srcMap.get(m.label) || { label: m.label, tone: m.tone, value: 0 };
    cur.value += b.doc_count;
    srcMap.set(m.label, cur);
  }
  const sources = [...srcMap.values()].sort((x, y) => y.value - x.value).slice(0, 8);

  const profs = await profilesOf(tenant, nowMs);
  const lc = bucketLifecycle(profs, nowMs);
  const lifecycle = Object.keys(lc).map((k) => ({ label: k, value: lc[k], tone: LIFECYCLE_TONE[k], desc: LIFECYCLE_DESC[k] }));

  const consent = await consentStats(tenant);

  const daily = a.daily.buckets.map((b) => ({
    label: new Date(b.key).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    value: b.doc_count,
  }));

  return {
    tenant,
    kpi: {
      profiles: a.uniq.value,
      identified: a.ident.value,
      events: (main.hits.total && main.hits.total.value) || 0,
      active7: a.d7.doc_count,
      active1: a.d1.doc_count,
    },
    sources,
    lifecycle,
    topEvents: a.events.buckets.map((b) => ({ label: b.key, value: b.doc_count, tone: 'sage' })),
    daily,
    consent,
  };
}

function send(res, code, data, type) {
  const body = type === 'html' ? data : JSON.stringify(data);
  res.writeHead(code, { 'content-type': type === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/' || p === '/overview' || p === '/index.html') return send(res, 200, HTML, 'html');
    if (p === '/health') return send(res, 200, { ok: true });
    const hdr = req.headers['x-cdp-tenant'];
    const locked = hdr && TENANT_RE.test(hdr) ? hdr : null;
    if (p === '/api/config') return send(res, 200, { locked });
    if (p === '/api/tenants') {
      const all = await listTenants();
      return send(res, 200, locked ? all.filter((t) => t.tenant === locked) : all);
    }
    const tenant = locked || u.searchParams.get('tenant');
    if (p === '/api/overview') {
      if (!tenant) return send(res, 400, { error: 'tenant required' });
      return send(res, 200, await aggregate(tenant, Date.now()));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log('rf-console on :' + PORT + ' es=' + ES_URL));
}

module.exports = { mapSource, bucketLifecycle, aggregate, listTenants, server };

// ─── фронт (AXIOM-стиль, русский, SVG-чарты без зависимостей) ──────────────────
const HTML = /* html */ `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AXIOM · Аналитика</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root{--gold:#c9a84c;--sage:#4a7c59;--rust:#c4683a;--ink:#1c1510;--muted:#7a6e60;--line:#e0d8cc;
        --cream:#f5f0e8;--panel:#fffdf9;--head:#1c1510}
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);color:var(--ink);
       font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .serif{font-family:Lora,Georgia,serif}
  .mono{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  header{display:flex;align-items:center;gap:16px;padding:16px 26px;background:var(--head);color:var(--cream);position:sticky;top:0;z-index:5}
  header .logo{font-family:Lora,serif;font-weight:700;font-size:19px;letter-spacing:.04em}
  header .badge{font-size:10px;letter-spacing:.12em;text-transform:uppercase;border:1px solid #5b4d3e;border-radius:20px;padding:3px 10px;color:#c9a84c}
  header .sub{color:#b6a892;font-size:12px}
  .spacer{flex:1}
  select{background:#2a2018;color:var(--cream);border:1px solid #5b4d3e;border-radius:8px;padding:7px 11px;font:inherit;cursor:pointer}
  main{padding:26px;max-width:1180px;margin:0 auto}
  h1.title{font-family:Lora,serif;font-size:30px;font-weight:700;margin:.1em 0 0;line-height:1.1}
  .grid{display:grid;gap:18px}
  .kpi{grid-template-columns:repeat(4,1fr);margin-bottom:22px}
  .two{grid-template-columns:1fr 1fr}
  .four{grid-template-columns:repeat(4,1fr)}
  @media(max-width:880px){.kpi,.two,.four{grid-template-columns:1fr 1fr}}
  @media(max-width:560px){.kpi,.two,.four{grid-template-columns:1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(28,21,16,.04)}
  .card h2{font-family:Lora,serif;font-size:17px;font-weight:700;margin:0}
  .card .st{color:var(--muted);font-size:12px;margin:2px 0 14px}
  .tile .v{font-family:Lora,serif;font-size:30px;font-weight:700;line-height:1;margin-top:8px}
  .tile .h{color:var(--muted);font-size:12px;margin-top:6px}
  .bars{display:grid;gap:13px}
  .bar .top{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:5px}
  .bar .cap{color:var(--muted)}
  .track{height:9px;border-radius:9px;background:var(--cream);overflow:hidden}
  .fill{height:100%;border-radius:9px}
  .legend{display:grid;gap:7px;margin-left:8px}
  .legend li{display:flex;align-items:center;gap:8px;list-style:none}
  .legend .sw{width:11px;height:11px;border-radius:3px;flex:none}
  .legend .nm{font-weight:600}
  .vb{display:flex;align-items:flex-end;gap:5px;height:150px}
  .vb .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}
  .vb .rect{width:100%;border-radius:3px 3px 0 0}
  .vb .x{font-size:9px;color:var(--muted);margin-top:6px;text-align:center}
  .svc{display:flex;flex-direction:column}
  .svc .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .svc .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:7px}
  .svc .m{font-family:Lora,serif;font-size:22px;font-weight:700;line-height:1}
  .svc .c{color:var(--muted);font-size:12px;margin-top:6px;line-height:1.4}
  .stat{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);display:flex;align-items:center;gap:5px}
  .stat .d{width:5px;height:5px;border-radius:50%;background:var(--sage)}
  ul{margin:0;padding:0}
  .err{color:#b3402a;background:#c4683a18;border:1px solid #c4683a55;border-radius:8px;padding:12px 14px;margin-bottom:14px}
  ul.evs{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
  ul.evs li{list-style:none;background:var(--cream);border:1px solid var(--line);border-radius:18px;padding:4px 11px;font-size:12px;color:var(--muted)}
  ul.evs b{color:var(--ink)}
</style></head><body>
<header>
  <span class="logo">AXIOM</span>
  <span class="badge">РФ · 152-ФЗ</span>
  <span class="sub" id="sub"></span>
  <div class="spacer"></div>
  <select id="tenant"></select>
</header>
<main>
  <div id="err"></div>
  <p class="label">Аналитический обзор</p>
  <h1 class="title">Ваша база — как на ладони.</h1>
  <div style="height:18px"></div>
  <div class="grid kpi" id="kpi"></div>
  <div class="card" style="margin-bottom:18px">
    <h2 class="serif">Активность по дням</h2><div class="st" id="actSub">События за последние 14 дней</div>
    <div class="vb" id="activity"></div>
  </div>
  <div class="grid two">
    <div class="card"><h2 class="serif">Жизненный цикл</h2><div class="st">Каждый профиль — в одном сегменте (по давности визита)</div><div id="lifecycle"></div></div>
    <div class="card"><h2 class="serif">Источники трафика</h2><div class="st">Откуда приходят профили — площадки РФ</div><div id="sources"></div></div>
    <div class="card"><h2 class="serif">Согласия · 152-ФЗ</h2><div class="st">Opt-in по ст.9, подписанная цепочка</div><div id="consent"></div></div>
    <div class="card"><h2 class="serif">Топ событий</h2><div class="st">Что делают на сайте</div><div id="events"></div></div>
  </div>
  <div style="margin:30px 0 14px"><p class="label">Все сервисы · одна база</p><h2 class="serif" style="font-size:22px;margin:.1em 0 0">Вся платформа на вашем тенанте.</h2></div>
  <div class="grid four" id="connectors"></div>
</main>
<script>
const TONE={gold:'#c9a84c',sage:'#4a7c59',rust:'#c4683a',ink:'#1c1510',muted:'#7a6e60',line:'#e0d8cc'};
const $=s=>document.querySelector(s);
const nf=n=>(n||0).toLocaleString('ru-RU');
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function showErr(e){$('#err').innerHTML=e?'<div class="err">Ошибка: '+esc(e)+'</div>':''}

function tile(label,value,hint,tone){return '<div class="card tile"><p class="label">'+esc(label)+'</p><div class="v" style="color:'+(TONE[tone]||TONE.ink)+'">'+esc(value)+'</div>'+(hint?'<div class="h">'+esc(hint)+'</div>':'')+'</div>';}
function hbars(bars,fmt){const max=Math.max(...bars.map(b=>b.value),1);fmt=fmt||(v=>nf(v));
  return '<div class="bars">'+bars.map(b=>'<div class="bar"><div class="top"><span style="font-weight:600">'+esc(b.label)+'</span><span class="mono cap">'+esc(b.caption||fmt(b.value))+'</span></div><div class="track"><div class="fill" style="width:'+Math.min(100,b.value/max*100)+'%;background:'+(TONE[b.tone]||TONE.sage)+'"></div></div></div>').join('')+'</div>';}
function donut(slices){const size=190,stroke=30,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r;
  const total=slices.reduce((s,x)=>s+x.value,0)||1;let off=0;
  const arcs=slices.filter(s=>s.value>0).map(s=>{const dash=s.value/total*circ;const el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';off+=dash;return el;}).join('');
  const leg='<ul class="legend">'+slices.map(s=>'<li><span class="sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="nm">'+esc(s.label)+'</span> <span class="mono" style="color:'+TONE.muted+';font-size:12px">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%'+(s.desc?'':'')+'</span></li>').join('')+'</ul>';
  return '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+'<text x="'+c+'" y="'+(c-2)+'" text-anchor="middle" font-family="Lora,serif" font-size="30" font-weight="700" fill="'+TONE.ink+'">'+nf(total)+'</text><text x="'+c+'" y="'+(c+18)+'" text-anchor="middle" font-size="11" letter-spacing="1" fill="'+TONE.muted+'">ПРОФИЛЕЙ</text></svg>'+leg+'</div>';}
function vbars(bars){const max=Math.max(...bars.map(b=>b.value),1);const peak=bars.reduce((bi,b,i,arr)=>b.value>arr[bi].value?i:bi,0);
  return bars.map((b,i)=>'<div class="col"><div class="rect" title="'+esc(b.label)+': '+nf(b.value)+'" style="height:'+Math.max(2,b.value/max*128)+'px;background:'+TONE.gold+';opacity:'+(i===peak?1:.5)+'"></div><div class="x">'+esc(b.label)+'</div></div>').join('');}
function svc(s){return '<div class="card svc"><div class="hd"><span class="label"><span class="dot" style="background:'+(TONE[s.tone]||TONE.sage)+'"></span>'+esc(s.name)+'</span>'+(s.status?'<span class="stat"><span class="d"></span>'+esc(s.status)+'</span>':'')+'</div><div class="m">'+esc(s.metric)+'</div><div class="c">'+esc(s.caption)+'</div></div>';}

function connectors(d){const k=d.kpi,c=d.consent;
  return [
    {name:'Веб-трекер',tone:'gold',status:'активен',metric:nf(k.events),caption:nf(k.profiles)+' профилей · '+nf(k.active7)+' активны за 7 дней'},
    {name:'Согласия · 152-ФЗ',tone:'sage',status:'активен',metric:nf(c.total),caption:'записей opt-in ст.9 · '+c.purposes.length+' целей · hash-chain подписан'},
    {name:'Профили и сегменты',tone:'gold',status:'активен',metric:nf(k.identified),caption:'идентифицировано · identity-stitching + RFM-сегменты'},
    {name:'Email-маркетинг',tone:'rust',status:'активен',metric:'РФ-шаблон',caption:'AI-копирайт · футер «О рекламе» ст.18 · гейт согласия'},
    {name:'ВКонтакте',tone:'sage',status:'готов',metric:'соц-сигналы',caption:'намерение + комментарии · кириллица-токенизация'},
    {name:'Telegram',tone:'rust',status:'готов',metric:'мессенджер',caption:'рассылки + сигналы · гейт marketing_messaging'},
    {name:'Rutube / YouTube',tone:'gold',status:'готов',metric:'видео',caption:'парсинг + идеи контента · лексикон РФ'},
    {name:'Яндекс.Метрика',tone:'sage',status:'готов',metric:'веб-аналитика',caption:'источники, цели, поведение — интеграция'},
  ];}

async function j(u){const r=await fetch(u);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));return r.json();}
async function init(){
  try{
    const cfg=await j('/api/config');const ts=await j('/api/tenants');
    if(!ts.length){showErr('Нет тенантов (индексы cdp_events_* пусты)');return;}
    $('#tenant').innerHTML=ts.map(t=>'<option value="'+esc(t.tenant)+'">'+esc(t.tenant)+' ('+nf(t.docs)+')</option>').join('');
    if(cfg.locked){$('#tenant').style.display='none';}
    load();
  }catch(e){showErr(e.message||e)}
}
async function load(){
  showErr('');const t=$('#tenant').value;$('#sub').textContent='тенант: '+t;
  try{
    const d=await j('/api/overview?tenant='+encodeURIComponent(t));
    const k=d.kpi;
    $('#kpi').innerHTML=[
      tile('Профилей',nf(k.profiles),nf(k.identified)+' идентифицировано','ink'),
      tile('Событий',nf(k.events),nf(k.active1)+' за 24 часа','gold'),
      tile('Активны за 7 дней',nf(k.active7),'событий за неделю','sage'),
      tile('Источников',String(d.sources.length),'площадок РФ','rust'),
    ].join('');
    $('#activity').innerHTML=vbars(d.daily);
    $('#lifecycle').innerHTML=donut(d.lifecycle);
    $('#sources').innerHTML=d.sources.length?hbars(d.sources):'<div style="color:var(--muted)">Источники не размечены</div>';
    $('#events').innerHTML=d.topEvents.length?hbars(d.topEvents):'<div style="color:var(--muted)">Нет событий</div>';
    const c=d.consent;
    $('#consent').innerHTML=c.total
      ? hbars(c.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'})))+'<div style="margin-top:10px;color:var(--muted);font-size:12px">'+nf(c.total)+' записей согласий · '+c.purposes.length+' целей обработки (ст.9)</div>'
      : '<div style="color:var(--muted)">Записей согласий пока нет (cdp_consent_'+esc(t)+')</div>';
    $('#connectors').innerHTML=connectors(d).map(svc).join('');
  }catch(e){showErr(e.message||e)}
}
$('#tenant').onchange=load;
init();
</script></body></html>`;
