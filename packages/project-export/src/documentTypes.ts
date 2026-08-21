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
  /** References a `Prefab` (`@forge/core`) by id — not a closed union, per docs/adr/0015-entity-prefab-component-model.md. */
  readonly prefabId: string;
  readonly tileX: number;
  readonly tileY: number;
  /** Only meaningful for a prefab whose entity can speak — today, `"npc"` — the one-line dialogue it says on interact (Phase 7). */
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

/**
 * What a brand-new project starts with. `@forge/dialogue` and
 * `@forge/inventory` are first-party modules Forge itself ships — there is
 * no marketplace listing or "install" affordance for either yet in the
 * Modules panel — and the M4 exit criterion ("a first-time user builds a
 * walkable two-room map with a talking NPC in under 10 minutes, unaided")
 * depends on authoring dialogue on an NPC working without a detour through
 * module management first. Presence in `installedModules` is still the
 * real, load-bearing flag it always was: a creator who explicitly
 * uninstalls either (`uninstallModule`) gets exactly what that implies —
 * the live preview stops running it (`PreviewApp.tsx`'s own
 * `installedModules`-gated wiring), and `toExportProjectInput` refuses to
 * export a scene that still authors dialogue without the module installed
 * rather than silently dropping it (issue #123: preview and export must
 * agree on what "installed" means, not just export).
 */
export const DEFAULT_INSTALLED_MODULES: Record<string, InstalledModuleEntry> = {
  "@forge/dialogue": { config: {} },
  "@forge/inventory": { config: {} },
};

/**
 * One placed node in an authored graph — docs/adr/0017 Decision 1's "the
 * editor's own React Flow document (nodes, typed sockets, edges, per-node
 * config values)... is JSON." `type` matches a `GraphNodeDefinition.type`
 * from `@forge/graph-nodes-core` (M2) or, once M4 ships, a third-party
 * module's own registered node type — this package never imports either,
 * so it stays a plain string here, the same "referenced by id, not by
 * import" relationship `EntityPlacement.prefabId` already has with
 * `@forge/core`'s prefab registry.
 */
export interface GraphNodeInstance {
  readonly id: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly config: Readonly<Record<string, unknown>>;
}

/** One wire between two node sockets, addressed by node id + the socket's own `name` (`GraphSocketDefinition.name`) on each side. */
export interface GraphEdgeInstance {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
}

/**
 * A project can have many graphs (docs/adr/0017 Decision 2 — one quest,
 * one mechanic, one branching dialogue tree each) — this is one of them,
 * not the whole authored set.
 */
export interface GraphDocument {
  readonly id: string;
  readonly name: string;
  /** Mutable arrays holding readonly-fielded elements — same convention as `SceneSummary.entities`/`.tiles`: the editor's `applyCommand` pushes/splices in place; individual elements are replaced wholesale on change, never patched. */
  nodes: GraphNodeInstance[];
  edges: GraphEdgeInstance[];
}

/** docs/SPEC.md Section 7.3's `activePack`/`packOverrides`/`packTerrainRemap`; see `packages/editor/src/store/projectStore.ts` for the full field-by-field rationale — unchanged by the move. */
export interface ProjectDocument {
  scenes: SceneSummary[];
  /** Installed module name -> its config (+ marketplace pin, if any). Presence of the key is the install flag. */
  installedModules: Record<string, InstalledModuleEntry>;
  activePack: string | undefined;
  packOverrides: Record<string, string>;
  packTerrainRemap: Record<string, string>;
  /** Graph id -> its document — docs/adr/0017 (J1's node-graph authoring layer, M3). */
  graphs: Record<string, GraphDocument>;
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
 * A document persisted before `EntityPlacement.prefabId` existed carried
 * `kind: "player-start" | "npc"` instead — the pre-docs/adr/0015 shape.
 * `kind`'s value and `prefabId`'s value are the same strings by design
 * (`PLAYER_START_PREFAB.id === "player-start"`, `NPC_PREFAB.id === "npc"`
 * in `@forge/core`), so this migration is a pure field rename, not a value
 * remap — it changes no entity's rendered behavior.
 */
type LegacyEntityPlacement = Omit<EntityPlacement, "prefabId"> & { readonly kind?: "player-start" | "npc" };

function migrateEntityPlacement(entity: LegacyEntityPlacement): EntityPlacement {
  if ("prefabId" in entity && typeof (entity as Partial<EntityPlacement>).prefabId === "string") {
    return entity as EntityPlacement;
  }
  const { kind, ...rest } = entity;
  return { ...rest, prefabId: kind ?? "npc" };
}

/**
 * Fills in any field a partial/foreign document is missing — used both by
 * the editor's own `persist` rehydration and to normalize a document
 * fetched from `GetDocumentEndpoint` (can be `undefined` entirely, or an
 * older schema version than this build expects). Moved here unchanged,
 * except for one addition: `document === undefined` (the whole document,
 * not just one field of it missing) is the one case genuinely
 * distinguishable from "an existing document that happens to have no
 * installed modules" — that's what a brand-new project with no revisions
 * yet looks like, and only that case gets `DEFAULT_INSTALLED_MODULES`. An
 * existing document that was legitimately saved with an empty
 * `installedModules` (or an older-format document simply missing that one
 * field while the rest of it is real, already-authored content) still
 * normalizes to `{}`, exactly as before — this migration only fills in
 * missing *shape*, never edits what an existing document actually decided.
 */
export function migrateDocument(document: Partial<ProjectDocument> | undefined): ProjectDocument {
  const installedModules = document?.installedModules ?? (document === undefined ? DEFAULT_INSTALLED_MODULES : {});
  return {
    scenes: (document?.scenes ?? []).map((scene) => ({
      ...scene,
      tiles: scene.tiles ?? emptyTiles(),
      entities: (scene.entities ?? []).map((entity) => migrateEntityPlacement(entity as LegacyEntityPlacement)),
    })),
    installedModules: Object.fromEntries(
      Object.entries(installedModules).map(([name, value]) => [name, migrateInstalledModuleEntry(value)]),
    ),
    activePack: document?.activePack,
    packOverrides: document?.packOverrides ?? {},
    packTerrainRemap: document?.packTerrainRemap ?? {},
    graphs: document?.graphs ?? {},
  };
}
