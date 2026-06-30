'use strict';
/**
 * RF CDP email-ai worker + API.
 *
 * Composes 152-ФЗ-compliant AI marketing emails for a lifecycle trigger:
 * pulls profiles from the profile-engine, applies the marketing-consent gate
 * against the consent-ledger, generates RU copy (Flot LLM, deterministic
 * fallback), enforces the «О рекламе» footer. Delivery is Dittofeed's job — the
 * verified path here is preview/dry-run; real send is a follow-up.
 */
const http = require('node:http');
const { TemplateGenerator, AiGatewayGenerator } = require('./lib/generators');
const { FakeSender } = require('./lib/senders');
const { runCampaign } = require('./lib/campaign');
const { listProfiles } = require('./lib/profiles-client');
const { marketingAllowed } = require('./lib/consent-client');
const { EMAIL_TRIGGERS } = require('./lib/types');
const observe = require('./lib/observe');
const tenantAuth = require('./lib/tenant-auth');
const ratelimit = require('./lib/ratelimit');

// Known route patterns, for bounded /metrics cardinality.
const ROUTES = [
  '/v1/health', '/v1/live', '/v1/ready', '/metrics', '/v1/auth/introspect',
  '/v1/campaign/preview', '/v1/campaign/send',
];

function makeDeps(env = process.env) {
  return {
    fetchImpl: globalThis.fetch,
    profilesUrl: env.PROFILE_ENGINE_URL || 'http://profile-engine:8130',
    consentUrl: env.CONSENT_LEDGER_URL || 'http://consent-ledger:8140',
    profileToken: env.PROFILE_API_TOKEN || '',
    consentToken: env.CONSENT_API_TOKEN || '',
    aiUrl: env.AI_GATEWAY_URL || '',
    aiKey: env.AI_GATEWAY_API_KEY || '',
    aiModel: env.AI_GATEWAY_MODEL || 'gpt-5.5',
    apiToken: env.EMAIL_API_TOKEN || '',
    authz: tenantAuth.makeAuthorizer({
      adminToken: env.EMAIL_API_TOKEN || '',
      tenantTokens: env.EMAIL_TENANT_TOKENS || '',
      revokedTokens: env.EMAIL_REVOKED_TOKENS || '',
      adminExp: env.EMAIL_API_TOKEN_EXP || '',
      log: (m) => console.warn(m),
    }),
    limiter: ratelimit.createLimiter({
      capacity: parseInt(env.EMAIL_RATE_CAPACITY || '0', 10),
      refillPerSec: parseFloat(env.EMAIL_RATE_REFILL_PER_SEC || '0'),
    }),
    port: parseInt(env.PORT || '8150', 10),
    metrics: observe.createMetrics('email-ai'),
    // Ready iff both upstreams (profile-engine, consent-ledger) are reachable.
    ready: () => observe.checkAll([
      { name: 'profile-engine', check: () => observe.pingHttp(globalThis.fetch, `${env.PROFILE_ENGINE_URL || 'http://profile-engine:8130'}/v1/health`) },
      { name: 'consent-ledger', check: () => observe.pingHttp(globalThis.fetch, `${env.CONSENT_LEDGER_URL || 'http://consent-ledger:8140'}/v1/health`) },
    ]),
  };
}

/** Dry-run a campaign: select -> consent gate -> generate -> 152-ФЗ footer. */
async function previewCampaign(deps, body) {
  const required = ['site', 'trigger', 'brandName', 'from', 'operator', 'unsubscribeUrl'];
  for (const k of required) {
    if (!body || !body[k]) return { status: 400, error: `${k} required` };
  }
  if (!EMAIL_TRIGGERS.includes(body.trigger)) {
    return { status: 400, error: `trigger must be one of: ${EMAIL_TRIGGERS.join(', ')}` };
  }
  const profiles = await listProfiles(deps, body.site);
  const useAi = body.useAi === true && !!deps.aiUrl;
  const generator = useAi
    ? new AiGatewayGenerator({ url: deps.aiUrl, apiKey: deps.aiKey, model: deps.aiModel })
    : new TemplateGenerator();
  const sender = new FakeSender();

  const res = await runCampaign({
    profiles, trigger: body.trigger, from: body.from, brandName: body.brandName,
    productName: body.productName, ctaUrl: body.ctaUrl,
    generator, sender,
    compliance: { operator: body.operator, unsubscribeUrl: body.unsubscribeUrl },
    consentCheck: (subject) => marketingAllowed(deps, body.site, subject),
  });

  return {
    status: 200,
    dryRun: true,
    site: body.site,
    trigger: body.trigger,
    generator: generator.constructor.name,
    profiles: profiles.length,
    selected: res.selected,
    sent: res.sent,
    skippedNoConsent: res.skippedNoConsent,
    sample: res.results.slice(0, 3).map((r) => ({ to: r.email, subject: r.subject, html: r.html })),
  };
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
        return send(res, 200, { status: 'ok', profilesUrl: deps.profilesUrl, consentUrl: deps.consentUrl, ai: !!deps.aiUrl });
      }
      const auth = deps.authz.authenticate(req.headers.authorization);
      if (!auth.ok) return send(res, auth.code, { error: auth.error });
      // Per-tenant isolation: a scoped token may only run campaigns for its site.
      const guard = (s) => {
        const g = tenantAuth.checkSite(auth, s);
        if (!g.ok) { send(res, g.code, { error: g.error }); return false; }
        return true;
      };

      // Per-tenant rate limiting (token-bucket; no-op unless configured).
      const rlKey = auth.sites ? [...auth.sites].join(',') : (auth.kind === 'admin' ? 'admin' : (req.socket.remoteAddress || 'anon'));
      if (ratelimit.enforce(res, deps.limiter, rlKey)) return;

      // Admin-only token introspection (auth-hardening parity with US).
      if (req.method === 'POST' && url.pathname === '/v1/auth/introspect') {
        if (auth.kind !== 'admin') return send(res, 403, { error: 'admin token required' });
        const ib = await readBody(req).catch(() => ({}));
        return send(res, 200, deps.authz.introspect(ib.token));
      }

      if (req.method === 'POST' && url.pathname === '/v1/campaign/preview') {
        const body = await readBody(req).catch(() => ({}));
        if (!guard(body.site)) return;
        const out = await previewCampaign(deps, body);
        const { status, ...rest } = out;
        return send(res, status, rest);
      }
      if (req.method === 'POST' && url.pathname === '/v1/campaign/send') {
        return send(res, 501, { error: 'delivery via Dittofeed not wired yet; use /v1/campaign/preview (dry-run)' });
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
  server.listen(deps.port, '0.0.0.0', () => {
    console.log(`email-ai up on :${deps.port} profiles=${deps.profilesUrl} consent=${deps.consentUrl} ai=${!!deps.aiUrl}`);
  });
  observe.installGraceful({ server, log: (m) => console.log(m) });
}

if (require.main === module) main();

module.exports = { makeDeps, previewCampaign, createServer };
