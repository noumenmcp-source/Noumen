import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { cx, focusRing } from "../utils.js";

export type SelectOption = {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
};

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly wrapperClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, error, hint, id, label, options, placeholder, wrapperClassName, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("grid gap-1.5", wrapperClassName)}>
      {label ? (
        <label className="text-xs font-medium text-slate-700" htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(
          "h-9 rounded-md border bg-white px-3 text-sm text-slate-950 shadow-sm transition-colors",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
          error ? "border-red-500" : "border-slate-200 hover:border-slate-300",
          focusRing,
          className,
        )}
        id={selectId}
        ref={ref}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
