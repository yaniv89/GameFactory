import { useState, type FC } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@forge/ds/dist/global.css";
import { App } from "./App";
import { AuthCallback } from "./auth/AuthCallback";
import { AuthGate } from "./auth/AuthGate";

const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Decides between the OAuth callback exchange and the normal
 * (auth-gated) app shell by `window.location.pathname` — see
 * `AuthCallback.tsx`'s own doc comment for why this isn't a router
 * route. `pathname` is local component state, not read fresh on every
 * render, specifically so `AuthCallback`'s `onDone` can switch back to
 * the app shell via a plain state update instead of a page reload
 * (`history.replaceState` alone doesn't trigger a re-render).
 */
const Root: FC = () => {
  const [pathname, setPathname] = useState(window.location.pathname);

  if (pathname === AUTH_CALLBACK_PATH) {
    return (
      <AuthCallback
        onDone={() => {
          window.history.replaceState(null, "", "/");
          setPathname("/");
        }}
      />
    );
  }

  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
};

const container = document.getElementById("root");
if (!container) {
  throw new Error("forge-editor: #root element not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
