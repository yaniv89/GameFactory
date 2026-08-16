import { create } from "zustand";
import * as authClient from "./authClient";
import type { Session } from "./authClient";

export type AuthStatus = "signedOut" | "signingIn" | "signedIn" | "error";

export interface AuthState {
  readonly status: AuthStatus;
  readonly session: Session | undefined;
  readonly error: string | undefined;
  login(email: string, password: string): Promise<void>;
  signup(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  clearError(): void;
}

export const useAuthStore = create<AuthState>((set) => {
  authClient.onSessionChange((session) => {
    set({ session, status: session ? "signedIn" : "signedOut" });
  });

  return {
    status: authClient.getSession() ? "signedIn" : "signedOut",
    session: authClient.getSession(),
    error: undefined,

    async login(email, password) {
      set({ status: "signingIn", error: undefined });
      try {
        // Navigates the browser away to /connect/authorize on success —
        // there is no "signed in" state to set here in this tab; the
        // callback route (AuthCallback.tsx) picks up after the redirect
        // back and drives the session change that onSessionChange above
        // reacts to.
        await authClient.login(email, password);
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },

    async signup(email, password, displayName) {
      set({ status: "signingIn", error: undefined });
      try {
        await authClient.signup(email, password, displayName);
        await authClient.login(email, password);
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },

    async logout() {
      await authClient.logout();
      set({ status: "signedOut", session: undefined, error: undefined });
    },

    clearError() {
      set({ error: undefined });
    },
  };
});
