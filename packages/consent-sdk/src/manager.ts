import { readGpc } from "./gpc.js";
import { acceptAllConsent, isAllowed, rejectNonEssentialConsent, withGpc } from "./state.js";
import { createInitialConsent, loadStoredConsent, saveStoredConsent } from "./storage.js";
import { syncConsent } from "./sync.js";
import { createWidget, type ConsentWidget } from "./widget.js";
import type {
  ConsentChange,
  ConsentListener,
  ConsentManager,
  ConsentManagerOptions,
  ConsentPurpose,
  ConsentSource,
  ConsentState,
} from "./types.js";

/**
 * Creates a browser consent manager with an accessible US privacy banner.
 *
 * @example
 * const consent = createConsentManager({ endpoint: "/v1/consent" });
 * if (consent.isAllowed("analytics")) tracker.track("Page Viewed");
 */
export function createConsentManager(options: ConsentManagerOptions = {}): ConsentManager {
  const persistKey = options.persistKey ?? "cdp_us_consent";
  const gpc = readGpc();
  const stored = loadStoredConsent(persistKey, gpc);
  const initial = stored ?? createInitialConsent(persistKey, gpc);
  const listeners = new Set<ConsentListener>();
  let state = initial.state;
  let widget: ConsentWidget | null = null;
  if (options.onChange) listeners.add(options.onChange);
  if (!stored && typeof document !== "undefined") widget = createWidget(api());

  function commit(next: ConsentState, source: ConsentSource): void {
    state = withGpc({ ...next, gpc });
    const change = { subject: initial.subject, state, source };
    saveStoredConsent(persistKey, change);
    notify(listeners, change);
    syncConsent(options.endpoint, change);
    widget?.destroy();
    widget = null;
  }

  function api(): ConsentManager {
    return {
      subject: initial.subject,
      getConsent: () => state,
      isAllowed: (purpose) => isAllowed(state, purpose),
      openPreferences: () => ensureWidget().openPreferences(),
      onChange: (listener) => subscribe(listeners, listener),
      acceptAll: () => commit(acceptAllConsent(gpc), "accept_all"),
      rejectNonEssential: () => commit(rejectNonEssentialConsent(gpc), "reject_non_essential"),
      savePreferences: (next) => commit(next, "preferences"),
      destroy: () => {
        widget?.destroy();
        widget = null;
      },
    };
  }

  return api();

  function ensureWidget(): ConsentWidget {
    if (!widget && typeof document !== "undefined") widget = createWidget(api());
    return widget ?? emptyWidget();
  }
}

function subscribe(listeners: Set<ConsentListener>, listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(listeners: ReadonlySet<ConsentListener>, change: ConsentChange): void {
  for (const listener of listeners) listener(change);
}

function emptyWidget(): ConsentWidget {
  return { openPreferences: () => undefined, destroy: () => undefined };
}
