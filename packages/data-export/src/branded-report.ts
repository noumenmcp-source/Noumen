/**
 * White-label branded report. Renders a self-contained, print-ready HTML
 * document (no external assets beyond an optional logo URL) that an agency can
 * hand to a client under its own brand. PDF is produced by printing the page
 * (browser "Save as PDF" or a headless-Chrome step) — no server PDF dependency.
 */

export interface BrandConfig {
  /** Brand/agency name shown in the header and footer. */
  readonly name: string;
  /** Accent color (CSS hex). Defaults to AXIOM gold. */
  readonly accentColor?: string;
  /** Optional logo image URL. */
  readonly logoUrl?: string;
}

export interface ReportStage {
  readonly label: string;
  readonly count: number;
  readonly pct: number;
}

export interface BrandedReportData {
  /** ISO timestamp; injected so the document is deterministic for tests. */
  readonly generatedAt: string;
  readonly totalProfiles: number;
  readonly stages: readonly ReportStage[];
  /** Optional headline metrics (e.g. revenue, orders). */
  readonly highlights?: readonly { readonly label: string; readonly value: string }[];
}

const DEFAULT_ACCENT = "#c9a84c";
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/** Escape text for safe HTML interpolation (brand fields are operator-supplied). */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow a clean hex color through; otherwise fall back to the default. */
function safeAccent(accent: string | undefined): string {
  return accent && HEX_RE.test(accent) ? accent : DEFAULT_ACCENT;
}

function stageRows(stages: readonly ReportStage[], accent: string): string {
  return stages
    .map((s) => {
      const width = Math.max(0, Math.min(100, s.pct)).toFixed(1);
      return `<tr>
        <td class="label">${esc(s.label)}</td>
        <td class="bar"><span style="width:${width}%;background:${accent}"></span></td>
        <td class="num">${s.count.toLocaleString("en-US")}</td>
        <td class="pct">${s.pct.toFixed(1)}%</td>
      </tr>`;
    })
    .join("\n");
}

function highlightCards(highlights: readonly { label: string; value: string }[] | undefined): string {
  if (!highlights || highlights.length === 0) return "";
  const cards = highlights
    .map((h) => `<div class="card"><div class="v">${esc(h.value)}</div><div class="l">${esc(h.label)}</div></div>`)
    .join("\n");
  return `<section class="cards">${cards}</section>`;
}

/**
 * Build a branded, print-ready HTML report.
 *
 * @example buildBrandedReport({ name: "Acme" }, { generatedAt, totalProfiles: 100, stages: [] })
 */
export function buildBrandedReport(brand: BrandConfig, data: BrandedReportData): string {
  const accent = safeAccent(brand.accentColor);
  const name = esc(brand.name);
  const logo =
    brand.logoUrl && /^https?:\/\//.test(brand.logoUrl)
      ? `<img class="logo" src="${esc(brand.logoUrl)}" alt="${name}" />`
      : `<div class="logo-text">${name}</div>`;
  const date = esc(data.generatedAt.slice(0, 10));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${name} — Audience Report</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #1c1510; background: #fff; }
  .page { max-width: 820px; margin: 0 auto; padding: 48px; }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid var(--accent); padding-bottom: 16px; }
  .logo { max-height: 44px; }
  .logo-text { font-size: 22px; font-weight: 700; letter-spacing: .04em; }
  .meta { font-family: "Courier New", monospace; font-size: 11px; color: #7a6e60; text-align: right; }
  h1 { font-size: 30px; margin: 28px 0 4px; }
  .sub { color: #7a6e60; margin: 0 0 24px; }
  .cards { display: flex; gap: 16px; margin: 0 0 28px; flex-wrap: wrap; }
  .card { flex: 1 1 140px; border: 1px solid #e0d8cc; border-radius: 8px; padding: 14px 16px; }
  .card .v { font-size: 24px; font-weight: 700; color: var(--accent); }
  .card .l { font-family: "Courier New", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #7a6e60; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 6px; border-bottom: 1px solid #ece5da; vertical-align: middle; }
  td.label { font-weight: 600; width: 26%; }
  td.bar { width: 48%; }
  td.bar span { display: block; height: 12px; border-radius: 3px; }
  td.num { text-align: right; font-family: "Courier New", monospace; width: 14%; }
  td.pct { text-align: right; font-family: "Courier New", monospace; color: #7a6e60; width: 12%; }
  footer { margin-top: 36px; border-top: 1px solid #e0d8cc; padding-top: 12px; font-family: "Courier New", monospace; font-size: 10px; color: #7a6e60; }
  @media print { .page { padding: 24px; } @page { margin: 16mm; } }
</style>
</head>
<body>
  <div class="page">
    <header>
      ${logo}
      <div class="meta">Audience Report<br />${date}</div>
    </header>
    <h1>Your base at a glance.</h1>
    <p class="sub">${data.totalProfiles.toLocaleString("en-US")} unified profiles</p>
    ${highlightCards(data.highlights)}
    <table>
      <tbody>
        ${stageRows(data.stages, accent)}
      </tbody>
    </table>
    <footer>Prepared by ${name} · Generated ${date} · Powered by AXIOM</footer>
  </div>
</body>
</html>`;
}
