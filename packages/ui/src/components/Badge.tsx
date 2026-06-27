import type { HTMLAttributes } from "react";
import { cx } from "../utils.js";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly variant?: BadgeVariant;
};

const variantClass: Record<BadgeVariant, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cx("inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium", variantClass[variant], className)}
    />
  );
}
