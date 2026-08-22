import type { ArtPackManifest } from "@forge/art-pack";

/**
 * What a `forge export` bundle actually embeds — deliberately its own,
 * independent type, not imported from `packages/editor`'s `ProjectDocument`
 * (the player app cannot depend on the editor app; the relationship runs
 * the other way, export-time conversion in the CLI, M6 Phase 5e). Structurally
 * close to `ProjectDocument` on purpose so that conversion is a close-to-
 * mechanical mapping, not a redesign.
 */
export interface PlayerEntityPlacement {
  readonly id: string;
  /** References a `Prefab` (`@forge/core`) by id — not a closed union, per docs/adr/0015-entity-prefab-component-model.md. */
  readonly prefabId: string;
  readonly tileX: number;
  readonly tileY: number;
  /**
   * Presence alone is what `bootGameLogic` acts on — it decides whether
   * this NPC gets a dialogue-tracking entity created at all. The actual
   * line content is never read here: it already went into this module's
   * own `config.trees` (see `PlayerInstalledModule.config`) at export
   * time, keyed by this placement's own `id` as the tree id, the same
   * `treeId == placementId` convention `packages/editor/src/preview/PreviewApp.tsx`'s
   * `rebuildDialogueRuntime` already uses for the unsandboxed preview.
   * Kept here anyway (not dropped) so a `PlayerProjectData` stays
   * self-describing without cross-referencing module config to answer
   * "does this NPC talk" — a deliberate, explained duplication, not an
   * oversight. `unknown` rather than a shaped type: since only presence
   * is ever read, this field's actual shape is free to evolve on the
   * editor/export side (docs/adr/0018 Decision 2 widened it from
   * `{speaker, text}` to a real branching tree) without this package
   * needing a matching change it would never use.
   */
  readonly dialogue?: unknown;
}

export interface PlayerScene {
  readonly id: string;
  readonly name: string;
  /** Row-major (`y * gridWidth + x`), same convention as the editor's `SceneSummary.tiles`. */
  readonly tiles: readonly number[];
  readonly entities: readonly PlayerEntityPlacement[];
}

export interface PlayerInstalledModule {
  readonly name: string;
  readonly version: string;
  /** Already fully shaped for this module's own `setup(ctx)` — e.g. `@forge/dialogue`'s `{ trees: [...] }` — never raw editor-side data the player would have to reinterpret. */
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * The module's own compiled, `__forge_registerModule(...)`-calling
   * guest bundle text (e.g. `@forge/dialogue`'s own `dist/guest-bundle.js`,
   * built by that package's `build:guest` script) — embedded at export
   * time, never fetched at runtime. This is what `ModuleBridge.setup()`
   * actually evaluates inside the real QuickJS sandbox.
   */
  readonly guestBundleSource: string;
}

/**
 * K1 Phase 2b: the active Art Pack's own manifest plus every asset this
 * export actually resolved for it, base64-embedded as `data:` URIs at
 * export time — no runtime fetch, matching `guestBundleSource`'s and
 * `WASM_BINARY_BASE64`'s own "no network, ever" contract for an exported
 * game (docs/security/THREAT-MODEL.md's play-origin isolation extends to
 * this: a `file://`-opened build has no origin to fetch pack assets from
 * even if it wanted to).
 *
 * Scoped to exactly what `packTiles.ts`/`characterTextures.ts` (the
 * editor's own pack-aware rendering) resolve for a *ground tileset* and
 * *character sheets* — tier 3 ("active pack") of docs/SPEC.md Section
 * 11.4's five-tier resolution only. Project overrides/uploaded assets/
 * module-bundled assets have no meaning for a frozen, already-built
 * export the way they do for a live, still-editable project, so they're
 * out of scope here, not silently dropped. Mount/weapon art (K1 Phase 2,
 * #177/#178) is a separate, still-pending gap this does not close.
 */
export interface PlayerPackData {
  readonly name: string;
  readonly manifest: ArtPackManifest;
  /** Keyed by the manifest-relative path exactly as declared (e.g. `"tilesets/outdoor-base.png"`, `"characters/hero_walk.png"`) — only paths this export actually resolved and embedded appear here; a declared-but-unresolved path is simply absent, the same "falls back to the placeholder" honesty `resolveAsset`'s own `found: false` case already establishes. */
  readonly assets: Readonly<Record<string, string>>;
}

export interface PlayerProjectData {
  readonly projectId: string;
  /** Whatever `forge export` was run against — a save file records which build produced it (SaveFile.buildId, docs/SPEC.md Section 8.5), independent of the engine version. */
  readonly buildId: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly scenes: readonly PlayerScene[];
  readonly installedModules: readonly PlayerInstalledModule[];
  /**
   * Every data table in the project (docs/adr/0018 Decision 3) — table id
   * -> its rows only (no `columns`/`name`; nothing at runtime reads those,
   * see `documentTypes.ts`'s own `DataTableDefinition` doc comment).
   * Delivered to every installed module's own `SetupContext.dataTables`
   * identically — a project-wide resource, not per-module config, so it
   * lives here rather than inside any one `PlayerInstalledModule.config`.
   */
  readonly dataTables: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /**
   * Which scene to boot into. Always the first scene in practice today —
   * the editor itself has no scene-tab/"active scene" concept yet either
   * (`SceneCanvas.tsx`'s own doc comment) — but named explicitly rather
   * than implied by array order, so a future multi-scene export doesn't
   * need a `PlayerProjectData` shape change to say which one starts.
   */
  readonly startSceneId: string;
  /** Absent when the project had no active pack, or the CLI couldn't resolve one for it (a warning is printed at export time either way — see `resolvePackData`, packages/cli/src/commands/export.ts) — the renderer's own placeholder-color/marker fallback (`tilePalette.ts`, `entityMarkers.ts`) is what actually renders in that case. */
  readonly pack?: PlayerPackData;
}
