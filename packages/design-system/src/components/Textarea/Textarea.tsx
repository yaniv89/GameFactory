import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import "../Input/Input.css";
import "./Textarea.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  /** Shown below the field when there is no error. */
  hint?: string;
  /** Non-empty means invalid. Structure follows CLAUDE.md 5.6: what, why, what to do. */
  error?: string;
}

/**
 * Multi-line sibling of `Input` — same field markup (label, hint/error,
 * `fg-field` layout), same token usage, for the one real gap `Input`'s own
 * `InputHTMLAttributes<HTMLInputElement>` can't cover: free-text longer
 * than a single line (the art-generation "describe it" prompt, N5, is the
 * first caller). Six-state note is the same as `Input`'s own: an atomic
 * control, not a view — the framework applies to the view this field
 * lives in.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, id, className, rows = 4, ...rest }, ref) => {
    const autoId = useId();
    const textareaId = id ?? autoId;
    const hintId = `${textareaId}-hint`;
    const errorId = `${textareaId}-error`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className="fg-field">
        <label
          htmlFor={textareaId}
          className={`fg-field__label${rest.required ? " fg-field__label--required" : ""}`}
        >
          {label}
        </label>
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={["fg-input", "fg-textarea", className ?? ""].filter(Boolean).join(" ")}
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
Textarea.displayName = "Textarea";
