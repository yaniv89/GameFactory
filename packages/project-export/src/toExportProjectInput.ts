import type { PlayerEntityPlacement, PlayerInstalledModule, PlayerProjectData, PlayerScene } from "@forge/player";
import type { ProjectDocument } from "./documentTypes.js";
import { resolveModuleConfig } from "./moduleAdapters.js";

/** docs/adr/0009 decision 4 — independent of the editor's own `persist`-storage `PERSIST_VERSION`, which stays a `packages/editor`-local concern. Bump this and add a migration function here when `ProjectDocument`'s shape changes in a way that must survive into an export. */
export const CURRENT_PROJECT_SCHEMA_VERSION = 1;

/** Everything `PlayerInstalledModule` has except `guestBundleSource`, which is resolved separately (`packages/cli`) — pre-computing and embedding compiled guest code isn't this package's concern; it stays isomorphic. */
export type ExportInstalledModuleInput = Omit<PlayerInstalledModule, "guestBundleSource">;

/** `PlayerProjectData` minus each module's `guestBundleSource` — the CLI's own long-standing input contract (`packages/cli/src/commands/export.ts`), relocated here so it has one canonical definition instead of being redeclared. */
export type ExportProjectInput = Omit<PlayerProjectData, "installedModules"> & {
  readonly installedModules: readonly ExportInstalledModuleInput[];
};

export interface ToExportProjectInputOptions {
  readonly projectId: string;
  /** Which scene the exported game boots into. Defaults to the first scene — the editor has no "active scene" concept yet (docs/adr/0009). */
  readonly startSceneId?: string;
  /** Resolves an installed module's real version (e.g. from its own package.json) — a caller-supplied callback, not `node:fs` reached into directly, so this function stays isomorphic. `packages/cli` resolves the same way `guestBundleSource` already does. */
  readonly resolveModuleVersion: (moduleName: string) => string;
  /** Resolves `@forge/core`'s own version, the same way as `resolveModuleVersion`. */
  readonly resolveEngineVersion: () => string;
  /** Overrides the generated `buildId` — for deterministic tests only. A real export always gets a fresh id (docs/adr/0009 decision 5: random, not content-derived; a server build worker's own build-identity strategy is a separate decision). */
  readonly buildId?: string;
}

/**
 * The pure conversion at the center of docs/adr/0009: what actually lets
 * a game built in the editor become playable/exportable, instead of only
 * a hand-authored `ExportProjectInput` fixture. Never touches the
 * network, the filesystem, or the DOM — every environment-specific
 * lookup (module versions, the engine version, `guestBundleSource`) is a
 * caller-supplied value or callback.
 */
export function toExportProjectInput(document: ProjectDocument, options: ToExportProjectInputOptions): ExportProjectInput {
  if (document.scenes.length === 0) {
    throw new Error("toExportProjectInput: project has no scenes — nothing to export.");
  }
  const startSceneId = options.startSceneId ?? document.scenes[0]!.id;
  if (!document.scenes.some((scene) => scene.id === startSceneId)) {
    throw new Error(`toExportProjectInput: startSceneId "${startSceneId}" does not match any scene in this project.`);
  }

  const scenes: PlayerScene[] = document.scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    tiles: scene.tiles,
    entities: scene.entities.map(
      (entity): PlayerEntityPlacement => ({
        id: entity.id,
        kind: entity.kind,
        tileX: entity.tileX,
        tileY: entity.tileY,
        // exactOptionalPropertyTypes: omit the key entirely rather than
        // assigning `undefined` — same convention projectStore.ts's own
        // applyCommand already follows for this exact field.
        ...(entity.dialogue ? { dialogue: entity.dialogue } : {}),
      }),
    ),
  }));

  const installedModules: ExportInstalledModuleInput[] = Object.entries(document.installedModules).map(
    ([name, config]) => ({
      name,
      version: options.resolveModuleVersion(name),
      config: resolveModuleConfig(name, document, config),
    }),
  );

  return {
    projectId: options.projectId,
    buildId: options.buildId ?? crypto.randomUUID(),
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    engineVersion: options.resolveEngineVersion(),
    scenes,
    installedModules,
    startSceneId,
  };
}
