import type { Profile } from "@cdp-us/contracts";
import type {
  ContentGenerator,
  GeneratedEmail,
  GenerationContext,
  EmailTrigger,
} from "./types.js";

/**
 * Deterministic, dependency-free personalized email generator.
 *
 * Produces stable English copy from `profile.firmographics` + `profile.intent`.
 * Used as the default and by the offline test suite. Given identical inputs it
 * always yields identical output (no randomness, no clock, no network).
 */
export class TemplateGenerator implements ContentGenerator {
  async generate(
    profile: Profile,
    ctx: GenerationContext,
  ): Promise<GeneratedEmail> {
    return Promise.resolve(renderTemplate(profile, ctx));
  }
}

/** Pure render so it can be reused/snapshotted without instantiating a class. */
export function renderTemplate(
  profile: Profile,
  ctx: GenerationContext,
): GeneratedEmail {
  const company = profile.firmographics.company?.trim() || "your team";
  const industry = profile.firmographics.industry?.trim();
  const intentScore =
    typeof profile.intent.score === "number" ? profile.intent.score : 0;
  const topics = (profile.intent.topics ?? []).filter(Boolean);
  const topTopic = topics[0];
  const brand = ctx.brandName.trim() || "Our Team";
  const product = ctx.productName?.trim();

  const subject = buildSubject(ctx.trigger, { company, brand, product });

  const greeting = `<p>Hello ${escapeHtml(company)},</p>`;

  const intentLine =
    intentScore >= 70
      ? `<p>We noticed strong, recent interest from ${escapeHtml(company)}` +
        (topTopic ? ` around ${escapeHtml(topTopic)}` : "") +
        `, so we wanted to reach out personally.</p>`
      : intentScore >= 30
        ? `<p>Thanks for taking a look at ${escapeHtml(brand)}` +
          (topTopic ? ` and ${escapeHtml(topTopic)}` : "") +
          `.</p>`
        : `<p>We appreciate ${escapeHtml(company)} considering ${escapeHtml(brand)}.</p>`;

  const industryLine = industry
    ? `<p>Teams in ${escapeHtml(industry)} use ${escapeHtml(brand)} to move faster.</p>`
    : "";

  const body = buildBody(ctx.trigger, { brand, product });

  const cta = ctx.ctaUrl
    ? `<p><a href="${escapeAttr(ctx.ctaUrl)}">${escapeHtml(
        ctaLabel(ctx.trigger),
      )}</a></p>`
    : `<p>${escapeHtml(ctaLabel(ctx.trigger))}</p>`;

  const signoff = `<p>Best regards,<br/>The ${escapeHtml(brand)} Team</p>`;

  const html =
    `<div class="cdp-email">` +
    greeting +
    intentLine +
    industryLine +
    body +
    cta +
    signoff +
    `</div>`;

  return { subject, html };
}

function buildSubject(
  trigger: EmailTrigger,
  v: { company: string; brand: string; product?: string },
): string {
  switch (trigger) {
    case "welcome":
      return `Welcome to ${v.brand}, ${v.company}`;
    case "abandoned_cart":
      return v.product
        ? `${v.company}, ${v.product} is still in your cart`
        : `${v.company}, you left something in your cart`;
    case "reactivation":
      return `We miss you at ${v.brand}, ${v.company}`;
  }
}

function buildBody(
  trigger: EmailTrigger,
  v: { brand: string; product?: string },
): string {
  switch (trigger) {
    case "welcome":
      return (
        `<p>Welcome aboard. Here is how to get the most out of ` +
        `${escapeHtml(v.brand)} from day one.</p>`
      );
    case "abandoned_cart":
      return v.product
        ? `<p>${escapeHtml(v.product)} is waiting for you. ` +
            `Complete your order before it sells out.</p>`
        : `<p>Your items are waiting for you. ` +
            `Complete your order before they sell out.</p>`;
    case "reactivation":
      return (
        `<p>It has been a while. We have shipped new features in ` +
        `${escapeHtml(v.brand)} we think you will like.</p>`
      );
  }
}

function ctaLabel(trigger: EmailTrigger): string {
  switch (trigger) {
    case "welcome":
      return "Get started";
    case "abandoned_cart":
      return "Complete your order";
    case "reactivation":
      return "See what's new";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Configuration for {@link AiGatewayGenerator}. */
export interface AiGatewayConfig {
  /** OpenAI-compatible base URL, e.g. https://gateway.example.com/v1 */
  url?: string;
  /** Bearer token for the gateway. */
  apiKey?: string;
  /** Model identifier passed to the gateway. */
  model: string;
  /** Injectable fetch for tests; defaults to Node 22 global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Fallback used when the gateway is unreachable or misconfigured.
   * Defaults to a {@link TemplateGenerator} so output is never empty.
   */
  fallback?: ContentGenerator;
}

/** Shape of an OpenAI-compatible chat completion response (subset). */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * Calls an OpenAI-compatible AI Gateway over `fetch` (no SDK dependency).
 *
 * The model is instructed to return strict JSON `{ "subject", "html" }`.
 * On any failure (missing config, network error, non-2xx, unparseable body)
 * it falls back to the deterministic {@link TemplateGenerator}, so callers
 * always receive a valid email and tests can exercise the fallback offline.
 */
export class AiGatewayGenerator implements ContentGenerator {
  private readonly url?: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly fallback: ContentGenerator;

  constructor(config: AiGatewayConfig) {
    this.url = config.url ?? process.env.AI_GATEWAY_URL;
    this.apiKey = config.apiKey ?? process.env.AI_GATEWAY_API_KEY;
    this.model = config.model;
    this.fetchImpl = config.fetchImpl;
    this.fallback = config.fallback ?? new TemplateGenerator();
  }

  async generate(
    profile: Profile,
    ctx: GenerationContext,
  ): Promise<GeneratedEmail> {
    const doFetch = this.fetchImpl ?? globalThis.fetch;
    if (!this.url || !this.apiKey || typeof doFetch !== "function") {
      return this.fallback.generate(profile, ctx);
    }

    try {
      const res = await doFetch(`${trimSlash(this.url)}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(profile, ctx) },
          ],
        }),
      });

      if (!res.ok) {
        return this.fallback.generate(profile, ctx);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return this.fallback.generate(profile, ctx);
      }

      const parsed = parseGenerated(content);
      if (!parsed) {
        return this.fallback.generate(profile, ctx);
      }
      return parsed;
    } catch {
      return this.fallback.generate(profile, ctx);
    }
  }
}

const SYSTEM_PROMPT =
  "You are a US B2B email copywriter. Write CAN-SPAM compliant, honest, " +
  "English marketing email copy. Respond ONLY with strict JSON of the form " +
  '{"subject": string, "html": string}. Do not include an unsubscribe link ' +
  "or physical address; those are appended by the system.";

function buildUserPrompt(profile: Profile, ctx: GenerationContext): string {
  const f = profile.firmographics;
  return JSON.stringify({
    trigger: ctx.trigger,
    brandName: ctx.brandName,
    productName: ctx.productName,
    company: f.company,
    industry: f.industry,
    employeeRange: f.employeeRange,
    intentScore: profile.intent.score,
    intentTopics: profile.intent.topics,
  });
}

function parseGenerated(content: string): GeneratedEmail | null {
  let raw = content;
  // Strip ```json ... ``` fences if the model added them.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  try {
    const obj = JSON.parse(raw) as Partial<GeneratedEmail>;
    if (
      obj &&
      typeof obj.subject === "string" &&
      typeof obj.html === "string" &&
      obj.subject.length > 0 &&
      obj.html.length > 0
    ) {
      return { subject: obj.subject, html: obj.html };
    }
  } catch {
    return null;
  }
  return null;
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}
