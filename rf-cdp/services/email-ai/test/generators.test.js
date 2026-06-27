'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TemplateGenerator, AiGatewayGenerator, renderTemplate } = require('../lib/generators');

const profile = {
  id: 'p1', firmographics: { company: 'Акме', industry: 'станкостроение' },
  intent: { score: 80, topics: ['ЧПУ'] }, traits: {},
};

test('renderTemplate produces RU subject + html from profile', () => {
  const out = renderTemplate(profile, { trigger: 'welcome', brandName: 'Zavod' });
  assert.equal(out.subject, 'Добро пожаловать в Zavod, Акме');
  assert.match(out.html, /Здравствуйте, Акме!/);
  assert.match(out.html, /команда Zavod/);
});

test('high intent line mentions the top topic', () => {
  const out = renderTemplate(profile, { trigger: 'welcome', brandName: 'Zavod' });
  assert.match(out.html, /активный интерес со стороны Акме к теме ЧПУ/);
});

test('TemplateGenerator is deterministic', async () => {
  const g = new TemplateGenerator();
  const a = await g.generate(profile, { trigger: 'reactivation', brandName: 'Zavod' });
  const b = await g.generate(profile, { trigger: 'reactivation', brandName: 'Zavod' });
  assert.deepEqual(a, b);
});

test('AiGatewayGenerator falls back to template when no url (offline)', async () => {
  const g = new AiGatewayGenerator({ model: 'gpt-5.5' }); // no url
  const out = await g.generate(profile, { trigger: 'welcome', brandName: 'Zavod' });
  assert.equal(out.subject, 'Добро пожаловать в Zavod, Акме'); // template output
});

test('AiGatewayGenerator parses a stubbed OpenAI-compatible response', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"subject":"Тема","html":"<p>Текст</p>"}' } }] }) });
  const g = new AiGatewayGenerator({ url: 'http://flot/v1', model: 'gpt-5.5', fetchImpl });
  const out = await g.generate(profile, { trigger: 'welcome', brandName: 'Zavod' });
  assert.deepEqual(out, { subject: 'Тема', html: '<p>Текст</p>' });
});

test('AiGatewayGenerator falls back on non-2xx', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const g = new AiGatewayGenerator({ url: 'http://flot/v1', model: 'gpt-5.5', fetchImpl });
  const out = await g.generate(profile, { trigger: 'welcome', brandName: 'Zavod' });
  assert.equal(out.subject, 'Добро пожаловать в Zavod, Акме'); // fell back to template
});
