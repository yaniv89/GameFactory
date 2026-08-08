/**
 * docs/SPEC.md Section 11.4's five-tier asset resolution order — the
 * "child-theme mechanism," highest priority wins:
 *
 * 1. Project override      overrides/{activePackName}/{path}
 * 2. Project-uploaded asset assets/{path}
 * 3. Active Art Pack        the active pack's own file at {path}, if it declares one
 * 4. Module-bundled asset   {moduleName} -> {path} (e.g. a weather module's own overlays/rain.png)
 * 5. Engine default placeholder — never a silent failure.
 *
 * Deliberately data-only: this resolves *which URL wins*, not how a
 * missing one gets drawn (a magenta placeholder texture is a
 * packages/render-2d concern) or logged (a structured warning is the
 * caller's job, using this result's `assetId`/`found` fields) — kept
 * separate so this logic is testable without Pixi or a DOM.
 */

export interface AssetSource {
  /** Base URL/prefix this source's paths resolve relative to — joined with the asset path, never used alone. */
  readonly baseUrl: string;
}

export interface ActivePackAssetSource extends AssetSource {
  /**
   * The active pack's own declared asset paths (every `tilesets.*.src`,
   * `characters.sheets.*`, `ui.skin`, etc. from its manifest) — tier 3
   * only "wins" for a path the pack actually declares. A path a
   * project's scene references that the *current* pack doesn't declare
   * (the exact case docs/SPEC.md Section 11.5's pack-swap diff calls out
   * — "3 props have no equivalent... render as placeholders until
   * remapped") must fall through to tier 4/5, not silently resolve to a
   * nonexistent file at this pack's base URL.
   */
  readonly declaredPaths: ReadonlySet<string>;
}

export interface AssetResolutionContext {
  /** The active pack's own name, e.g. `@pixelfoundry/fantasy-pack` — the key namespace tier 1's overrides live under. Undefined when no pack is installed. */
  readonly activePackName?: string;
  /** Keyed `{packName}/{path}` (tier 1). */
  readonly projectOverrides: ReadonlyMap<string, AssetSource>;
  /** Keyed by path alone (tier 2) — the project's own uploaded library, independent of any pack. */
  readonly projectAssets: ReadonlyMap<string, AssetSource>;
  /** Tier 3. Undefined when no pack is installed. */
  readonly activePack?: ActivePackAssetSource;
  /** Keyed `{moduleName}/{path}` (tier 4). */
  readonly moduleBundledAssets: ReadonlyMap<string, AssetSource>;
}

export type AssetResolutionSource = "project-override" | "project-asset" | "active-pack" | "module-bundled" | "placeholder";

export interface AssetResolutionResult {
  readonly found: boolean;
  readonly url: string;
  readonly source: AssetResolutionSource;
  /** `path`, or `{moduleName}::{path}` for a module-scoped lookup — stable identity for a structured warning and the placeholder's on-screen label, present on every result including a miss. */
  readonly assetId: string;
}

/** Never a real URL a renderer could accidentally treat as resolvable — see packages/render-2d's own placeholder-texture wiring (a later phase) for what actually draws for this. */
export const PLACEHOLDER_ASSET_URL = "engine://placeholder/magenta";

/**
 * Resolves `path` (a pack-relative asset path, e.g. `tilesets/outdoor-base.png`)
 * against the five tiers above. Pass `moduleName` only when resolving an
 * asset a specific installed module bundles (docs/SPEC.md Section 11.4's
 * `@acme/weather-system -> overlays/rain.png` example) — omitted, tier 4
 * is skipped entirely rather than guessing which module might own the
 * path, since ordinary pack content (tiles, character sheets, UI, audio)
 * has no owning module at all.
 */
export function resolveAsset(path: string, context: AssetResolutionContext, moduleName?: string): AssetResolutionResult {
  const assetId = moduleName ? `${moduleName}::${path}` : path;

  if (context.activePackName) {
    const override = context.projectOverrides.get(`${context.activePackName}/${path}`);
    if (override) {
      return { found: true, url: joinUrl(override.baseUrl, path), source: "project-override", assetId };
    }
  }

  const projectAsset = context.projectAssets.get(path);
  if (projectAsset) {
    return { found: true, url: joinUrl(projectAsset.baseUrl, path), source: "project-asset", assetId };
  }

  if (context.activePack && context.activePack.declaredPaths.has(path)) {
    return { found: true, url: joinUrl(context.activePack.baseUrl, path), source: "active-pack", assetId };
  }

  if (moduleName) {
    const moduleAsset = context.moduleBundledAssets.get(`${moduleName}/${path}`);
    if (moduleAsset) {
      return { found: true, url: joinUrl(moduleAsset.baseUrl, path), source: "module-bundled", assetId };
    }
  }

  return { found: false, url: PLACEHOLDER_ASSET_URL, source: "placeholder", assetId };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${trimTrailingSlashes(baseUrl)}/${trimLeadingSlashes(path)}`;
}

// Manual, regex-free trimming — a CodeQL high-severity alert flagged the
// previous regex-based version (`/\/+$/`, `/^\/+/`) as a polynomial
// ReDoS risk on uncontrolled input (baseUrl/path can originate from a
// third-party pack or module manifest). Both patterns were actually
// linear in practice, but there's no reason to argue the point when a
// loop is just as clear and removes the question entirely.
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

function trimLeadingSlashes(value: string): string {
  let start = 0;
  while (start < value.length && value[start] === "/") start++;
  return value.slice(start);
}
