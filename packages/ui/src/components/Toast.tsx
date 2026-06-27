import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils.js";

export type ToastProps = HTMLAttributes<HTMLDivElement> & {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
};

export function Toast({ action, className, description, role = "status", title, ...props }: ToastProps) {
  return (
    <div
      {...props}
      className={cx("flex w-full max-w-sm items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm shadow-lg", className)}
      role={role}
    >
      <div className="min-w-0">
        <p className="font-semibold text-slate-950">{title}</p>
        {description ? <p className="mt-1 text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
