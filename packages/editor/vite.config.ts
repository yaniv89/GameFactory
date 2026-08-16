import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const FIXTURE_PACKS_DIR = join(REPO_ROOT, "fixtures/packs");
const FIXTURE_CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
};

/**
 * Dev-server-only static serving for fixtures/packs/ (M6 Phase 4's Art
 * Pack wiring) — never wired into `build` (configureServer only runs
 * under `vite dev`/Playwright's dev server, not `vite build`), so fixture
 * content never ships in a production bundle. A real deployment fetches
 * real pack CDN URLs (docs/SPEC.md Section 10.6); this exists purely so
 * the resolver/rendering wiring has real files to fetch during
 * development and the real-browser Playwright suite.
 */
function serveFixturePacks(): Plugin {
  return {
    name: "forge-serve-fixture-packs",
    configureServer(server) {
      server.middlewares.use("/fixture-packs", (req, res, next) => {
        const requestPath = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const filePath = join(FIXTURE_PACKS_DIR, requestPath);
        // join() normalizes ".." segments before this check runs, so a
        // request trying to escape FIXTURE_PACKS_DIR resolves outside it
        // and is rejected here, not served.
        if (!filePath.startsWith(FIXTURE_PACKS_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }
        res.setHeader("Content-Type", FIXTURE_CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
        res.end(readFileSync(filePath));
      });
    },
  };
}

// Forge.Api's local dev port — see README.md's "Running the full stack
// locally" section. Not the editor's own port (5190, playwright.config.ts).
const API_DEV_PORT = 5080;
const API_DEV_ORIGIN = `http://localhost:${API_DEV_PORT}`;

export default defineConfig({
  plugins: [react(), serveFixturePacks()],
  // The preview page (preview.html) is loaded inside a sandboxed iframe
  // with no allow-same-origin, so the browser treats it as coming from an
  // opaque ("null") origin — and per spec, `<script type="module">`
  // fetches always go through CORS, which the dev server otherwise
  // doesn't answer for an Origin: null request. This is also the
  // production-correct shape: docs/SPEC.md's CDN already serves assets to
  // requests from other origins by design (10.6), so permissive CORS on
  // static/dev-server assets isn't a dev-only relaxation.
  server: {
    cors: true,
    // Local full-stack dev only (README.md) — proxies API/auth/collab
    // calls to Forge.Api so the browser sees one origin end to end.
    // Deliberately not CORS: the Identity cookie AuthEndpointsExtensions'
    // login flow sets is SameSite=Strict (Forge.Infrastructure's
    // DependencyInjection.cs), which a real cross-origin fetch — even
    // with credentials:"include" and a permissive CORS policy — would
    // never carry back to the server. Proxying, not relaxing SameSite,
    // is the fix: the browser never sees a cross-origin request in the
    // first place, so Strict cookies work exactly as intended.
    proxy: {
      "/api": API_DEV_ORIGIN,
      "/connect": API_DEV_ORIGIN,
      "/health": API_DEV_ORIGIN,
      "/hubs": { target: API_DEV_ORIGIN, ws: true },
    },
  },
  build: {
    outDir: "dist-app",
  },
});
