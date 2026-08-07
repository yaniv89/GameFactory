/**
 * The origin the preview iframe trusts postMessage commands from. In dev,
 * the editor and the preview page are served from the same Vite dev
 * server, so this is genuinely `window.location.origin`. In production
 * they are served from two different origins by design (docs/SPEC.md
 * 10.6: `app.forge.dev` vs `play.forge.dev`/a per-game subdomain) — there
 * is no deployment config yet (M5) to source that from, so the real
 * production value is written here as a literal constant, not inferred
 * from `window.location`, which would silently accept messages from
 * whatever origin happens to be serving this bundle.
 */
export const TRUSTED_EDITOR_ORIGIN: string = import.meta.env.DEV ? window.location.origin : "https://app.forge.dev";
