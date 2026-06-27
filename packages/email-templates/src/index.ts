import mjml2html from "mjml";

export const templateNames = ["welcome", "abandoned_cart", "reactivation"] as const;

export type TemplateName = (typeof templateNames)[number];

export interface RenderResult {
  html: string;
}

export interface FooterVars {
  physicalAddress: string;
  unsubscribeUrl: string;
}

export interface WelcomeTemplateVars extends FooterVars {
  brandName: string;
  firstName: string;
  ctaUrl: string;
}

export interface AbandonedCartTemplateVars extends FooterVars {
  brandName: string;
  firstName: string;
  cartUrl: string;
  itemName: string;
}

export interface ReactivationTemplateVars extends FooterVars {
  brandName: string;
  firstName: string;
  ctaUrl: string;
  incentive: string;
}

export type TemplateVarsByName = {
  welcome: WelcomeTemplateVars;
  abandoned_cart: AbandonedCartTemplateVars;
  reactivation: ReactivationTemplateVars;
};

export type TemplateVars = TemplateVarsByName[TemplateName];

interface LayoutVars extends FooterVars {
  brandName: string;
  title: string;
  previewText: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}

interface MjmlRenderOptions {
  minify: boolean;
  validationLevel: "strict" | "soft" | "skip";
}

interface MjmlRenderError {
  formattedMessage: string;
}

interface MjmlRenderResult {
  html: string;
  errors: MjmlRenderError[];
}

const renderMjmlToHtml = mjml2html as unknown as (
  mjml: string,
  options: MjmlRenderOptions
) => MjmlRenderResult;

export function listTemplates(): readonly TemplateName[] {
  return templateNames;
}

export function render(templateName: "welcome", vars: WelcomeTemplateVars): RenderResult;
export function render(templateName: "abandoned_cart", vars: AbandonedCartTemplateVars): RenderResult;
export function render(templateName: "reactivation", vars: ReactivationTemplateVars): RenderResult;
export function render(templateName: TemplateName, vars: TemplateVars): RenderResult {
  const mjml = renderMjml(templateName, vars);
  const result = renderMjmlToHtml(mjml, {
    minify: false,
    validationLevel: "strict"
  });

  if (result.errors.length > 0) {
    const messages = result.errors.map((error) => error.formattedMessage).join("\n");
    throw new Error(`Failed to render ${templateName}: ${messages}`);
  }

  return { html: result.html };
}

function renderMjml(templateName: TemplateName, vars: TemplateVars): string {
  switch (templateName) {
    case "welcome":
      return welcomeTemplate(vars as WelcomeTemplateVars);
    case "abandoned_cart":
      return abandonedCartTemplate(vars as AbandonedCartTemplateVars);
    case "reactivation":
      return reactivationTemplate(vars as ReactivationTemplateVars);
  }
}

function welcomeTemplate(vars: WelcomeTemplateVars): string {
  return baseLayout({
    brandName: vars.brandName,
    title: `Welcome to ${vars.brandName}`,
    previewText: `Your ${vars.brandName} account is ready.`,
    body: paragraphs([
      `Hi ${vars.firstName},`,
      `Welcome to ${vars.brandName}. Your account is ready, and you can start exploring your customer data workspace now.`
    ]),
    ctaLabel: "Open your workspace",
    ctaUrl: vars.ctaUrl,
    physicalAddress: vars.physicalAddress,
    unsubscribeUrl: vars.unsubscribeUrl
  });
}

function abandonedCartTemplate(vars: AbandonedCartTemplateVars): string {
  return baseLayout({
    brandName: vars.brandName,
    title: "Still thinking it over?",
    previewText: `${vars.itemName} is still waiting in your cart.`,
    body: paragraphs([
      `Hi ${vars.firstName},`,
      `You left ${vars.itemName} in your cart. We saved it so you can pick up right where you left off.`
    ]),
    ctaLabel: "Return to your cart",
    ctaUrl: vars.cartUrl,
    physicalAddress: vars.physicalAddress,
    unsubscribeUrl: vars.unsubscribeUrl
  });
}

function reactivationTemplate(vars: ReactivationTemplateVars): string {
  return baseLayout({
    brandName: vars.brandName,
    title: "Ready to come back?",
    previewText: `A fresh ${vars.brandName} offer is waiting for you.`,
    body: paragraphs([
      `Hi ${vars.firstName},`,
      `We have missed seeing you at ${vars.brandName}. Come back today and use ${vars.incentive} on your next order.`
    ]),
    ctaLabel: "Reactivate my account",
    ctaUrl: vars.ctaUrl,
    physicalAddress: vars.physicalAddress,
    unsubscribeUrl: vars.unsubscribeUrl
  });
}

function baseLayout(vars: LayoutVars): string {
  return `
<mjml>
  <mj-head>
    <mj-title>${escapeHtml(vars.title)}</mj-title>
    <mj-preview>${escapeHtml(vars.previewText)}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text color="#243044" font-size="16px" line-height="24px" />
      <mj-button background-color="#1769e0" color="#ffffff" border-radius="6px" font-size="16px" font-weight="700" inner-padding="14px 22px" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f7fb" width="640px">
    <mj-section padding="24px 20px 0">
      <mj-column>
        <mj-text align="center" color="#1769e0" font-size="24px" font-weight="700" line-height="30px">${escapeHtml(vars.brandName)}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 28px">
      <mj-column>
        <mj-text color="#172033" font-size="28px" font-weight="700" line-height="34px" padding-bottom="12px">${escapeHtml(vars.title)}</mj-text>
        ${vars.body}
        <mj-button href="${escapeAttribute(vars.ctaUrl)}" align="left" padding-top="12px">${escapeHtml(vars.ctaLabel)}</mj-button>
      </mj-column>
    </mj-section>
    <mj-section padding="18px 20px 28px">
      <mj-column>
        <mj-text align="center" color="#687386" font-size="12px" line-height="18px">
          ${escapeHtml(vars.physicalAddress)}<br />
          <a href="${escapeAttribute(vars.unsubscribeUrl)}" style="color:#1769e0;text-decoration:underline;">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

function paragraphs(values: readonly string[]): string {
  return values.map((value) => `<mj-text>${escapeHtml(value)}</mj-text>`).join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
