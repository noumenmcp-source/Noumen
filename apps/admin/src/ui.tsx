"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearAdminToken, readAdminToken } from "./session";

const links = [
  { href: "/tenants", label: "Tenants" },
  { href: "/suppression", label: "Suppression" },
  { href: "/audit", label: "Audit" },
] as const;

export function Shell(props: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!readAdminToken()) router.replace("/login");
    setReady(true);
  }, [router]);

  if (!ready) return <main className="p-6">Loading admin session...</main>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/tenants" className="font-semibold">CDP-US Admin</Link>
          <nav aria-label="Admin navigation" className="flex gap-1">
            {links.map((link) => (
              <Link className={pathname.startsWith(link.href) ? "navlink bg-field text-ink" : "navlink"} href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <button className="navlink" type="button" onClick={() => { clearAdminToken(); router.replace("/login"); }}>
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">{props.children}</main>
    </div>
  );
}

export function EmptyState(props: { readonly title: string; readonly body: string }) {
  return (
    <section className="panel" aria-live="polite">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="mt-1 text-sm text-ink/70">{props.body}</p>
    </section>
  );
}

export function ErrorState(props: { readonly message: string }) {
  return <p className="rounded-md border border-danger/30 bg-white p-3 text-sm text-danger">{props.message}</p>;
}
