export type ConsentPurpose =
  | "analytics"
  | "marketing_email"
  | "sale_or_share"
  | "messaging_tcpa";

export type ConsentSource = "accept_all" | "reject_non_essential" | "preferences";

export type ConsentState = Readonly<{
  analytics: boolean;
  marketing_email: boolean;
  sale_or_share: boolean;
  messaging_tcpa: boolean;
  gpc: boolean;
}>;

export type ConsentChange = Readonly<{
  subject: string;
  state: ConsentState;
  source: ConsentSource;
}>;

export type ConsentListener = (change: ConsentChange) => void;

export type ConsentFetcher = (
  input: string,
  init: Readonly<{ method: "POST"; headers: Readonly<Record<string, string>>; body: string }>,
) => Promise<unknown>;

export type ConsentManagerOptions = Readonly<{
  endpoint?: string;
  persistKey?: string;
  onChange?: ConsentListener;
}>;

export type ConsentManager = Readonly<{
  subject: string;
  getConsent(): ConsentState;
  isAllowed(purpose: ConsentPurpose): boolean;
  openPreferences(): void;
  onChange(listener: ConsentListener): () => void;
  acceptAll(): void;
  rejectNonEssential(): void;
  savePreferences(state: ConsentState): void;
  destroy(): void;
}>;
