import { getPurposes, withGpc } from "./state.js";
import type { ConsentPurpose, ConsentState } from "./types.js";

export type WidgetHandlers = Readonly<{
  getConsent(): ConsentState;
  acceptAll(): void;
  rejectNonEssential(): void;
  savePreferences(state: ConsentState): void;
}>;

export type ConsentWidget = Readonly<{ openPreferences(): void; destroy(): void }>;

const LABELS: Readonly<Record<ConsentPurpose, string>> = {
  analytics: "Analytics",
  marketing_email: "Marketing email",
  sale_or_share: "Do Not Sell or Share",
  messaging_tcpa: "TCPA messaging",
};

export function createWidget(handlers: WidgetHandlers): ConsentWidget {
  const root = createRoot();
  const panel = createPanel(handlers);
  root.append(panel.banner, panel.preferences);
  document.body.append(root);
  panel.manage.focus();
  return {
    openPreferences: () => showPreferences(panel.banner, panel.preferences),
    destroy: () => root.remove(),
  };
}

function createRoot(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Privacy preferences");
  root.className = "cdp-us-consent";
  return root;
}

function createPanel(handlers: WidgetHandlers) {
  const banner = document.createElement("div");
  banner.append(
    text("p", "We use analytics by default and need your consent for marketing, sale/share, and messaging."),
    button("Accept all", handlers.acceptAll),
    button("Reject non-essential", handlers.rejectNonEssential),
  );
  const manage = button("Manage preferences", () => showPreferences(banner, preferences));
  const preferences = createPreferences(handlers);
  const link = button("Do Not Sell or Share My Personal Information", () =>
    showPreferences(banner, preferences),
  );
  banner.append(manage, link);
  preferences.hidden = true;
  return { banner, preferences, manage };
}

function createPreferences(handlers: WidgetHandlers): HTMLElement {
  const form = document.createElement("form");
  form.setAttribute("aria-label", "Consent preference center");
  for (const purpose of getPurposes()) form.append(createChoice(purpose, handlers.getConsent()));
  form.append(button("Save preferences", () => handlers.savePreferences(readForm(form))));
  return form;
}

function createChoice(purpose: ConsentPurpose, state: ConsentState): HTMLElement {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = purpose;
  input.checked = state[purpose];
  input.disabled = purpose === "sale_or_share" && state.gpc;
  label.append(input, ` ${LABELS[purpose]}`);
  return label;
}

function readForm(form: HTMLFormElement): ConsentState {
  const data = new FormData(form);
  const current = { ...defaultFormState(), gpc: hasGpcLock(form) };
  for (const purpose of getPurposes()) {
    current[purpose] = data.has(purpose);
  }
  return withGpc(current);
}

function defaultFormState(): ConsentState {
  return {
    analytics: false,
    marketing_email: false,
    sale_or_share: false,
    messaging_tcpa: false,
    gpc: false,
  };
}

function hasGpcLock(form: HTMLFormElement): boolean {
  const sale = form.elements.namedItem("sale_or_share");
  return sale instanceof HTMLInputElement && sale.disabled;
}

function showPreferences(banner: HTMLElement, preferences: HTMLElement): void {
  banner.hidden = true;
  preferences.hidden = false;
  const control = preferences.querySelector("input, button");
  if (control instanceof HTMLElement) control.focus();
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function text(tag: "p", value: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
