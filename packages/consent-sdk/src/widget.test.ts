import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsentManager } from "./manager.js";

describe("consent widget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders banner and opens the preference center", () => {
    createConsentManager({ persistKey: "widget_consent" });
    expect(document.body.textContent).toContain("Do Not Sell or Share");

    getButton("Manage preferences").click();
    expect(document.querySelector("form")?.hidden).toBe(false);
  });

  it("keeps sale/share disabled when GPC is enabled", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    createConsentManager({ persistKey: "gpc_consent" });

    getButton("Manage preferences").click();
    const input = document.querySelector<HTMLInputElement>('input[name="sale_or_share"]');
    expect(input?.checked).toBe(false);
    expect(input?.disabled).toBe(true);
  });
});

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent === name,
  );
  if (button instanceof HTMLButtonElement) return button;
  throw new Error(`Button not found: ${name}`);
}
