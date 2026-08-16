import { useState, type FC } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@forge/ds/dist/global.css";
import type { ProjectSummary } from "./api/projectsApi";
import { App } from "./App";
import { AuthCallback } from "./auth/AuthCallback";
import { AuthGate } from "./auth/AuthGate";
import { ProjectsListViewContainer } from "./project/ProjectsListViewContainer";
import { useProjectSyncStore } from "./project/projectSyncStore";

const AUTH_CALLBACK_PATH = "/auth/callback";

declare global {
  interface Window {
    /**
     * Dev-only escape hatch for `test-browser/*.spec.ts` — those specs
     * (SceneCanvas, pack-swap, preview bridge, the M4 walkable-demo exit
     * criterion) exercise canvas/rendering behavior that predates the
     * auth/project wiring and run with no `Forge.Api` backend at all
     * (`playwright.config.ts`'s `webServer` is just `vite`), so there is
     * nothing for them to sign in against. Guarded by `import.meta.env.DEV`
     * below — Vite dead-code-eliminates the whole branch in a production
     * build, the same "test-only hook, never shipped" pattern
     * `SceneCanvas.tsx`'s own `__forgeSceneCanvasDebug` already uses.
     */
    __FORGE_E2E_SKIP_AUTH__?: boolean;
  }
}

/**
 * Signed-in but no project chosen yet -> the project list; a project
 * chosen -> the editor shell. Local state (not a route) for the same
 * reason `Root` itself isn't a router: no router package is in CLAUDE.md's
 * pinned frontend stack (Section 2.2), and this is the only other
 * "screen" the editor has.
 */
const AuthedShell: FC = () => {
  const [openProject, setOpenProject] = useState<ProjectSummary | undefined>(undefined);
  const { openProject: loadProjectDocument, closeProject } = useProjectSyncStore();

  if (!openProject) {
    return (
      <ProjectsListViewContainer
        onOpenProject={(project) => {
          setOpenProject(project);
          void loadProjectDocument(project.id, project.title);
        }}
      />
    );
  }

  return (
    <App
      projectTitle={openProject.title}
      onCloseProject={() => {
        closeProject();
        setOpenProject(undefined);
      }}
    />
  );
};

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

  if (import.meta.env.DEV && window.__FORGE_E2E_SKIP_AUTH__) {
    return <App />;
  }

  return (
    <AuthGate>
      <AuthedShell />
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
