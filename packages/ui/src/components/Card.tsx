import type { HTMLAttributes } from "react";
import { cx } from "../utils.js";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return <section {...props} className={cx("rounded-md border border-slate-200 bg-white shadow-sm", className)} />;
}

export function CardHeader({ className, ...props }: CardProps) {
  return <div {...props} className={cx("border-b border-slate-100 px-4 py-3", className)} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} className={cx("text-sm font-semibold text-slate-950", className)} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={cx("mt-1 text-xs text-slate-500", className)} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <div {...props} className={cx("px-4 py-3", className)} />;
}

export function CardFooter({ className, ...props }: CardProps) {
  return <div {...props} className={cx("border-t border-slate-100 px-4 py-3", className)} />;
}
