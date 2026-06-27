'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enforce152fz } = require('../lib/compliance');

const opts = { operator: 'ООО «Завод», ИНН 7700000000, info@zavod.dev', unsubscribeUrl: 'https://zavod.dev/unsub?t=x' };

test('appends operator identification + unsubscribe footer', () => {
  const out = enforce152fz('<p>Текст</p>', opts);
  assert.match(out, /ООО «Завод», ИНН 7700000000/);
  assert.match(out, /Отписаться/);
  assert.match(out, /https:\/\/zavod\.dev\/unsub\?t=x/);
  assert.match(out, /дали согласие на рекламную рассылку/);
});

test('throws when operator identification is missing', () => {
  assert.throws(() => enforce152fz('<p>x</p>', { operator: '', unsubscribeUrl: 'https://x' }), /оператора/);
});

test('throws when unsubscribe url is missing', () => {
  assert.throws(() => enforce152fz('<p>x</p>', { operator: 'ООО Х', unsubscribeUrl: '' }), /отписк/);
});

test('injects before </body> when present', () => {
  const out = enforce152fz('<html><body><p>Текст</p></body></html>', opts);
  assert.match(out, /cdp-152fz-footer[\s\S]*<\/body>/);
  assert.ok(out.indexOf('cdp-152fz-footer') < out.indexOf('</body>'));
});
