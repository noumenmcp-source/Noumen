import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx, focusRing } from "../utils.js";

export type NavItem = {
  readonly label: string;
  readonly href: string;
  readonly active?: boolean;
  readonly badge?: ReactNode;
};

export type AppShellProps = HTMLAttributes<HTMLDivElement> & {
  readonly brand: ReactNode;
  readonly navItems?: readonly NavItem[];
  readonly topRight?: ReactNode;
  readonly sidebar?: ReactNode;
};

export function AppShell({ brand, children, className, navItems = [], sidebar, topRight, ...props }: AppShellProps) {
  return (
    <div {...props} className={cx("min-h-screen bg-slate-50 text-slate-950", className)}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4 px-4">
          <div className="min-w-0 text-sm font-semibold">{brand}</div>
          <Nav aria-label="Primary navigation" items={navItems} />
          {topRight ? <div className="shrink-0">{topRight}</div> : null}
        </div>
      </header>
      <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-slate-200 bg-white md:block">{sidebar ?? <Nav className="p-3" items={navItems} orientation="vertical" />}</aside>
        <main className="min-w-0 px-4 py-4 md:px-6">{children}</main>
      </div>
    </div>
  );
}

export type NavProps = HTMLAttributes<HTMLElement> & {
  readonly items: readonly NavItem[];
  readonly orientation?: "horizontal" | "vertical";
};

export function Nav({ className, items, orientation = "horizontal", ...props }: NavProps) {
  return (
    <nav
      {...props}
      className={cx(
        orientation === "horizontal" ? "hidden items-center gap-1 md:flex" : "grid gap-1",
        className,
      )}
    >
      {items.map((item) => (
        <NavLink active={item.active} href={item.href} key={item.href}>
          <span className="truncate">{item.label}</span>
          {item.badge ? <span className="ml-auto">{item.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export type NavLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly active?: boolean;
};

export function NavLink({ active = false, className, ...props }: NavLinkProps) {
  return (
    <a
      {...props}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
        focusRing,
        className,
      )}
    />
  );
}
