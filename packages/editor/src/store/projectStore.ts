import { current } from "immer";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  GRID_WIDTH,
  emptyTiles,
  migrateDocument as migrateDocumentShape,
  type EntityDialogue,
  type EntityPlacement,
  type ProjectDocument,
  type SceneSummary,
} from "@forge/project-export";
import type { FormValues } from "../inspector/jsonSchema";

// Re-exported so every existing importer of these types from this module
// (11 files across the editor) keeps working unchanged — the types
// themselves moved to @forge/project-export (docs/adr/0009) so the CLI
// and a future server build worker can depend on the document shape
// without depending on the whole editor SPA.
export type { EntityDialogue, EntityPlacement, ProjectDocument, SceneSummary };

/**
 * docs/SPEC.md Section 11.5's "automatic named checkpoint before
 * applying" a pack swap, plus "one-click restore". Deliberately a
 * separate, named, arbitrarily-long-lived snapshot rather than a spot in
 * the undo/redo stack: `past`/`future` only cover the most recent edits
 * and are trimmed by every subsequent action, so undo alone can't
 * promise "get back to right before that swap" once other edits happen
 * after it. Not itself a `ProjectCommand` — creating one doesn't change
 * the document, so it isn't undo/redo material (the same reasoning that
 * keeps `selection` out of the command log).
 */
export interface PackSwapCheckpoint {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly document: ProjectDocument;
}

/**
 * Serializable, not closures. This is what makes the log persistable
 * (CLAUDE.md 5.3: "Undo has no ceiling within a session and survives
 * reload") and is the same shape M7's Yjs/CRDT relay will eventually need
 * to send ops over the wire — reusing it now instead of inventing a second
 * representation later.
 */
type ProjectCommand =
  | { readonly type: "scene/create"; readonly sceneId: string; readonly name: string }
  | { readonly type: "scene/delete"; readonly sceneId: string; readonly name: string }
  | { readonly type: "scene/rename"; readonly sceneId: string; readonly name: string }
  // Also doubles as "set this installed module's config": applying it
  // upserts unconditionally, so installing and reconfiguring are the same
  // primitive operation. `marketplace` is only ever set at install time
  // (a reconfigure carries forward whatever was already there, never sets
  // it fresh) — see installModule/configureModule below.
  | {
      readonly type: "module/install";
      readonly moduleName: string;
      readonly config: FormValues;
      readonly marketplace?: { readonly version: string; readonly bundleUrl: string; readonly bundleSha256Hex: string };
    }
  | { readonly type: "module/uninstall"; readonly moduleName: string }
  | { readonly type: "entity/add"; readonly sceneId: string; readonly entity: EntityPlacement }
  | { readonly type: "entity/delete"; readonly sceneId: string; readonly entityId: string }
  | { readonly type: "entity/configure"; readonly sceneId: string; readonly entityId: string; readonly dialogue: EntityDialogue | undefined }
  // Only one player-start per scene: `entity` undefined means "no player
  // start". Self-inverse-shaped like scene/rename — the inverse just
  // carries whatever the previous value was, including undefined.
  | { readonly type: "entity/set-player-start"; readonly sceneId: string; readonly entity: EntityPlacement | undefined }
  // One cell, one command — the same "forward carries the new value,
  // inverse carries whatever was there before" shape as every other
  // field here, just addressed by a flat grid index instead of a key.
  | { readonly type: "scene/paint-tile"; readonly sceneId: string; readonly index: number; readonly tileId: number }
  // `packName` undefined means "no Art Pack active" — same self-inverse
  // shape as entity/set-player-start.
  | { readonly type: "pack/set-active"; readonly packName: string | undefined }
  // `url` undefined clears the override at `path` — same shape again.
  | { readonly type: "pack/set-override"; readonly path: string; readonly url: string | undefined }
  // `targetTag` undefined clears the remap for `sourceTag` — same shape again.
  | { readonly type: "pack/set-terrain-remap"; readonly sourceTag: string; readonly targetTag: string | undefined }
  // Restoring a checkpoint (docs/SPEC.md Section 11.5): forward carries
  // the checkpoint's whole document, inverse carries whatever the
  // document was immediately before the restore — same self-inverse
  // shape as every other command, just at document granularity instead
  // of a single field.
  | { readonly type: "document/replace"; readonly document: ProjectDocument };

interface HistoryEntry {
  readonly forward: ProjectCommand;
  readonly inverse: ProjectCommand;
}

/**
 * The only place that mutates the document. Every command must be
 * self-inverting-by-construction: whoever dispatches one also supplies its
 * exact inverse (see createScene below), so undo/redo never need to
 * reconstruct history from a snapshot — it just replays the log.
 */
function applyCommand(document: ProjectDocument, command: ProjectCommand): void {
  switch (command.type) {
    case "scene/create":
      document.scenes.push({ id: command.sceneId, name: command.name, entities: [], tiles: emptyTiles() });
      return;
    case "scene/delete": {
      const index = document.scenes.findIndex((scene) => scene.id === command.sceneId);
      if (index !== -1) document.scenes.splice(index, 1);
      return;
    }
    case "scene/rename": {
      const index = document.scenes.findIndex((candidate) => candidate.id === command.sceneId);
      const scene = document.scenes[index];
      // Replaces the element rather than assigning `.name` in place:
      // SceneSummary's fields are readonly by design (Section 3), so a
      // rename is "swap in a new value", not a mutation of the old one.
      if (scene) document.scenes[index] = { id: scene.id, name: command.name, entities: scene.entities, tiles: scene.tiles };
      return;
    }
    case "module/install":
      document.installedModules[command.moduleName] = {
        config: command.config,
        ...(command.marketplace ? { marketplace: command.marketplace } : {}),
      };
      return;
    case "module/uninstall":
      delete document.installedModules[command.moduleName];
      return;
    case "entity/add": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (scene) scene.entities.push(command.entity);
      return;
    }
    case "entity/delete": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (!scene) return;
      const index = scene.entities.findIndex((entity) => entity.id === command.entityId);
      if (index !== -1) scene.entities.splice(index, 1);
      return;
    }
    case "entity/configure": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (!scene) return;
      const index = scene.entities.findIndex((entity) => entity.id === command.entityId);
      const entity = scene.entities[index];
      if (!entity) return;
      // exactOptionalPropertyTypes: an optional field can't be assigned
      // `undefined` explicitly — omit the key entirely to clear it.
      const { dialogue: _currentDialogue, ...withoutDialogue } = entity;
      scene.entities[index] =
        command.dialogue !== undefined ? { ...withoutDialogue, dialogue: command.dialogue } : withoutDialogue;
      return;
    }
    case "entity/set-player-start": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (!scene) return;
      const index = scene.entities.findIndex((entity) => entity.kind === "player-start");
      if (index !== -1) scene.entities.splice(index, 1);
      if (command.entity) scene.entities.push(command.entity);
      return;
    }
    case "scene/paint-tile": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (scene) scene.tiles[command.index] = command.tileId;
      return;
    }
    case "pack/set-active":
      document.activePack = command.packName;
      return;
    case "pack/set-override":
      if (command.url === undefined) {
        delete document.packOverrides[command.path];
      } else {
        document.packOverrides[command.path] = command.url;
      }
      return;
    case "pack/set-terrain-remap":
      if (command.targetTag === undefined) {
        delete document.packTerrainRemap[command.sourceTag];
      } else {
        document.packTerrainRemap[command.sourceTag] = command.targetTag;
      }
      return;
    case "document/replace":
      document.scenes = command.document.scenes;
      document.installedModules = command.document.installedModules;
      document.activePack = command.document.activePack;
      document.packOverrides = command.document.packOverrides;
      document.packTerrainRemap = command.document.packTerrainRemap;
      return;
  }
}

/** What the Inspector shows. Scenes, modules, and entities are all selectable, but only one at a time. */
export type Selection =
  | { readonly kind: "scene"; readonly sceneId: string }
  | { readonly kind: "module"; readonly moduleName: string }
  | { readonly kind: "entity"; readonly sceneId: string; readonly entityId: string };

interface ProjectStoreState {
  document: ProjectDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Newest last. Persisted (Section 5.3: "nothing lost... without a warning" applies to checkpoints too — a reload must not silently drop a creator's restore point). */
  checkpoints: PackSwapCheckpoint[];
  /**
   * What the Inspector is showing. Transient UI focus, not document
   * content — deliberately not part of the command log (selecting
   * something isn't a fact worth undoing) and not persisted (a reload
   * should land on "nothing selected", not resume an old focus target).
   */
  selection: Selection | undefined;
  createScene: () => void;
  renameScene: (sceneId: string, name: string) => void;
  selectScene: (sceneId: string | undefined) => void;
  installModule: (
    moduleName: string,
    initialConfig: FormValues,
    marketplace?: { readonly version: string; readonly bundleUrl: string; readonly bundleSha256Hex: string },
  ) => void;
  uninstallModule: (moduleName: string) => void;
  configureModule: (moduleName: string, config: FormValues) => void;
  selectModule: (moduleName: string | undefined) => void;
  placePlayerStart: (sceneId: string, tileX: number, tileY: number) => void;
  placeNpc: (sceneId: string, tileX: number, tileY: number) => void;
  removeEntity: (sceneId: string, entityId: string) => void;
  configureEntityDialogue: (sceneId: string, entityId: string, dialogue: EntityDialogue) => void;
  selectEntity: (sceneId: string, entityId: string | undefined) => void;
  paintTile: (sceneId: string, tileX: number, tileY: number, tileId: number) => void;
  setActivePack: (packName: string | undefined) => void;
  setPackOverride: (path: string, url: string | undefined) => void;
  setTerrainRemap: (sourceTag: string, targetTag: string | undefined) => void;
  createCheckpoint: (label: string) => string;
  restoreCheckpoint: (checkpointId: string) => void;
  deleteCheckpoint: (checkpointId: string) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Swaps in a different project's document wholesale and clears undo
   * history/checkpoints — unlike `document/replace` (a same-project
   * checkpoint restore), this isn't undoable: the past being discarded
   * belongs to whatever project was open before, not to this one, so
   * there is nothing coherent for `undo()` to step back into. Used by
   * `project/projectSyncStore.ts` when opening a project.
   */
  loadDocument: (document: ProjectDocument) => void;
}

const PERSIST_KEY = "forge:editor:project-document";
const PERSIST_VERSION = 5;

/**
 * Persisted state from before `activePack`/`packOverrides` existed
 * (version 1) rehydrates without those keys — `persist`'s default merge
 * is a shallow replace of `document` wholesale, not a deep merge, so an
 * old `document` object landing as-is would leave `packOverrides`
 * missing entirely and crash the very first `pack/set-override` command
 * (`document.packOverrides[path] = ...` against `undefined`). Exported
 * so this fallback path itself has a test, not just an assumption that
 * `persist`'s `migrate` option is wired correctly.
 */
export function migratePersistedProjectState(
  persisted: unknown,
): Pick<ProjectStoreState, "document" | "past" | "future" | "checkpoints"> {
  const state = (persisted ?? {}) as {
    document?: Partial<ProjectDocument>;
    past?: HistoryEntry[];
    future?: HistoryEntry[];
    checkpoints?: PackSwapCheckpoint[];
  };
  return {
    document: migrateDocument(state.document),
    past: state.past ?? [],
    future: state.future ?? [],
    // Each checkpoint carries its own full document snapshot from
    // whatever version it was created under — the same missing-field
    // gap the top-level document has, so it gets the same fill-in.
    // Otherwise an old checkpoint's `restoreCheckpoint` would write
    // `packTerrainRemap: undefined` into the live document and crash the
    // very next `setTerrainRemap` call.
    checkpoints: (state.checkpoints ?? []).map((checkpoint) => ({ ...checkpoint, document: migrateDocument(checkpoint.document) })),
  };
}

/**
 * Fills in any field a partial/foreign document is missing, the same
 * normalization `migratePersistedProjectState` applies to a rehydrated
 * `localStorage` document — reused by `project/projectSyncStore.ts` to
 * normalize a document fetched from `GetDocumentEndpoint`, which can be
 * `undefined` entirely (a brand-new project with no revisions yet) or, in
 * principle, an older schema version than this build expects. Moved to
 * @forge/project-export (docs/adr/0009); re-exported under its original
 * name so this module's own callers and `project/projectSyncStore.ts`
 * need no changes.
 */
export const migrateDocument = migrateDocumentShape;

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    immer((set) => ({
      document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {} },
      past: [],
      future: [],
      checkpoints: [],
      selection: undefined,

      createScene: () =>
        set((state) => {
          const sceneId = crypto.randomUUID();
          const name = `Scene ${state.document.scenes.length + 1}`;
          const forward: ProjectCommand = { type: "scene/create", sceneId, name };
          const inverse: ProjectCommand = { type: "scene/delete", sceneId, name };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      renameScene: (sceneId, name) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene || scene.name === name) return;
          const forward: ProjectCommand = { type: "scene/rename", sceneId, name };
          const inverse: ProjectCommand = { type: "scene/rename", sceneId, name: scene.name };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      selectScene: (sceneId) =>
        set((state) => {
          state.selection = sceneId === undefined ? undefined : { kind: "scene", sceneId };
        }),

      installModule: (moduleName, initialConfig, marketplace) =>
        set((state) => {
          if (moduleName in state.document.installedModules) return; // already installed, no-op
          const forward: ProjectCommand = {
            type: "module/install",
            moduleName,
            config: initialConfig,
            ...(marketplace ? { marketplace } : {}),
          };
          const inverse: ProjectCommand = { type: "module/uninstall", moduleName };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      uninstallModule: (moduleName) =>
        set((state) => {
          const entry = state.document.installedModules[moduleName];
          if (entry === undefined) return; // not installed, no-op
          const forward: ProjectCommand = { type: "module/uninstall", moduleName };
          const inverse: ProjectCommand = {
            type: "module/install",
            moduleName,
            config: entry.config,
            ...(entry.marketplace ? { marketplace: entry.marketplace } : {}),
          };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
          if (state.selection?.kind === "module" && state.selection.moduleName === moduleName) {
            state.selection = undefined;
          }
        }),

      configureModule: (moduleName, config) =>
        set((state) => {
          const previous = state.document.installedModules[moduleName];
          if (previous === undefined || JSON.stringify(previous.config) === JSON.stringify(config)) return;
          // Carries `previous.marketplace` forward unchanged on both sides —
          // reconfiguring never re-pins or drops which version is installed.
          const forward: ProjectCommand = {
            type: "module/install",
            moduleName,
            config,
            ...(previous.marketplace ? { marketplace: previous.marketplace } : {}),
          };
          const inverse: ProjectCommand = {
            type: "module/install",
            moduleName,
            config: previous.config,
            ...(previous.marketplace ? { marketplace: previous.marketplace } : {}),
          };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      selectModule: (moduleName) =>
        set((state) => {
          state.selection = moduleName === undefined ? undefined : { kind: "module", moduleName };
        }),

      placePlayerStart: (sceneId, tileX, tileY) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene) return;
          const existing = scene.entities.find((entity) => entity.kind === "player-start");
          const entity: EntityPlacement = { id: crypto.randomUUID(), kind: "player-start", tileX, tileY };
          const forward: ProjectCommand = { type: "entity/set-player-start", sceneId, entity };
          const inverse: ProjectCommand = { type: "entity/set-player-start", sceneId, entity: existing };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      placeNpc: (sceneId, tileX, tileY) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene) return;
          const entity: EntityPlacement = { id: crypto.randomUUID(), kind: "npc", tileX, tileY };
          const forward: ProjectCommand = { type: "entity/add", sceneId, entity };
          const inverse: ProjectCommand = { type: "entity/delete", sceneId, entityId: entity.id };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
          // Immediately selecting the new NPC lets the Inspector's
          // dialogue form show up right away — placing and configuring an
          // NPC is meant to feel like one motion, not two.
          state.selection = { kind: "entity", sceneId, entityId: entity.id };
        }),

      removeEntity: (sceneId, entityId) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          const entity = scene?.entities.find((candidate) => candidate.id === entityId);
          if (!scene || !entity) return;
          const forward: ProjectCommand = { type: "entity/delete", sceneId, entityId };
          const inverse: ProjectCommand = { type: "entity/add", sceneId, entity };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
          if (state.selection?.kind === "entity" && state.selection.entityId === entityId) {
            state.selection = undefined;
          }
        }),

      configureEntityDialogue: (sceneId, entityId, dialogue) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          const entity = scene?.entities.find((candidate) => candidate.id === entityId);
          if (!scene || !entity || JSON.stringify(entity.dialogue) === JSON.stringify(dialogue)) return;
          const forward: ProjectCommand = { type: "entity/configure", sceneId, entityId, dialogue };
          const inverse: ProjectCommand = { type: "entity/configure", sceneId, entityId, dialogue: entity.dialogue };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      selectEntity: (sceneId, entityId) =>
        set((state) => {
          state.selection = entityId === undefined ? undefined : { kind: "entity", sceneId, entityId };
        }),

      paintTile: (sceneId, tileX, tileY, tileId) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene) return;
          const index = tileY * GRID_WIDTH + tileX;
          const previous = scene.tiles[index];
          if (previous === tileId) return; // already painted this — no-op, not a no-op-shaped undo entry
          const forward: ProjectCommand = { type: "scene/paint-tile", sceneId, index, tileId };
          const inverse: ProjectCommand = { type: "scene/paint-tile", sceneId, index, tileId: previous ?? 0 };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      setActivePack: (packName) =>
        set((state) => {
          if (state.document.activePack === packName) return; // already this pack (or already none), no-op
          const forward: ProjectCommand = { type: "pack/set-active", packName };
          const inverse: ProjectCommand = { type: "pack/set-active", packName: state.document.activePack };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      setPackOverride: (path, url) =>
        set((state) => {
          const previous = state.document.packOverrides[path];
          if (previous === url) return; // already this value (or already absent), no-op
          const forward: ProjectCommand = { type: "pack/set-override", path, url };
          const inverse: ProjectCommand = { type: "pack/set-override", path, url: previous };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      setTerrainRemap: (sourceTag, targetTag) =>
        set((state) => {
          const previous = state.document.packTerrainRemap[sourceTag];
          if (previous === targetTag) return; // already this value (or already absent), no-op
          const forward: ProjectCommand = { type: "pack/set-terrain-remap", sourceTag, targetTag };
          const inverse: ProjectCommand = { type: "pack/set-terrain-remap", sourceTag, targetTag: previous };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      createCheckpoint: (label) => {
        const id = crypto.randomUUID();
        set((state) => {
          const checkpoint: PackSwapCheckpoint = {
            id,
            label,
            createdAt: new Date().toISOString(),
            document: current(state.document) as ProjectDocument,
          };
          state.checkpoints.push(checkpoint);
        });
        return id;
      },

      restoreCheckpoint: (checkpointId) =>
        set((state) => {
          const checkpoint = state.checkpoints.find((candidate) => candidate.id === checkpointId);
          if (!checkpoint) return; // deleted or never existed — nothing to restore.
          const forward: ProjectCommand = { type: "document/replace", document: checkpoint.document };
          const inverse: ProjectCommand = { type: "document/replace", document: current(state.document) as ProjectDocument };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      deleteCheckpoint: (checkpointId) =>
        set((state) => {
          const index = state.checkpoints.findIndex((candidate) => candidate.id === checkpointId);
          if (index !== -1) state.checkpoints.splice(index, 1);
        }),

      undo: () =>
        set((state) => {
          const entry = state.past.pop();
          if (!entry) return;
          applyCommand(state.document, entry.inverse);
          state.future.push(entry);
        }),

      redo: () =>
        set((state) => {
          const entry = state.future.pop();
          if (!entry) return;
          applyCommand(state.document, entry.forward);
          state.past.push(entry);
        }),

      loadDocument: (document) =>
        set((state) => {
          state.document = document;
          state.past = [];
          state.future = [];
          state.checkpoints = [];
          state.selection = undefined;
        }),
    })),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        document: state.document,
        past: state.past,
        future: state.future,
        checkpoints: state.checkpoints,
      }),
      migrate: (persisted) => migratePersistedProjectState(persisted),
    },
  ),
);

export function selectCanUndo(state: ProjectStoreState): boolean {
  return state.past.length > 0;
}

export function selectCanRedo(state: ProjectStoreState): boolean {
  return state.future.length > 0;
}
