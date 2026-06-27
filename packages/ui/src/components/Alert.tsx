import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils.js";

export type AlertVariant = "info" | "success" | "warning" | "danger";

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  readonly variant?: AlertVariant;
  readonly title?: ReactNode;
};

const variantClass: Record<AlertVariant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-red-200 bg-red-50 text-red-950",
};

export function Alert({ children, className, role, title, variant = "info", ...props }: AlertProps) {
  return (
    <div
      {...props}
      className={cx("rounded-md border px-3 py-2 text-sm", variantClass[variant], className)}
      role={role ?? (variant === "danger" || variant === "warning" ? "alert" : "status")}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cx(title ? "mt-1" : undefined, "opacity-80")}>{children}</div> : null}
    </div>
  );
}
