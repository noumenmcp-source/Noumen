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

function makeDeps(env = process.env) {
  return {
    fetchImpl: globalThis.fetch,
    consentUrl: env.CONSENT_LEDGER_URL || 'http://consent-ledger:8140',
    consentToken: env.CONSENT_API_TOKEN || '',
    apiToken: env.AUTOMATION_API_TOKEN || '',
    port: parseInt(env.PORT || '8170', 10),
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
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return send(res, 200, { status: 'ok', consentUrl: deps.consentUrl });
      }
      if (deps.apiToken && (req.headers.authorization || '') !== `Bearer ${deps.apiToken}`) {
        return send(res, 401, { error: 'unauthorized' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/automation/run') {
        const body = await readBody(req).catch(() => ({}));
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
  createServer(deps).listen(deps.port, '0.0.0.0', () => console.log(`automation up on :${deps.port} consent=${deps.consentUrl}`));
}

if (require.main === module) main();

module.exports = { makeDeps, runScenario, createServer };
