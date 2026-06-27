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
    <div className="rounded-md border border-dashed border-line bg-field p-6 text-sm">
      <p className="font-semibold text-ink">{props.title}</p>
      <p className="mt-1 text-ink/70">{props.body}</p>
    </div>
  );
}

export function ErrorState(props: { readonly message: string }) {
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{props.message}</p>;
}

export function Shell(props: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8faf7] text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link className="font-semibold tracking-normal" href="/">CDP-US Console</Link>
          <nav className="flex gap-1 text-sm">
            {["Profiles", "Modules", "Connect"].map((item) => (
              <Link className="navlink" href={`/${item.toLowerCase()}`} key={item}>{item}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">{props.children}</main>
    </div>
  );
}
