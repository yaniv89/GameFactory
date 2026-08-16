import { useEffect, useState, type FC } from "react";
import { completeLoginFromCallback } from "./authClient";

type CallbackStatus = "exchanging" | "error";

export interface AuthCallbackProps {
  /**
   * Called once the token exchange succeeds. Deliberately NOT a
   * `window.location` navigation: this is a same-SPA-instance handoff,
   * not a real page load — a full navigation here would reload the JS
   * module graph and wipe the in-memory session `completeLoginFromCallback`
   * just set (authClient.ts's whole design point: the access/refresh
   * tokens live only in that module's own memory, never anywhere a
   * reload could either usefully restore or an attacker could read).
   * The caller (`main.tsx`'s `Root`) instead does a silent
   * `history.replaceState` and re-renders `<App>` in place.
   */
  onDone(): void;
}

/**
 * Rendered only when the browser has just landed on `/auth/callback`
 * (see `main.tsx`) — this is the OAuth Authorization Code redirect
 * target `login()` in `authClient.ts` sends the browser to
 * `/connect/authorize` expecting back. No router package is used (not
 * in CLAUDE.md Section 2.2's pinned stack): `main.tsx` picks this
 * component instead of `<App />` by checking `window.location.pathname`
 * directly, the whole reason this is its own small entry point rather
 * than a route.
 */
export const AuthCallback: FC<AuthCallbackProps> = ({ onDone }) => {
  const [status, setStatus] = useState<CallbackStatus>("exchanging");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    completeLoginFromCallback(new URL(window.location.href))
      .then(() => {
        if (cancelled) return;
        onDone();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Deliberately empty deps: this exchange must run exactly once, on
    // mount, regardless of onDone's identity across renders.
  }, []);

  if (status === "error") {
    return (
      <div className="fg-auth-callback" role="alert">
        <h1>Sign-in failed</h1>
        <p>{error}</p>
        <p>What happened: the sign-in redirect from the server did not complete successfully. What to do: return to the sign-in page and try again.</p>
        <a href="/">Back to sign in</a>
      </div>
    );
  }

  return (
    <div className="fg-auth-callback" aria-busy="true">
      <p>Finishing sign-in…</p>
    </div>
  );
};
