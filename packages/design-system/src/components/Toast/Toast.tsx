import { useEffect } from "react";
import "./Toast.css";

export type ToastVariant = "info" | "success" | "error" | "caution";

export interface ToastDef {
  id: string;
  variant: ToastVariant;
  message: string;
  /** ms until auto-dismiss. undefined = stays until manually dismissed. */
  duration?: number;
}

export interface ToastProps {
  toast: ToastDef;
  onDismiss: (id: string) => void;
}

/**
 * A single toast. `error` variant uses aria-live="assertive" (interrupts);
 * everything else uses "polite" (CLAUDE.md 5.6: assertive only for errors
 * that block work).
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast.duration) return;
    const t = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className={`fg-toast fg-toast--${toast.variant}`}
      role="status"
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
    >
      <span className="fg-toast__body">{toast.message}</span>
      <button
        type="button"
        className="fg-toast__dismiss"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}

export interface ToastViewportProps {
  toasts: ToastDef[];
  onDismiss: (id: string) => void;
}

/**
 * Empty state here is simply rendering nothing — an empty toast stack is
 * not an error, it is the default. That is a deliberate exception to the
 * "always design an empty state" rule: there is nothing a person needs to
 * be told when there are no notifications.
 */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fg-toast-viewport">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
