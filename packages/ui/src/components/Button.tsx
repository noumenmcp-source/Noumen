import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, focusRing } from "../utils.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly isLoading?: boolean;
  readonly loadingLabel?: string;
  readonly leftSlot?: ReactNode;
  readonly rightSlot?: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "border-slate-950 bg-slate-950 text-white hover:bg-slate-800 active:bg-slate-900",
  secondary: "border-slate-200 bg-white text-slate-950 hover:border-slate-300 hover:bg-slate-50",
  ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-950",
  destructive: "border-red-700 bg-red-700 text-white hover:bg-red-600 active:bg-red-800",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
  lg: "h-10 gap-2 px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    isLoading = false,
    leftSlot,
    loadingLabel = "Loading",
    rightSlot,
    size = "md",
    type = "button",
    variant = "primary",
    ...props
  },
  ref,
) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      {...props}
      aria-busy={isLoading || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md border font-medium shadow-sm transition-colors",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55",
        focusRing,
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      disabled={isDisabled}
      ref={ref}
      type={type}
    >
      {isLoading ? <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> : leftSlot}
      <span>{isLoading ? loadingLabel : children}</span>
      {!isLoading ? rightSlot : null}
    </button>
  );
});
