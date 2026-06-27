import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cx, focusRing } from "../utils.js";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly wrapperClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, hint, id, label, wrapperClassName, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("grid gap-1.5", wrapperClassName)}>
      {label ? (
        <label className="text-xs font-medium text-slate-700" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(
          "h-9 rounded-md border bg-white px-3 text-sm text-slate-950 shadow-sm transition-colors",
          "placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
          error ? "border-red-500" : "border-slate-200 hover:border-slate-300",
          focusRing,
          className,
        )}
        id={inputId}
        ref={ref}
      />
      {hint ? (
        <p className="text-xs text-slate-500" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-red-700" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
});
