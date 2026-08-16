import { Button, Input } from "@forge/ds";
import { useState, type FC, type FormEvent } from "react";
import { useAuthStore } from "./authStore";
import "./LoginView.css";

/**
 * Gates the editor shell (`main.tsx`) until a real session exists.
 * Six-state note (CLAUDE.md 5.4, same nuance `Input.tsx`'s own doc
 * comment states): this is a single atomic form, not a data view — the
 * states that actually apply are Loading (submitting) and Error (the
 * request failed); Empty/PermissionDenied/Offline don't describe a
 * sign-in form's own content.
 */
export const LoginView: FC = () => {
  const { status, error, login, signup, clearError } = useAuthStore();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const submitting = status === "signingIn";

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (mode === "login") {
      void login(email, password);
    } else {
      void signup(email, password, displayName);
    }
  };

  return (
    <div className="fg-login">
      <div className="fg-login__card">
        <h1 className="fg-login__title">{mode === "login" ? "Sign in to Forge" : "Create your Forge account"}</h1>
        <form className="fg-login__form" onSubmit={handleSubmit}>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode === "signup" && (
            <Input
              label="Display name"
              autoComplete="nickname"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <Input
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="fg-login__error" role="alert">
              Sign-in failed: {error}. Check your email and password and try again.
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <button
          type="button"
          className="fg-login__toggle"
          onClick={() => {
            clearError();
            setMode(mode === "login" ? "signup" : "login");
          }}
        >
          {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
};
