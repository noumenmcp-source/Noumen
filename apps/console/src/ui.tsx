"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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
    <span className="inline-flex items-center gap-[3px]">
      <span className="h-[5px] w-[5px] rounded-full bg-gold" />
      <span className="h-[5px] w-[5px] rounded-full bg-gold/50" />
    </span>
  );
}

/** Minimal stroke icon set keyed by nav item. 18px, currentColor. */
function NavIcon(props: { readonly name: string }) {
  const p = (d: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {d.split("|").map((seg, i) => <path key={i} d={seg} />)}
    </svg>
  );
  switch (props.name) {
    case "Today": return p("M12 8v4l3 2|M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z");
    case "Overview": return p("M3 3h7v7H3z|M14 3h7v7h-7z|M14 14h7v7h-7z|M3 14h7v7H3z");
    case "Playbook": return p("M9 6h11|M9 12h11|M9 18h11|M4.5 6h.01M4.5 12h.01M4.5 18h.01");
    case "Lifecycle": return p("M3 12a9 9 0 0 1 15-6.7L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-15 6.7L3 16|M3 21v-5h5");
    case "Channels": return p("M3 4h18l-7 8v6l-4 2v-8z");
    case "Profiles": return p("M16 21v-2a4 4 0 0 0-8 0v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z");
    case "Activation": return p("M13 2 4 14h7l-1 8 9-12h-7z");
    case "Email": return p("M3 6h18v12H3z|m3 7 9 6 9-6");
    case "Automations": return p("M6 3v12|M18 9v12|M6 15a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3|M6 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M6 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M18 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z");
    case "Compliance": return p("M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6z|m9 12 2 2 4-4");
    case "Modules": return p("M4 4h6v6H4z|M14 4h6v6h-6z|M14 14h6v6h-6z|M4 14h6v6H4z");
    case "Connect": return p("M9 12h6|M9 12a3 3 0 0 1-3 3H5a3 3 0 0 1 0-6h1|M15 12a3 3 0 0 0 3 3h1a3 3 0 0 0 0-6h-1");
    case "Audit": return p("M9 11l3 3 5-6|M5 3h14v18l-7-3-7 3z");
    default: return p("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z");
  }
}

const NAV_ITEMS = [
  "Overview", "Today", "Playbook", "Lifecycle", "Channels",
  "Profiles", "Activation", "Email", "Automations",
  "Compliance", "Audit", "Modules", "Connect",
] as const;

export function Shell(props: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("axiom-nav-collapsed") === "1");
    setReady(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("axiom-nav-collapsed", next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-cream text-ink">
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col bg-ink text-white transition-[width] duration-200 ${collapsed ? "w-[60px]" : "w-56"} ${ready ? "" : "invisible"}`}
      >
        {/* brand + prominent collapse toggle */}
        <div className={`flex h-14 items-center border-b border-white/10 ${collapsed ? "justify-center px-0" : "justify-between px-4"}`}>
          {!collapsed && (
            <Link href="/" title="AXIOM" className="flex items-center gap-2 font-mono text-base font-semibold uppercase tracking-[0.18em] text-white">
              <LogoMark />
              <span>AXIOM</span>
            </Link>
          )}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            className="flex h-9 w-9 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
              <path d="M4 6h16M4 12h16M4 18h16" opacity={collapsed ? "1" : "0"} />
              <path d="m15 18-6-6 6-6" opacity={collapsed ? "0" : "1"} />
            </svg>
          </button>
        </div>

        {/* collapsed: keep the mark visible under the toggle */}
        {collapsed && (
          <Link href="/" title="AXIOM" className="flex h-10 items-center justify-center border-b border-white/10">
            <LogoMark />
          </Link>
        )}

        {/* nav */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const href = `/${item.toLowerCase()}`;
            const active = pathname === href || (item === "Overview" && pathname === "/");
            return (
              <Link
                key={item}
                href={href}
                title={item}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active ? "bg-white/10 font-medium text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
                } ${collapsed ? "justify-center px-0" : ""}`}
              >
                <span className={active ? "text-gold" : ""}><NavIcon name={item} /></span>
                {!collapsed && <span>{item}</span>}
              </Link>
            );
          })}
        </nav>

      </aside>

      <main className="min-w-0 flex-1 px-6 py-7 lg:px-10">{props.children}</main>
    </div>
  );
}
