/**
 * The editor's ProjectDocument shape — moved here verbatim from
 * `packages/editor/src/store/projectStore.ts` (docs/adr/0009) so the
 * document format has a home neither the CLI nor a future server build
 * worker has to depend on the whole editor SPA to read. `projectStore.ts`
 * re-exports everything here; nothing outside that one file needed to
 * change import paths.
 */

/** A scene's fixed grid dimensions — a document-format fact, not a rendering one. `packages/editor/src/canvas/gridConstants.ts`'s own `TILE_SIZE` (a pixel/rendering concern) stays there. */
export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 15;

export function emptyTiles(): number[] {
  return new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
}

export interface EntityDialogue {
  readonly speaker: string;
  readonly text: string;
}

export interface EntityPlacement {
  readonly id: string;
  readonly kind: "player-start" | "npc";
  readonly tileX: number;
  readonly tileY: number;
  /** Only meaningful for `kind: "npc"` — the one-line dialogue it says on interact (Phase 7). */
  readonly dialogue?: EntityDialogue;
}

export interface SceneSummary {
  readonly id: string;
  readonly name: string;
  /**
   * Not `readonly EntityPlacement[]`: mirrors `ProjectDocument.scenes`
   * itself, a plain mutable array holding readonly-fielded objects —
   * the editor's `applyCommand` mutates the array in place (push/splice),
   * while individual entities are replaced wholesale on change, never
   * patched.
   */
  entities: EntityPlacement[];
  /** Row-major (`y * GRID_WIDTH + x`), one tile id per cell. */
  tiles: number[];
}

/**
 * A module's config values, plus — only for a marketplace-sourced module —
 * the published version, bundle URL, and bundle hash it was installed at.
 * First-party modules never carry `marketplace`: their version and guest
 * bundle are resolved from `packages/player`'s own `node_modules` at
 * export time, the same as before this field existed. A marketplace
 * package has no local `node_modules` entry to resolve either from, so it
 * must pin both explicitly at install time instead. `bundleSha256Hex`
 * travels all the way to `forge export`'s own HTTP fetch of `bundleUrl`
 * (packages/cli/src/commands/export.ts), which verifies the fetched bytes
 * against it before feeding them to the sandbox — the CLI/build-time
 * equivalent of the Subresource-Integrity check the runtime already gets
 * for browser-side dependency loading (`DependencyResolver.cs`).
 */
export interface InstalledModuleEntry {
  readonly config: Record<string, string | number | boolean>;
  readonly marketplace?: { readonly version: string; readonly bundleUrl: string; readonly bundleSha256Hex: string };
}

/** docs/SPEC.md Section 7.3's `activePack`/`packOverrides`/`packTerrainRemap`; see `packages/editor/src/store/projectStore.ts` for the full field-by-field rationale — unchanged by the move. */
export interface ProjectDocument {
  scenes: SceneSummary[];
  /** Installed module name -> its config (+ marketplace pin, if any). Presence of the key is the install flag. */
  installedModules: Record<string, InstalledModuleEntry>;
  activePack: string | undefined;
  packOverrides: Record<string, string>;
  packTerrainRemap: Record<string, string>;
}

/**
 * A document persisted before `InstalledModuleEntry` existed stored each
 * installed module's config directly (`Record<string, string | number |
 * boolean>`), not wrapped in `{ config }` — this is exactly what
 * `InstalledModuleEntry` itself no longer is, since a real config value is
 * never an object. Used only to recognize that old shape during migration.
 */
type LegacyModuleConfig = Record<string, string | number | boolean>;

function isLegacyModuleConfig(value: LegacyModuleConfig | InstalledModuleEntry): value is LegacyModuleConfig {
  const config = (value as Partial<InstalledModuleEntry>).config;
  return typeof config !== "object" || config === null;
}

/** Migrates one `installedModules` entry from the pre-`InstalledModuleEntry` flat-config shape to the current one, wrapping it as `{ config: <the old value> }` — a first-party module re-saved under the old shape has no marketplace pin to lose, so this is a lossless upgrade. */
function migrateInstalledModuleEntry(value: LegacyModuleConfig | InstalledModuleEntry): InstalledModuleEntry {
  return isLegacyModuleConfig(value) ? { config: value } : value;
}

/**
 * Fills in any field a partial/foreign document is missing — used both by
 * the editor's own `persist` rehydration and to normalize a document
 * fetched from `GetDocumentEndpoint` (can be `undefined` entirely, or an
 * older schema version than this build expects). Moved here unchanged.
 */
export function migrateDocument(document: Partial<ProjectDocument> | undefined): ProjectDocument {
  const installedModules = document?.installedModules ?? {};
  return {
    scenes: (document?.scenes ?? []).map((scene) => ({ ...scene, tiles: scene.tiles ?? emptyTiles() })),
    installedModules: Object.fromEntries(
      Object.entries(installedModules).map(([name, value]) => [name, migrateInstalledModuleEntry(value)]),
    ),
    activePack: document?.activePack,
    packOverrides: document?.packOverrides ?? {},
    packTerrainRemap: document?.packTerrainRemap ?? {},
  };
}
