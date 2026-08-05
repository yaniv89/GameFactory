import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and sets aria-busy. The button stays disabled while loading. */
  loading?: boolean;
  /** Icon-only buttons must supply aria-label — enforced by the type, not just convention. */
  iconOnly?: boolean;
}

/**
 * Note on the six required states (CLAUDE.md 5.4): they describe a *view*
 * that fetches or holds data (a panel, a list, a page). A Button is an
 * atomic control, not a view — it has no "empty" or "offline" state of its
 * own. Its relevant states are default, hover, focus-visible, disabled, and
 * loading, all covered here and in Button.stories.tsx.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      loading = false,
      iconOnly = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const classes = [
      "fg-button",
      `fg-button--${variant}`,
      iconOnly ? "fg-button--icon-only" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading && <span className="fg-button__spinner" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
