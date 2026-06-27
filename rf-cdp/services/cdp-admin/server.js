'use strict';
/*
 * cdp-admin — operator dashboard for the CDP.
 * Shows per-tenant CUSTOMER PROFILES (who, what they viewed, event timeline).
 * Queries Elasticsearch server-side (creds via env, never exposed to the browser).
 * Auth is handled at the edge (Caddy basic_auth); this service trusts its network.
 * Zero npm deps: Node 18 built-in http + global fetch.
 */
const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8120', 10);
const ES_URL = (process.env.ES_URL || 'http://localhost:9200').replace(/\/$/, '');
const ES_USER = process.env.ES_USER || 'elastic';
const ES_PASSWORD = process.env.ES_PASSWORD || '';
const ES_AUTH = 'Basic ' + Buffer.from(ES_USER + ':' + ES_PASSWORD).toString('base64');

const TENANT_RE = /^[a-z0-9_-]+$/i;
const indexFor = (t) => { if (!TENANT_RE.test(t)) throw new Error('bad tenant'); return 'cdp_events_' + t; };

async function es(path, body) {
  const res = await fetch(ES_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: ES_AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error('ES ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

async function listTenants() {
  const rows = await es('/_cat/indices/cdp_events_*?format=json&h=index,docs.count');
  return rows
    .map((r) => ({ tenant: r.index.replace('cdp_events_', ''), index: r.index, docs: parseInt(r['docs.count'] || '0', 10) }))
    .filter((t) => TENANT_RE.test(t.tenant))
    .sort((a, b) => b.docs - a.docs);
}

async function overview(tenant) {
  const q = await es('/' + indexFor(tenant) + '/_search', {
    size: 0,
    track_total_hits: true,
    aggs: {
      profiles: { cardinality: { field: 'anonymous_id.keyword' } },
      identified: { cardinality: { field: 'user_id.keyword' } },
      last24: { filter: { range: { ts: { gte: 'now-24h' } } } },
      by_event: { terms: { field: 'event.keyword', size: 12 } },
    },
  });
  const a = q.aggregations;
  return {
    total: q.hits.total.value,
    profiles: a.profiles.value,
    identified: a.identified.value,
    last24: a.last24.doc_count,
    byEvent: a.by_event.buckets.map((b) => ({ event: b.key, count: b.doc_count })),
  };
}

async function profiles(tenant, limit) {
  const q = await es('/' + indexFor(tenant) + '/_search', {
    size: 0,
    aggs: {
      profiles: {
        terms: { field: 'anonymous_id.keyword', size: Math.min(limit || 200, 1000), order: { last_seen: 'desc' } },
        aggs: {
          first_seen: { min: { field: 'ts' } },
          last_seen: { max: { field: 'ts' } },
          last: { top_hits: { size: 1, sort: [{ ts: 'desc' }], _source: ['user_id', 'ip', 'ua', 'event', 'properties', 'origin'] } },
          evs: { terms: { field: 'event.keyword', size: 6 } },
        },
      },
    },
  });
  return q.aggregations.profiles.buckets.map((b) => {
    const s = (b.last.hits.hits[0] || {})._source || {};
    return {
      id: b.key, count: b.doc_count,
      firstSeen: b.first_seen.value_as_string, lastSeen: b.last_seen.value_as_string,
      userId: s.user_id || null, ip: s.ip || null, ua: s.ua || null,
      lastEvent: s.event || null, origin: s.origin || null,
      events: b.evs.buckets.map((e) => ({ event: e.key, count: e.doc_count })),
    };
  });
}

async function timeline(tenant, id) {
  const q = await es('/' + indexFor(tenant) + '/_search', {
    size: 300,
    query: { term: { 'anonymous_id.keyword': id } },
    sort: [{ ts: 'desc' }],
    _source: ['ts', 'event', 'type', 'properties', 'ip', 'ua', 'user_id', 'origin'],
  });
  return q.hits.hits.map((h) => h._source);
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
    if (p === '/' || p === '/index.html') return send(res, 200, HTML, 'html');
    if (p === '/health') return send(res, 200, { ok: true });
    // Per-site lock: Caddy sets X-CDP-Tenant on a site-specific subdomain → this view is pinned to it.
    const hdr = req.headers['x-cdp-tenant'];
    const locked = hdr && TENANT_RE.test(hdr) ? hdr : null;
    if (p === '/api/config') return send(res, 200, { locked });
    if (p === '/api/tenants') {
      const all = await listTenants();
      return send(res, 200, locked ? all.filter((t) => t.tenant === locked) : all);
    }
    const tenant = locked || u.searchParams.get('tenant');
    if (p === '/api/overview') return send(res, 200, await overview(tenant));
    if (p === '/api/profiles') return send(res, 200, await profiles(tenant, parseInt(u.searchParams.get('limit') || '200', 10)));
    if (p === '/api/profile') return send(res, 200, await timeline(tenant, u.searchParams.get('id')));
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log('cdp-admin on :' + PORT + ' es=' + ES_URL));

const HTML = /* html */ `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CDP · Профили</title>
<style>
  :root{--bg:#0d1117;--panel:#161b22;--panel2:#1c232c;--bd:#2a313c;--tx:#e6edf3;--mut:#8b949e;--acc:#3b82f6;--ok:#3fb950;--warn:#d29922}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--tx)}
  header{display:flex;align-items:center;gap:16px;padding:14px 22px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--bg);z-index:5}
  header h1{font-size:16px;font-weight:700;margin:0;letter-spacing:.2px}
  header .sub{color:var(--mut);font-size:12px}
  select,button{background:var(--panel2);color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:7px 11px;font:inherit;cursor:pointer}
  select:hover,button:hover{border-color:#3d4757}
  .spacer{flex:1}
  main{padding:22px;max-width:1280px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
  .card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:16px}
  .card .n{font-size:26px;font-weight:700}
  .card .l{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .evbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
  .ev{background:var(--panel);border:1px solid var(--bd);border-radius:20px;padding:4px 12px;font-size:12px;color:var(--mut)}
  .ev b{color:var(--tx)}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--bd);font-size:13px;white-space:nowrap}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:var(--panel2)}
  tbody tr{cursor:pointer}
  tbody tr:hover{background:var(--panel2)}
  td.id{font-family:ui-monospace,Menlo,monospace;color:var(--acc)}
  .idn{display:inline-block;padding:2px 7px;border-radius:6px;background:rgba(63,185,80,.12);color:var(--ok);font-size:11px}
  .anon{color:var(--mut)}
  .muted{color:var(--mut)}
  .chips{display:flex;gap:5px}
  .chip{font-size:10px;background:var(--panel2);border:1px solid var(--bd);border-radius:5px;padding:1px 6px;color:var(--mut)}
  .drawer{position:fixed;top:0;right:0;height:100%;width:480px;max-width:92vw;background:var(--panel);border-left:1px solid var(--bd);transform:translateX(100%);transition:transform .2s;overflow:auto;z-index:20;box-shadow:-20px 0 60px rgba(0,0,0,.4)}
  .drawer.open{transform:none}
  .drawer h2{margin:0;font-size:14px}
  .dh{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--panel)}
  .tl{padding:8px 18px 30px}
  .tli{padding:11px 0;border-bottom:1px solid var(--bd)}
  .tli .t{color:var(--mut);font-size:11px;font-family:ui-monospace,monospace}
  .tli .e{font-weight:600;margin:2px 0}
  .tli .d{color:var(--mut);font-size:12px;word-break:break-word}
  .close{margin-left:auto}
  .empty{color:var(--mut);text-align:center;padding:50px}
  .err{color:#f85149;padding:14px;border:1px solid #f8514955;border-radius:8px;background:#f8514911;margin-bottom:14px}
</style></head><body>
<header>
  <h1>CDP · Профили клиентов</h1>
  <span class="sub" id="sub"></span>
  <div class="spacer"></div>
  <select id="tenant"></select>
  <button id="refresh">↻ Обновить</button>
</header>
<main>
  <div id="err"></div>
  <div class="cards" id="cards"></div>
  <div class="evbar" id="evbar"></div>
  <table>
    <thead><tr><th>Профиль</th><th>Кто</th><th>Событий</th><th>Первый</th><th>Последний</th><th>IP</th><th>Что смотрел</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty" id="empty" style="display:none">Нет данных по этому сайту</div>
</main>
<div class="drawer" id="drawer">
  <div class="dh"><h2 id="dtitle"></h2><button class="close" onclick="closeDrawer()">✕</button></div>
  <div class="tl" id="tl"></div>
</div>
<script>
const $=s=>document.querySelector(s);
let TENANT=null;
const fmt=t=>t?new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dev=ua=>!ua?'—':/iphone|android|mobile/i.test(ua)?'📱':/mac|windows|linux/i.test(ua)?'💻':'•';
async function j(u){const r=await fetch(u);if(!r.ok)throw new Error((await r.json()).error||r.status);return r.json();}
function showErr(e){$('#err').innerHTML=e?'<div class="err">Ошибка: '+esc(e)+'</div>':''}

async function init(){
  try{
    const cfg=await j('/api/config');
    const ts=await j('/api/tenants');
    $('#tenant').innerHTML=ts.map(t=>'<option value="'+t.tenant+'">'+t.tenant+' ('+t.docs+')</option>').join('');
    if(cfg.locked){$('#tenant').style.display='none';document.querySelector('header h1').textContent='CDP · '+cfg.locked;}
    TENANT=ts[0]&&ts[0].tenant; if(TENANT) load();
    else $('#empty').style.display='block';
  }catch(e){showErr(e)}
}
async function load(){
  showErr(''); TENANT=$('#tenant').value;
  $('#sub').textContent='сайт: '+TENANT;
  try{
    const [ov,ps]=await Promise.all([j('/api/overview?tenant='+TENANT),j('/api/profiles?tenant='+TENANT)]);
    $('#cards').innerHTML=[['Профилей',ov.profiles],['Идентифицировано',ov.identified],['Событий всего',ov.total],['За 24 часа',ov.last24]]
      .map(c=>'<div class="card"><div class="n">'+c[1]+'</div><div class="l">'+c[0]+'</div></div>').join('');
    $('#evbar').innerHTML=ov.byEvent.map(e=>'<span class="ev"><b>'+e.count+'</b> '+esc(e.event)+'</span>').join('');
    $('#empty').style.display=ps.length?'none':'block';
    $('#rows').innerHTML=ps.map(p=>{
      const who=p.userId?'<span class="idn">'+esc(p.userId)+'</span>':'<span class="anon">аноним</span>';
      const ch=p.events.slice(0,4).map(e=>'<span class="chip">'+esc(e.event)+'·'+e.count+'</span>').join('');
      return '<tr onclick=\\'openP("'+esc(p.id)+'")\\'>'
        +'<td class="id">'+esc(p.id.slice(0,12))+'…</td><td>'+who+'</td>'
        +'<td>'+p.count+'</td><td class="muted">'+fmt(p.firstSeen)+'</td><td class="muted">'+fmt(p.lastSeen)+'</td>'
        +'<td class="muted">'+dev(p.ua)+' '+esc(p.ip||'—')+'</td><td><div class="chips">'+ch+'</div></td></tr>';
    }).join('');
  }catch(e){showErr(e)}
}
async function openP(id){
  const d=$('#drawer'); d.classList.add('open');
  $('#dtitle').textContent=id.slice(0,18)+'…'; $('#tl').innerHTML='<div class="empty">Загрузка…</div>';
  try{
    const evs=await j('/api/profile?tenant='+TENANT+'&id='+encodeURIComponent(id));
    $('#tl').innerHTML=evs.map(e=>{
      const pr=e.properties?Object.entries(e.properties).filter(([k])=>k!=='referrer').map(([k,v])=>k+': '+(typeof v==='object'?JSON.stringify(v):v)).join(' · '):'';
      return '<div class="tli"><div class="t">'+fmt(e.ts)+'</div><div class="e">'+esc(e.event||e.type)+'</div><div class="d">'+esc(pr)+'</div></div>';
    }).join('')||'<div class="empty">Нет событий</div>';
  }catch(e){$('#tl').innerHTML='<div class="err">'+esc(e.message||e)+'</div>'}
}
function closeDrawer(){$('#drawer').classList.remove('open')}
$('#tenant').onchange=load; $('#refresh').onclick=load;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});
init();
</script></body></html>`;
