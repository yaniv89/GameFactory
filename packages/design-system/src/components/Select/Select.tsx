import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import "../Input/Input.css";
import "./Select.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
  placeholder?: string;
}

/**
 * Uses a native <select> deliberately (CLAUDE.md 2.2: "do not build a graph
 * library" extends in spirit to not rebuilding a listbox) — native selects
 * get correct keyboard, screen reader, and mobile behavior for free, which
 * a custom listbox would have to reimplement and re-test per platform.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, hint, error, placeholder, id, className, ...rest }, ref) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    const hintId = `${selectId}-hint`;
    const errorId = `${selectId}-error`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className="fg-field">
        <label
          htmlFor={selectId}
          className={`fg-field__label${rest.required ? " fg-field__label--required" : ""}`}
        >
          {label}
        </label>
        <div className="fg-select-wrap">
          <select
            ref={ref}
            id={selectId}
            className={["fg-select", className ?? ""].filter(Boolean).join(" ")}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            defaultValue={rest.value === undefined ? (rest.defaultValue ?? (placeholder ? "" : undefined)) : undefined}
            {...rest}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="fg-select-wrap__chevron" aria-hidden="true">
            ▾
          </span>
        </div>
        {error ? (
          <span id={errorId} className="fg-field__error" role="alert">
            {error}
          </span>
        ) : hint ? (
          <span id={hintId} className="fg-field__hint">
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);
Select.displayName = "Select";
