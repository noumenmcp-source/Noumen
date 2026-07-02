'use strict';
/**
 * us-console tests: minimal regression guard for the nested-escaping class of bug
 * (a single-backslash-escaped apostrophe inside the outer template literal collapses
 * during Node's own evaluation, so the browser gets a bare quote mid-string and the
 * ENTIRE client <script> fails to parse — curl-only checks never catch this since
 * curl never parses JS). See rf-console's incident write-up for the full story.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { server } = require('../server');

test('client <script> served to the browser is syntactically valid JS', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(`${base}/`)).text();
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m, 'page must contain a <script> block');
    assert.doesNotThrow(() => new Function(m[1]), 'client script must parse as valid JS');
  } finally { server.close(); await once(server, 'close'); }
});

test('HTTP: / serves the Axiom console shell; /api/config is auth-gated', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /<title>Axiom/);
    const cfg = await fetch(`${base}/api/config`);
    assert.equal(cfg.status, 401, '/api/config must require a Bearer token');
  } finally { server.close(); await once(server, 'close'); }
});
