import type { HTMLAttributes } from "react";
import { cx } from "../utils.js";

export type SpinnerSize = "sm" | "md" | "lg";

export type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  readonly size?: SpinnerSize;
  readonly label?: string;
};

const sizeClass: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export function Spinner({ className, label = "Loading", role = "status", size = "md", ...props }: SpinnerProps) {
  return (
    <span {...props} aria-label={label} className={cx("inline-flex items-center justify-center", className)} role={role}>
      <span aria-hidden="true" className={cx("animate-spin rounded-full border-2 border-slate-300 border-r-slate-950", sizeClass[size])} />
    </span>
  );
}
