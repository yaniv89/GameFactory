import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
  },
  build: {
    outDir: "dist-app",
  },
});
