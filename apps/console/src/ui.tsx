"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function Panel(props: { readonly children: ReactNode; readonly className?: string }) {
  return <section className={`panel ${props.className ?? ""}`}>{props.children}</section>;
}

export function Button(props: {
  readonly children: ReactNode;
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly variant?: "primary" | "secondary";
  readonly className?: string;
}) {
  const base = props.variant === "secondary" ? "btn-secondary" : "btn";
  return (
    <button className={`${base} ${props.className ?? ""}`} disabled={props.disabled} onClick={props.onClick} type={props.type ?? "button"}>
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
    <div className="rounded-xl border border-dashed border-line bg-field/70 p-5 text-sm">
      <p className="font-semibold text-ink">{props.title}</p>
      <p className="mt-1 text-muted">{props.body}</p>
    </div>
  );
}

export function ErrorState(props: { readonly message: string }) {
  return <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{props.message}</p>;
}

/** Small pill, tinted by tone. Used for intent score and module state.
 * @example <Badge tone="hot">Intent 82</Badge>
 */
export function Badge(props: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "warm" | "hot" | "ok" | "info";
}) {
  const tones = {
    neutral: "border-line bg-field text-muted",
    warm: "border-amber-200 bg-amber-50 text-amber-800",
    hot: "border-red-200 bg-red-50 text-red-800",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  } as const;
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[props.tone ?? "neutral"]}`}
    >
      {props.children}
    </span>
  );
}

export function Shell(props: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const activeTitle = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.label ?? "Dashboard";

  return (
    <div className="min-h-svh bg-sidebar text-ink">
      <div className="grid min-h-svh lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-sidebar lg:flex lg:flex-col">
          <div className="border-b border-line px-4 py-4">
            <Link className="flex items-center gap-2" href="/">
              <span className="grid size-7 place-items-center rounded-md bg-ink text-xs font-semibold text-white">N</span>
              <span className="font-semibold">Noumen</span>
            </Link>
            <label className="mt-4 block">
              <span className="sr-only">Search</span>
              <input className="input h-8 w-full bg-container text-sm" placeholder="Search tenant data" type="search" />
            </label>
          </div>
          <nav className="flex-1 space-y-5 px-3 py-4">
            <NavGroup label="Workspace" pathname={pathname} />
            <div className="border-t border-line pt-4">
              <p className="px-2.5 text-xs font-medium uppercase text-muted">Setup</p>
              <div className="mt-2 grid gap-1">
                <NavLink active={pathname === "/signup"} href="/signup" marker="+">Create tenant</NavLink>
                <NavLink active={pathname === "/login"} href="/login" marker=">">Use token</NavLink>
              </div>
            </div>
          </nav>
          <div className="border-t border-line p-3">
            <div className="rounded-xl border border-line bg-container p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">US runtime</p>
                <Badge tone="ok">live</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">CCPA/CPRA, CAN-SPAM, TCPA scoped.</p>
            </div>
          </div>
        </aside>

        <div className="min-w-0 lg:p-2">
          <div className="min-h-svh overflow-hidden bg-container lg:rounded-md lg:border lg:border-line">
            <header className="sticky top-0 z-10 border-b border-line bg-container/95 px-4 py-3 backdrop-blur sm:px-6">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-muted">CDP-US Console</p>
                  <h1 className="truncate text-xl font-medium sm:text-2xl">{activeTitle}</h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link className="btn-secondary hidden sm:inline-flex" href="/connect">Connector</Link>
                  <Link className="btn" href="/signup">New tenant</Link>
                </div>
              </div>
              <nav className="mt-3 flex gap-1 overflow-x-auto lg:hidden">
                {navItems.map((item) => (
                  <Link className={`navlink shrink-0 ${isActive(pathname, item.href) ? "navlink-active" : ""}`} href={item.href} key={item.href}>
                    <span aria-hidden="true">{item.marker}</span>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-7">{props.children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PageHeader(props: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly body?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {props.eyebrow ? <p className="text-xs font-medium uppercase text-muted">{props.eyebrow}</p> : null}
        <h2 className="text-2xl font-medium tracking-normal text-ink">{props.title}</h2>
        {props.body ? <p className="mt-1 max-w-3xl text-sm text-muted">{props.body}</p> : null}
      </div>
      {props.actions ? <div className="flex shrink-0 items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}

export function MetricCard(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: string;
  readonly tone?: "neutral" | "ok" | "warm" | "hot" | "info";
}) {
  return (
    <section className="metric-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{props.label}</p>
          <p className="mt-2 text-3xl font-medium text-ink">{props.value}</p>
          {props.detail ? <p className="mt-1 text-xs text-muted">{props.detail}</p> : null}
        </div>
        <span className="grid size-12 place-items-center rounded-lg border border-line bg-field text-sm font-semibold text-muted">
          {metricMarker[props.tone ?? "neutral"]}
        </span>
      </div>
    </section>
  );
}

function NavGroup(props: { readonly label: string; readonly pathname: string }) {
  return (
    <div>
      <p className="px-2.5 text-xs font-medium uppercase text-muted">{props.label}</p>
      <div className="mt-2 grid gap-1">
        {navItems.map((item) => (
          <NavLink active={isActive(props.pathname, item.href)} href={item.href} key={item.href} marker={item.marker}>
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function NavLink(props: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly href: string;
  readonly marker: string;
}) {
  return (
    <Link className={`navlink ${props.active ? "navlink-active" : ""}`} href={props.href}>
      <span aria-hidden="true" className="grid size-5 place-items-center text-xs">{props.marker}</span>
      <span className="truncate">{props.children}</span>
    </Link>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

const navItems = [
  { href: "/", label: "Dashboard", marker: "D" },
  { href: "/profiles", label: "Profiles", marker: "P" },
  { href: "/activation", label: "Activation", marker: "A" },
  { href: "/modules", label: "Modules", marker: "M" },
  { href: "/connect", label: "Connect", marker: "C" },
] as const;

const metricMarker = {
  neutral: "-",
  ok: "OK",
  warm: "!",
  hot: "X",
  info: "i",
} as const;
