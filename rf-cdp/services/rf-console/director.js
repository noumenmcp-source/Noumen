'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Директорская консоль AERO (§10.1) — тенант на rf-console, НО данные из crm-postgres
// (aero_crm), а не из ES. Изолированный модуль: server.js только require + одна строка
// диспатча на /aero-director*. Живые ES-консоли (zavod/aero-CDP/AXIOM) не затрагиваются.
//
// §6.9: 2FA (пароль + TOTP) → директорская сессия (scope=director, TTL 15м) → БД читается
// РОЛЬЮ app_director (SET LOCAL ROLE + app.partner_id, RLS не отключается). Каждое чтение и
// логин → access_audit. Новый fingerprint устройства → ограниченный просмотр + алерт владельцу.
//
// Advice-слой (north-star AXIOM): каждая карточка = метрика + объяснение + рекомендация,
// не голый график.
const crypto = require('crypto');

const AERO_PARTNER = 'a0000000-0000-4000-8000-000000000001';
const DIRECTOR_SESSION_TTL_MS = 15 * 60 * 1000; // §6.9 короткий TTL
const SLA_MINUTES = parseInt(process.env.CRM_SLA_MINUTES || '90', 10);

const SESSION_SECRET = process.env.DIRECTOR_SESSION_SECRET
  || (function () { console.warn('DIRECTOR_SESSION_SECRET не задан — небезопасный дефолт'); return 'insecure-director-secret'; })();

let pool = null;
function getPool() {
  if (!pool) {
    const url = process.env.CRM_DIRECTOR_DB_URL;
    if (!url) throw new Error('CRM_DIRECTOR_DB_URL не задан');
    const { Pool } = require('pg'); // ленивая загрузка — чистые функции модуля работают без pg
    pool = new Pool({ connectionString: url, max: 4 });
  }
  return pool;
}

// ─── БД под ролью app_director (read-only, RLS по app.partner_id=AERO) ────────
async function withDirector(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_director');
    await client.query("SELECT set_config('app.partner_id', $1, true)", [AERO_PARTNER]);
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function audit(client, action, detail) {
  await client.query(
    "INSERT INTO access_audit(actor_role, action, partner_id, detail) VALUES('app_director',$1,$2,$3)",
    [action, AERO_PARTNER, JSON.stringify(detail || {})],
  );
}

// ─── HTTP helpers (модуль самодостаточен, не тянет из server.js) ──────────────
function send(res, code, data, type) {
  if (type === 'html') { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); return res.end(data); }
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// ─── Пароль: scrypt salt:hash ────────────────────────────────────────────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384 });
  return salt.toString('hex') + ':' + h.toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [saltHex, hHex] = String(stored).split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hHex, 'hex');
    const actual = crypto.scryptSync(String(pw), salt, expected.length, { N: 16384 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (e) { return false; }
}

// ─── TOTP (RFC 6238, SHA1, 6 цифр, шаг 30с, окно ±1) ─────────────────────────
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  const clean = String(s).toUpperCase().replace(/=+$/,'').replace(/\s/g,'');
  for (const ch of clean) { const v = A.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | (hmac[off + 3]);
  return String(code % 1000000).padStart(6, '0');
}
function totpVerify(secretBase32, token, now) {
  const t = Math.floor((now || Date.now()) / 1000 / 30);
  const clean = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (let w = -1; w <= 1; w++) {
    const cand = totpAt(secretBase32, t + w);
    const a = Buffer.from(cand), b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// ─── Директорская сессия (HMAC, scope=director, привязка к fingerprint) ───────
function fingerprint(req, deviceId) {
  const ua = String(req.headers['user-agent'] || '');
  return crypto.createHash('sha256').update(ua + '|' + String(deviceId || '')).digest('hex').slice(0, 32);
}
function signDirectorSession(fp) {
  const payload = { p: AERO_PARTNER, scope: 'director', fp: fp, exp: Date.now() + DIRECTOR_SESSION_TTL_MS };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return 'dsess_' + b64 + '.' + sig;
}
function verifyDirectorSession(token, fp) {
  if (!token || token.indexOf('dsess_') !== 0) return null;
  const parts = token.slice(6).split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('base64url');
  try {
    const a = Buffer.from(expected), b = Buffer.from(parts[1]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (payload.scope !== 'director' || !payload.exp || payload.exp < Date.now()) return null;
    if (fp && payload.fp !== fp) return null; // сессия привязана к устройству
    return payload;
  } catch (e) { return null; }
}

// брутфорс-защита логина (в памяти)
const attempts = new Map();
function rateLimited() { const r = attempts.get('d'); return r && Date.now() < r.until && r.n >= 5; }
function recordFail() { const r = attempts.get('d'); if (!r || Date.now() > r.until) attempts.set('d', { n: 1, until: Date.now() + 15 * 60000 }); else r.n++; }
function clearFails() { attempts.delete('d'); }

// ─── Advice-метрики: чтение + правила ────────────────────────────────────────
async function loadOverview() {
  return withDirector(async (c) => {
    const byStage = (await c.query(
      `SELECT status::text AS stage, count(*)::int AS n FROM deal GROUP BY status`)).rows;
    const totals = (await c.query(
      `SELECT
         (SELECT count(*) FROM deal) AS deals,
         (SELECT count(*) FROM deal WHERE created_at > now()-interval '7 days') AS new7,
         (SELECT count(*) FROM message m JOIN conversation cv ON cv.conversation_id=m.conversation_id
            WHERE m.direction='inbound' AND cv.is_internal=false) AS msg_in,
         (SELECT count(*) FROM message m JOIN conversation cv ON cv.conversation_id=m.conversation_id
            WHERE m.direction='outbound_manual' AND cv.is_internal=false) AS msg_out,
         (SELECT count(*) FROM partner_referral_source) AS referrals,
         (SELECT coalesce(sum(CASE WHEN kind='refund' THEN -amount ELSE amount END),0)
            FROM payment_transaction WHERE occurred_at > now()-interval '30 days') AS rev30`)).rows[0];
    // неотвеченные: беседы с inbound новее последнего ответа менеджера. is_internal=false — рабочие
    // диалоги (коллеги/партнёры) не клиенты, директору их "неотвеченность" ни к чему (найдено
    // живым анализом переписки — рабочий чат считался наравне с клиентами).
    const unanswered = (await c.query(
      `SELECT count(*)::int AS n FROM conversation cv
        WHERE cv.is_internal=false
          AND EXISTS (SELECT 1 FROM message mi WHERE mi.conversation_id=cv.conversation_id AND mi.direction='inbound'
                        AND mi.sent_at > coalesce((SELECT max(mo.sent_at) FROM message mo
                              WHERE mo.conversation_id=cv.conversation_id AND mo.direction='outbound_manual'), '-infinity'::timestamptz))`)).rows[0].n;
    await audit(c, 'director_read', { view: 'overview' });
    return {
      deals: Number(totals.deals), new7: Number(totals.new7),
      msgIn: Number(totals.msg_in), msgOut: Number(totals.msg_out),
      referrals: Number(totals.referrals), rev30: Number(totals.rev30),
      unanswered: Number(unanswered), byStage,
    };
  });
}

// метрика + объяснение + рекомендация (north-star)
function computeAdvice(d) {
  const cards = [];
  cards.push({
    title: 'Необработанные обращения',
    metric: String(d.unanswered),
    tone: d.unanswered > 0 ? 'alert' : 'ok',
    explanation: d.unanswered > 0
      ? `${d.unanswered} диалог(ов), где клиент написал последним и ждёт ответа менеджера.`
      : 'Все входящие обращения отвечены — очередь пуста.',
    recommendation: d.unanswered > 0
      ? `Ответьте сейчас: порог реакции — ${SLA_MINUTES} раб.мин, каждый час простоя роняет конверсию лида.`
      : 'Держите темп: быстрый первый ответ — сильнейший драйвер конверсии в этой нише.',
  });
  cards.push({
    title: 'Новые лиды за 7 дней',
    metric: String(d.new7),
    tone: d.new7 === 0 ? 'warn' : 'ok',
    explanation: d.new7 === 0
      ? 'За неделю не создано ни одной сделки.'
      : `${d.new7} новых сделок за неделю.`,
    recommendation: d.new7 === 0
      ? 'Проверьте трафик и источники: если посетители есть, а лидов нет — узкое место в форме/цене (гипотеза владельца: убрать «от» из прайса).'
      : 'Сверьте источники лидов с «Базой Катерины» — усильте канал, дающий платящих, а не просто клики.',
  });
  const stages = (d.byStage || []).slice().sort((a, b) => b.n - a.n);
  const top = stages[0];
  cards.push({
    title: 'Воронка сделок',
    metric: String(d.deals),
    tone: 'ok',
    explanation: d.deals === 0
      ? 'Сделок пока нет — данные появятся, как только пойдут диалоги и заявки.'
      : 'Распределение сделок по этапам: ' + stages.map((s) => `${s.stage}=${s.n}`).join(', ') + '.',
    recommendation: d.deals === 0
      ? 'Подключите приём лидов (/leads с сайта уже проброшен) и Telegram — воронка наполнится автоматически.'
      : (top ? `Больше всего сделок на этапе «${top.stage}» — разберите, что мешает им двигаться дальше.` : '—'),
  });
  cards.push({
    title: 'Выручка за 30 дней',
    metric: d.rev30.toLocaleString('ru-RU') + ' ₽',
    tone: 'ok',
    explanation: d.rev30 === 0 ? 'Оплат за месяц не зафиксировано в CRM.' : `Сумма подтверждённых оплат за 30 дней.`,
    recommendation: 'Свяжите выручку с источником атрибуции (сделка→реферал) — так видно, какой канал реально приносит деньги, а не клики.',
  });
  cards.push({
    title: 'Диалоги (вход/исход)',
    metric: `${d.msgIn} / ${d.msgOut}`,
    tone: 'ok',
    explanation: `Входящих от клиентов: ${d.msgIn}, ответов менеджера: ${d.msgOut}. База рефералов «Катерины»: ${d.referrals}.`,
    recommendation: d.msgIn > 0 && d.msgOut === 0
      ? 'Клиенты пишут, но ответов в CRM нет — проверьте, что менеджер отвечает через рабочий аккаунт (перехват включён).'
      : 'Анализируйте переписку на частые вопросы → выносите в базу знаний, сокращая время ответа.',
  });
  return cards;
}

// ─── HTML ────────────────────────────────────────────────────────────────────
const LOGIN_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AERO · Директор</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0e1116;color:#e6edf3;min-height:100vh;display:grid;place-items:center}
.card{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:28px;width:min(92vw,360px)}
h1{font-size:19px;margin:0 0 4px}.sub{color:#8b949e;font-size:13px;margin:0 0 20px}
label{display:block;font-size:12px;color:#8b949e;margin:14px 0 5px}
input{width:100%;padding:11px 12px;border:1px solid #30363d;border-radius:9px;background:#0d1117;color:#e6edf3;font-size:15px}
input:focus{outline:none;border-color:#2f81f7}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:9px;background:#2f81f7;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:disabled{opacity:.5}.err{color:#f85149;font-size:13px;margin-top:12px;min-height:18px}
.totp input{letter-spacing:6px;text-align:center;font-size:20px}
</style></head><body>
<form class="card" id="f">
<h1>AERO · Панель директора</h1><p class="sub">Вход по паролю и одноразовому коду (2FA)</p>
<label>Пароль</label><input id="pw" type="password" autocomplete="current-password" required>
<div class="totp"><label>Код из приложения-аутентификатора</label><input id="totp" inputmode="numeric" pattern="\\d{6}" maxlength="6" placeholder="000000" required></div>
<button id="btn" type="submit">Войти</button><div class="err" id="err"></div>
</form>
<script>
function devId(){let d=localStorage.getItem('aero_dev_id');if(!d){d=crypto.randomUUID();localStorage.setItem('aero_dev_id',d)}return d}
document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
 var btn=document.getElementById('btn'),err=document.getElementById('err');btn.disabled=true;err.textContent='';
 try{var r=await fetch('/aero-director/api/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({password:document.getElementById('pw').value,totp:document.getElementById('totp').value,deviceId:devId()})});
  var j=await r.json();
  if(!r.ok){err.textContent=j.error==='rate_limited'?'Слишком много попыток, подождите 15 минут':(j.error==='invalid_credentials'?'Неверный пароль или код':'Ошибка входа');btn.disabled=false;return}
  localStorage.setItem('aero_dsess',j.session);location.href='/aero-director';
 }catch(_){err.textContent='Сеть недоступна';btn.disabled=false}});
</script></body></html>`;

function dashboardHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AERO · Директор</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0e1116;color:#e6edf3}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #21262d}
header b{font-size:16px}header .t{color:#8b949e;font-size:12px}
.wrap{max-width:1040px;margin:0 auto;padding:22px}
.new-dev{background:#3d1d00;border:1px solid #9e6a00;color:#ffd8a8;padding:10px 14px;border-radius:9px;font-size:13px;margin-bottom:16px;display:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.c{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:18px}
.c.alert{border-color:#8e2a2a}.c.warn{border-color:#9e6a00}
.c h3{margin:0 0 8px;font-size:13px;color:#8b949e;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.c .m{font-size:30px;font-weight:700;margin:0 0 10px}
.c.alert .m{color:#ff7b72}.c.warn .m{color:#ffce6b}.c.ok .m{color:#7ee787}
.c .e{font-size:13px;color:#c9d1d9;margin:0 0 10px}
.c .r{font-size:13px;color:#e6edf3;background:#0d1117;border-left:3px solid #2f81f7;padding:9px 11px;border-radius:0 8px 8px 0}
.c .r b{color:#79c0ff}
button.lo{background:none;border:1px solid #30363d;color:#8b949e;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}
.load{color:#8b949e;padding:40px;text-align:center}
</style></head><body>
<header><b>AERO · Панель директора</b><span style="display:flex;gap:14px;align-items:center"><span class="t" id="ts"></span><button class="lo" onclick="localStorage.removeItem('aero_dsess');location.href='/aero-director'">Выйти</button></span></header>
<div class="wrap">
<div class="new-dev" id="nd">⚠️ Вход с нового устройства — доступ ограничен, владельцу отправлен алерт.</div>
<div id="root" class="load">Загрузка…</div>
</div>
<script>
var s=localStorage.getItem('aero_dsess');if(!s){location.href='/aero-director?login=1'}
function esc(x){return String(x).replace(/[&<>]/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[m]})}
fetch('/aero-director/api/overview',{headers:{authorization:'Bearer '+s}}).then(function(r){
 if(r.status===401){localStorage.removeItem('aero_dsess');location.href='/aero-director?login=1';return null}return r.json()
}).then(function(j){ if(!j)return;
 if(j.newDevice)document.getElementById('nd').style.display='block';
 document.getElementById('ts').textContent='обновлено '+new Date().toLocaleString('ru-RU');
 var html=j.cards.map(function(c){return '<div class="c '+c.tone+'"><h3>'+esc(c.title)+'</h3><div class="m">'+esc(c.metric)+'</div><div class="e">'+esc(c.explanation)+'</div><div class="r"><b>Что делать:</b> '+esc(c.recommendation)+'</div></div>'}).join('');
 document.getElementById('root').className='grid';document.getElementById('root').innerHTML=html;
}).catch(function(){document.getElementById('root').textContent='Ошибка загрузки'});
</script></body></html>`;
}

// ─── Роутер модуля ────────────────────────────────────────────────────────────
async function handle(req, res, p, u, ctx) {
  // страница
  if (p === '/aero-director' && req.method === 'GET') {
    if (u.searchParams.get('login') === '1') { send(res, 200, LOGIN_HTML, 'html'); return true; }
    send(res, 200, dashboardHtml(), 'html'); return true; // сам дашборд решит: нет сессии → на login
  }
  if (p === '/aero-director/login' && req.method === 'GET') { send(res, 200, LOGIN_HTML, 'html'); return true; }

  // логин: пароль + TOTP → директорская сессия
  if (p === '/aero-director/api/login' && req.method === 'POST') {
    let body; try { body = await readJsonBody(req, 2048); } catch (e) { send(res, 400, { error: 'bad_request' }); return true; }
    if (rateLimited()) { send(res, 429, { error: 'rate_limited' }); return true; }
    try {
      const row = await withDirector((c) => c.query('SELECT password_hash, totp_secret FROM director_auth WHERE partner_id=$1', [AERO_PARTNER]).then((r) => r.rows[0]));
      if (!row || !verifyPassword(body.password, row.password_hash) || !totpVerify(row.totp_secret, body.totp)) {
        recordFail(); send(res, 401, { error: 'invalid_credentials' }); return true;
      }
      clearFails();
      const fp = fingerprint(req, body.deviceId);
      let newDevice = false;
      await withDirector(async (c) => {
        const seen = await c.query('SELECT 1 FROM director_trusted_device WHERE partner_id=$1 AND fingerprint=$2', [AERO_PARTNER, fp]);
        if (seen.rowCount === 0) {
          newDevice = true;
          await c.query('INSERT INTO director_trusted_device(partner_id,fingerprint) VALUES($1,$2) ON CONFLICT DO NOTHING', [AERO_PARTNER, fp]);
          // §6.10 — новое устройство директора тоже несёт SLA 24/72ч дисциплину реакции, не только
          // dry-run алерт. security_incidents живёт в CRM-схеме (0029), app_director имеет INSERT.
          await c.query(
            "INSERT INTO security_incidents (partner_id, kind, detail) VALUES ($1,'new_device',$2)",
            [AERO_PARTNER, JSON.stringify({ fingerprint: fp, ua: req.headers['user-agent'] || null })],
          );
        } else {
          await c.query('UPDATE director_trusted_device SET last_seen=now() WHERE partner_id=$1 AND fingerprint=$2', [AERO_PARTNER, fp]);
        }
        await audit(c, 'director_login', { newDevice });
      });
      if (newDevice && ctx && typeof ctx.sendTelegramMessage === 'function' && process.env.CRM_PULSE_CHAT_ID && process.env.CRM_PULSE_CHAT_ID !== '0') {
        ctx.sendTelegramMessage({ chatId: process.env.CRM_PULSE_CHAT_ID, text: '🔐 Вход в панель директора AERO с НОВОГО устройства' }).catch(() => {});
      }
      send(res, 200, { ok: true, session: signDirectorSession(fp), newDevice }); return true;
    } catch (e) { send(res, 500, { error: 'server_error', detail: String(e.message || e) }); return true; }
  }

  // данные дашборда (advice) — только с валидной директорской сессией
  if (p === '/aero-director/api/overview' && req.method === 'GET') {
    const auth = String(req.headers['authorization'] || '');
    const m = /^Bearer\s+(dsess_.+)$/.exec(auth);
    const sess = m ? verifyDirectorSession(m[1], null) : null; // fp-привязку не требуем на чтении (сессия уже подписана)
    if (!sess) { send(res, 401, { error: 'unauthorized' }); return true; }
    try {
      const data = await loadOverview();
      send(res, 200, { cards: computeAdvice(data), raw: data });
      return true;
    } catch (e) { send(res, 500, { error: 'server_error', detail: String(e.message || e) }); return true; }
  }

  return false; // не наш путь
}

module.exports = { handle, hashPassword, verifyPassword, totpAt, totpVerify, base32Decode, _AERO_PARTNER: AERO_PARTNER };
