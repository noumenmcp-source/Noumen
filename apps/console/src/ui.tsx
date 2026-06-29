import Link from "next/link";
import type { ReactNode } from "react";

export function Panel(props: { readonly children: ReactNode; readonly className?: string }) {
  return <section className={`panel ${props.className ?? ""}`}>{props.children}</section>;
}

export function Button(props: {
  readonly children: ReactNode;
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button className="btn" disabled={props.disabled} onClick={props.onClick} type={props.type ?? "button"}>
      {props.children}
    </button>
  );
}

export function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-ink">
      <span>{props.label}</span>
      <input
        className="input"
        required={props.required}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

export function EmptyState(props: { readonly title: string; readonly body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-cream p-6 text-sm">
      <p className="font-semibold text-ink">{props.title}</p>
      <p className="mt-1 text-muted">{props.body}</p>
    </div>
  );
}

export function ErrorState(props: { readonly message: string }) {
  return <p className="rounded-md border border-rust/30 bg-rust/10 p-3 text-sm text-rust">{props.message}</p>;
}

/**
 * Stage/channel quality badge.
 * tone: "gold" = money/VIP, "sage" = good, "rust" = bad, "muted" = neutral
 */
export function Badge(props: {
  readonly children: ReactNode;
  readonly tone?: "muted" | "gold" | "sage" | "rust" | "ok" | "warm" | "hot" | "neutral";
}) {
  const tones: Record<string, string> = {
    muted:   "border-line bg-cream text-muted",
    neutral: "border-line bg-cream text-muted",
    gold:    "border-gold/40 bg-gold/10 text-gold",
    ok:      "border-sage/40 bg-sage/10 text-sage",
    sage:    "border-sage/40 bg-sage/10 text-sage",
    rust:    "border-rust/40 bg-rust/10 text-rust",
    hot:     "border-rust/40 bg-rust/10 text-rust",
    warm:    "border-gold/40 bg-gold/10 text-gold",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest ${tones[props.tone ?? "muted"] ?? tones.muted}`}>
      {props.children}
    </span>
  );
}

/** AXIOM logo mark — two gold dots */
function LogoMark() {
  return (
    <span className="mr-2 inline-flex items-center gap-[3px]">
      <span className="h-[5px] w-[5px] rounded-full bg-gold" />
      <span className="h-[5px] w-[5px] rounded-full bg-gold/50" />
    </span>
  );
}

const NAV_ITEMS = [
  "Today", "Playbook", "Lifecycle", "Channels",
  "Profiles", "Activation", "Email", "Automations",
  "Compliance", "Modules", "Connect",
] as const;

export function Shell(props: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen bg-cream text-ink">
      {/* Dark header — matches deck aesthetic */}
      <header className="bg-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center font-mono text-sm font-semibold uppercase tracking-[0.18em] text-white">
            <LogoMark />
            AXIOM
          </Link>
          <nav className="flex flex-wrap gap-0.5">
            {NAV_ITEMS.map((item) => (
              <Link className="navlink" href={`/${item.toLowerCase()}`} key={item}>
                {item}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-7">{props.children}</main>
    </div>
  );
}
