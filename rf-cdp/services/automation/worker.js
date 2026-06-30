'use strict';
/**
 * RF CDP automation worker + API. Runs automation scenarios (social posts +
 * messenger sends) through in-memory adapters as a DRY-RUN, enforcing the
 * 152-ФЗ marketing-messaging consent gate against the consent-ledger. Real
 * Telegram/VK delivery adapters are a follow-up.
 */
const http = require('node:http');
const { Orchestrator } = require('./lib/orchestrator');
const { InMemorySocialAdapter, InMemoryMessengerAdapter } = require('./lib/adapters');
const { messagingAllowed } = require('./lib/consent-client');
const observe = require('./lib/observe');
const tenantAuth = require('./lib/tenant-auth');

// Known route patterns, for bounded /metrics cardinality.
const ROUTES = ['/v1/health', '/v1/live', '/v1/ready', '/metrics', '/v1/automation/run'];

function makeDeps(env = process.env) {
  const consentUrl = env.CONSENT_LEDGER_URL || 'http://consent-ledger:8140';
  return {
    fetchImpl: globalThis.fetch,
    consentUrl,
    consentToken: env.CONSENT_API_TOKEN || '',
    apiToken: env.AUTOMATION_API_TOKEN || '',
    authz: tenantAuth.makeAuthorizer({
      adminToken: env.AUTOMATION_API_TOKEN || '',
      tenantTokens: env.AUTOMATION_TENANT_TOKENS || '',
      log: (m) => console.warn(m),
    }),
    port: parseInt(env.PORT || '8170', 10),
    metrics: observe.createMetrics('automation'),
    // Ready iff the consent-ledger (the 152-ФЗ gate dependency) is reachable.
    ready: () => observe.checkAll([
      { name: 'consent-ledger', check: () => observe.pingHttp(globalThis.fetch, `${consentUrl}/v1/health`) },
    ]),
  };
}

async function runScenario(deps, body) {
  if (!body || !Array.isArray(body.steps)) return { status: 400, error: 'steps[] required' };
  const site = body.site || 'default';
  const social = new InMemorySocialAdapter();
  const messenger = new InMemoryMessengerAdapter();
  const results = await new Orchestrator().runScenario(body.steps, {
    social, messenger,
    consentCheck: (to) => messagingAllowed(deps, site, to),
  });
  const sent = results.filter((r) => r.status === 'sent').length;
  const posted = results.filter((r) => r.status === 'posted').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return { status: 200, dryRun: true, site, summary: { posted, sent, skipped }, results, posts: social.posts, messages: messenger.sent };
}

function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function createServer(deps) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://internal');
      observe.instrument(req, res, { metrics: deps.metrics, pathname: url.pathname, routes: ROUTES });

      // Liveness/readiness/metrics — unauthenticated, like /v1/health below.
      if (await observe.handleObservability(req, res, { pathname: url.pathname, metrics: deps.metrics, ready: deps.ready })) return;

      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return send(res, 200, { status: 'ok', consentUrl: deps.consentUrl });
      }
      const auth = deps.authz.authenticate(req.headers.authorization);
      if (!auth.ok) return send(res, auth.code, { error: auth.error });
      // Per-tenant isolation: a scoped token may only run scenarios for its site.
      const guard = (s) => {
        const g = tenantAuth.checkSite(auth, s);
        if (!g.ok) { send(res, g.code, { error: g.error }); return false; }
        return true;
      };

      if (req.method === 'POST' && url.pathname === '/v1/automation/run') {
        const body = await readBody(req).catch(() => ({}));
        // Mirror runScenario's site resolution (body.site || 'default') for the guard.
        if (!guard(body.site || 'default')) return;
        const out = await runScenario(deps, body);
        const { status, ...rest } = out;
        return send(res, status, rest);
      }
      send(res, 404, { error: 'no route' });
    } catch (e) {
      send(res, 500, { error: String((e && e.message) || e) });
    }
  });
}

function main() {
  const deps = makeDeps();
  const server = createServer(deps);
  server.listen(deps.port, '0.0.0.0', () => console.log(`automation up on :${deps.port} consent=${deps.consentUrl}`));
  observe.installGraceful({ server, log: (m) => console.log(m) });
}

if (require.main === module) main();

module.exports = { makeDeps, runScenario, createServer };
