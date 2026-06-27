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
    port: parseInt(env.PORT || '8150', 10),
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
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return send(res, 200, { status: 'ok', profilesUrl: deps.profilesUrl, consentUrl: deps.consentUrl, ai: !!deps.aiUrl });
      }
      if (deps.apiToken && (req.headers.authorization || '') !== `Bearer ${deps.apiToken}`) {
        return send(res, 401, { error: 'unauthorized' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/campaign/preview') {
        const body = await readBody(req).catch(() => ({}));
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
  createServer(deps).listen(deps.port, '0.0.0.0', () => {
    console.log(`email-ai up on :${deps.port} profiles=${deps.profilesUrl} consent=${deps.consentUrl} ai=${!!deps.aiUrl}`);
  });
}

if (require.main === module) main();

module.exports = { makeDeps, previewCampaign, createServer };
