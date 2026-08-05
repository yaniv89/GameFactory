import { forwardRef, useId, type InputHTMLAttributes } from "react";
import "./Input.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Shown below the field when there is no error. */
  hint?: string;
  /** Non-empty means invalid. Structure follows CLAUDE.md 5.6: what, why, what to do. */
  error?: string;
}

/**
 * Six-state note: like Button, Input is an atomic control. Its natural
 * states — default, focus, disabled, and invalid (error) — are implemented
 * here. The six-state framework applies to the *view* the field lives in
 * (e.g. a form that is still loading its initial values), not the field
 * itself.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, id, className, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className="fg-field">
        <label
          htmlFor={inputId}
          className={`fg-field__label${rest.required ? " fg-field__label--required" : ""}`}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={["fg-input", className ?? ""].filter(Boolean).join(" ")}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...rest}
        />
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
Input.displayName = "Input";
