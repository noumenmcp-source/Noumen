'use strict';
/**
 * Content generators — ported from US modules/email/generators.ts.
 * Structure is law-agnostic; the COPY is rebuilt in Russian and the AI system
 * prompt is rebuilt for 152-ФЗ / «О рекламе». AiGatewayGenerator speaks the
 * OpenAI-compatible API, so it points at Flot by default.
 */

/** Deterministic, dependency-free RU generator (default + offline tests). */
class TemplateGenerator {
  async generate(profile, ctx) {
    return renderTemplate(profile, ctx);
  }
}

/** Pure render (RU copy from firmographics + intent). */
function renderTemplate(profile, ctx) {
  const f = profile.firmographics || {};
  const intent = profile.intent || {};
  const company = (f.company || '').trim() || 'ваша команда';
  const industry = (f.industry || '').trim();
  const intentScore = typeof intent.score === 'number' ? intent.score : 0;
  const topics = (intent.topics || []).filter(Boolean);
  const topTopic = topics[0];
  const brand = (ctx.brandName || '').trim() || 'Наша команда';
  const product = (ctx.productName || '').trim();

  const subject = buildSubject(ctx.trigger, { company, brand, product });
  const greeting = `<p>Здравствуйте, ${escapeHtml(company)}!</p>`;

  const intentLine =
    intentScore >= 70
      ? `<p>Мы заметили активный интерес со стороны ${escapeHtml(company)}` +
        (topTopic ? ` к теме ${escapeHtml(topTopic)}` : '') +
        ` и решили написать лично.</p>`
      : intentScore >= 30
        ? `<p>Спасибо, что обратили внимание на ${escapeHtml(brand)}` +
          (topTopic ? ` и ${escapeHtml(topTopic)}` : '') +
          `.</p>`
        : `<p>Благодарим ${escapeHtml(company)} за интерес к ${escapeHtml(brand)}.</p>`;

  const industryLine = industry
    ? `<p>Команды в отрасли «${escapeHtml(industry)}» используют ${escapeHtml(brand)}, чтобы работать быстрее.</p>`
    : '';

  const body = buildBody(ctx.trigger, { brand, product });
  const cta = ctx.ctaUrl
    ? `<p><a href="${escapeAttr(ctx.ctaUrl)}">${escapeHtml(ctaLabel(ctx.trigger))}</a></p>`
    : `<p>${escapeHtml(ctaLabel(ctx.trigger))}</p>`;
  const signoff = `<p>С уважением,<br/>команда ${escapeHtml(brand)}</p>`;

  const html = `<div class="cdp-email">${greeting}${intentLine}${industryLine}${body}${cta}${signoff}</div>`;
  return { subject, html };
}

function buildSubject(trigger, v) {
  switch (trigger) {
    case 'welcome': return `Добро пожаловать в ${v.brand}, ${v.company}`;
    case 'abandoned_cart': return v.product
      ? `${v.company}, ${v.product} ждёт в корзине`
      : `${v.company}, вы оставили товар в корзине`;
    case 'reactivation': return `Мы скучаем по вам в ${v.brand}, ${v.company}`;
    default: return `${v.brand}`;
  }
}

function buildBody(trigger, v) {
  switch (trigger) {
    case 'welcome':
      return `<p>Добро пожаловать! Вот как получить максимум от ${escapeHtml(v.brand)} с первого дня.</p>`;
    case 'abandoned_cart':
      return v.product
        ? `<p>${escapeHtml(v.product)} ждёт вас. Завершите заказ, пока товар в наличии.</p>`
        : `<p>Ваши товары ждут вас. Завершите заказ, пока они в наличии.</p>`;
    case 'reactivation':
      return `<p>Давно не виделись. В ${escapeHtml(v.brand)} появились новые возможности — думаем, вам понравится.</p>`;
    default: return '';
  }
}

function ctaLabel(trigger) {
  switch (trigger) {
    case 'welcome': return 'Начать';
    case 'abandoned_cart': return 'Завершить заказ';
    case 'reactivation': return 'Посмотреть новинки';
    default: return 'Подробнее';
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

const SYSTEM_PROMPT =
  'Вы — копирайтер B2B email-рассылок на русском языке. Пишите честный текст, ' +
  'соответствующий 152-ФЗ и закону «О рекламе». НЕ добавляйте ссылку на отписку, ' +
  'реквизиты оператора или контакты — их добавляет система. Ответьте СТРОГО в формате ' +
  'JSON вида {"subject": string, "html": string}.';

function buildUserPrompt(profile, ctx) {
  const f = profile.firmographics || {};
  const intent = profile.intent || {};
  return JSON.stringify({
    trigger: ctx.trigger, brandName: ctx.brandName, productName: ctx.productName,
    company: f.company, industry: f.industry, employeeRange: f.employeeRange,
    intentScore: intent.score, intentTopics: intent.topics,
  });
}

/**
 * OpenAI-compatible LLM generator (no SDK). Defaults to Flot via AI_GATEWAY_URL.
 * On any failure falls back to the deterministic TemplateGenerator, so callers
 * always receive a valid email and tests can exercise the fallback offline.
 */
class AiGatewayGenerator {
  constructor(config = {}) {
    this.url = config.url || process.env.AI_GATEWAY_URL;
    this.apiKey = config.apiKey || process.env.AI_GATEWAY_API_KEY;
    this.model = config.model || process.env.AI_GATEWAY_MODEL || 'gpt-5.5';
    this.fetchImpl = config.fetchImpl;
    this.fallback = config.fallback || new TemplateGenerator();
  }

  async generate(profile, ctx) {
    const doFetch = this.fetchImpl || globalThis.fetch;
    // Flot keyless backends accept no apiKey; require only a URL + fetch.
    if (!this.url || typeof doFetch !== 'function') return this.fallback.generate(profile, ctx);
    try {
      const headers = { 'content-type': 'application/json' };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const res = await doFetch(`${trimSlash(this.url)}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({
          model: this.model, temperature: 0.4,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(profile, ctx) },
          ],
        }),
      });
      if (!res.ok) return this.fallback.generate(profile, ctx);
      const data = await res.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const parsed = content ? parseGenerated(content.trim()) : null;
      return parsed || this.fallback.generate(profile, ctx);
    } catch {
      return this.fallback.generate(profile, ctx);
    }
  }
}

function parseGenerated(content) {
  let raw = content;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.subject === 'string' && typeof obj.html === 'string' && obj.subject.length > 0 && obj.html.length > 0) {
      return { subject: obj.subject, html: obj.html };
    }
  } catch { return null; }
  return null;
}

function trimSlash(u) { return String(u).replace(/\/+$/, ''); }

module.exports = { TemplateGenerator, AiGatewayGenerator, renderTemplate, SYSTEM_PROMPT };
