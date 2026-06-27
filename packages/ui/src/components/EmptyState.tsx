import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils.js";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  readonly title: ReactNode;
  readonly message: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
};

export function EmptyState({ action, className, icon, message, role = "status", title, ...props }: EmptyStateProps) {
  return (
    <div
      {...props}
      className={cx("grid place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center", className)}
      role={role}
    >
      <div className="max-w-sm">
        {icon ? <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm">{icon}</div> : null}
        <p className="text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}
