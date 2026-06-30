'use strict';
/**
 * RF CDP social-intel worker + analysis API (self-contained, deterministic).
 * Live collection (provider API keys, RF source choice) is a follow-up; this
 * exposes the normalize/intent + YouTube parse/comment/ideas engine over HTTP.
 */
const http = require('node:http');
const { normalizeAll } = require('./lib/normalize');
const { analyzeIntent, DEFAULT_INTENT_TOPICS } = require('./lib/analyze');
const { parseSearchResponse } = require('./lib/youtube/parse');
const { analyzeComments, extractContentIdeas } = require('./lib/youtube/analyze');
const observe = require('./lib/observe');
const ratelimit = require('./lib/ratelimit');
const errsink = require('./lib/errsink');

// Known route patterns, for bounded /metrics cardinality.
const ROUTES = [
  '/v1/health', '/v1/live', '/v1/ready', '/metrics',
  '/v1/social/analyze', '/v1/social/youtube/parse',
  '/v1/social/youtube/comments', '/v1/social/youtube/ideas',
];

function makeDeps(env = process.env) {
  return {
    apiToken: env.SOCIAL_API_TOKEN || '',
    port: parseInt(env.PORT || '8160', 10),
    metrics: observe.createMetrics('social-intel'),
    // Self-contained/deterministic engine: no external deps, ready when live.
    ready: () => observe.checkAll([]),
    // Stateless compute — rate-limit by client address to protect CPU (off unless set).
    limiter: ratelimit.createLimiter({
      capacity: parseInt(env.SOCIAL_RATE_CAPACITY || '0', 10),
      refillPerSec: parseFloat(env.SOCIAL_RATE_REFILL_PER_SEC || '0'),
    }),
    errsink: errsink.createSink({ service: 'social-intel', dsn: env.SENTRY_DSN || '', release: env.RELEASE || '', environment: env.DEPLOY_ENV || 'production' }),
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
        return send(res, 200, { status: 'ok', topics: Object.keys(DEFAULT_INTENT_TOPICS) });
      }
      if (deps.apiToken && (req.headers.authorization || '') !== `Bearer ${deps.apiToken}`) {
        return send(res, 401, { error: 'unauthorized' });
      }
      // Rate limiting by client address (token-bucket; no-op unless configured).
      if (ratelimit.enforce(res, deps.limiter, req.socket.remoteAddress || 'anon')) return;

      if (req.method === 'POST' && url.pathname === '/v1/social/analyze') {
        const b = await readBody(req).catch(() => ({}));
        if (!Array.isArray(b.items)) return send(res, 400, { error: 'items[] required' });
        let signals;
        try { signals = normalizeAll(b.items, b.platform); }
        catch (e) { return send(res, 400, { error: String((e && e.message) || e) }); }
        const intent = analyzeIntent(b.site || 'default', signals, b.topics ? { topics: b.topics } : {});
        return send(res, 200, { site: b.site || 'default', signals: signals.length, intent });
      }
      if (req.method === 'POST' && url.pathname === '/v1/social/youtube/parse') {
        const b = await readBody(req).catch(() => ({}));
        const videos = parseSearchResponse(b.searchResponse);
        return send(res, 200, { count: videos.length, videos });
      }
      if (req.method === 'POST' && url.pathname === '/v1/social/youtube/comments') {
        const b = await readBody(req).catch(() => ({}));
        if (!Array.isArray(b.comments)) return send(res, 400, { error: 'comments[] required' });
        return send(res, 200, analyzeComments(b.comments, { maxTopics: b.maxTopics }));
      }
      if (req.method === 'POST' && url.pathname === '/v1/social/youtube/ideas') {
        const b = await readBody(req).catch(() => ({}));
        const ideas = extractContentIdeas(b.videos || [], b.topics || [], { maxIdeas: b.maxIdeas });
        return send(res, 200, { count: ideas.length, ideas });
      }
      send(res, 404, { error: 'no route' });
    } catch (e) {
      if (deps.errsink) deps.errsink.capture(e, { method: req.method, path: req.url });
      send(res, 500, { error: String((e && e.message) || e) });
    }
  });
}

function main() {
  const deps = makeDeps();
  const server = createServer(deps);
  server.listen(deps.port, '0.0.0.0', () => console.log(`social-intel up on :${deps.port}`));
  observe.installGraceful({ server, log: (m) => console.log(m) });
}

if (require.main === module) main();

module.exports = { makeDeps, createServer };
