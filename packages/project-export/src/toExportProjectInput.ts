import type { PlayerEntityPlacement, PlayerInstalledModule, PlayerProjectData, PlayerScene } from "@forge/player";
import type { ProjectDocument } from "./documentTypes.js";
import { resolveModuleConfig } from "./moduleAdapters.js";

/** docs/adr/0009 decision 4 — independent of the editor's own `persist`-storage `PERSIST_VERSION`, which stays a `packages/editor`-local concern. Bump this and add a migration function here when `ProjectDocument`'s shape changes in a way that must survive into an export. */
export const CURRENT_PROJECT_SCHEMA_VERSION = 1;

/**
 * Everything `PlayerInstalledModule` has except `guestBundleSource`, which
 * is resolved separately (`packages/cli`) — pre-computing and embedding
 * compiled guest code isn't this package's concern; it stays isomorphic.
 *
 * `guestBundleUrl`/`guestBundleSha256Hex` are the one addition beyond
 * `PlayerInstalledModule` itself: present only for a marketplace-sourced
 * module, they tell the CLI where to fetch its guest bundle from over
 * HTTP (`packages/cli/src/commands/export.ts`) instead of resolving it
 * from `packages/player`'s local `node_modules`, and what hash to verify
 * the fetched bytes against before trusting them. Never part of
 * `PlayerProjectData` itself — purely a resolution hint for this one
 * export step, stripped once `guestBundleSource` is actually populated.
 */
export type ExportInstalledModuleInput = Omit<PlayerInstalledModule, "guestBundleSource"> & {
  readonly guestBundleUrl?: string;
  readonly guestBundleSha256Hex?: string;
};

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

  // issue #123: the editor's own live preview used to run
  // `@forge/dialogue` unconditionally, regardless of install status
  // (`PreviewApp.tsx`, fixed alongside this) — a creator could author an
  // NPC's dialogue, see it work in preview, and get a silently broken
  // interaction on export, since this function has only ever included a
  // module actually present in `installedModules`. Preview is fixed to
  // agree with this rule now; this check catches every other way a
  // document could still reach export in that state (an older document
  // authored before that fix shipped, a hand-edited fixture, dialogue
  // authored and then the module explicitly uninstalled afterward) with a
  // clear, actionable error instead of a build that plays but never talks.
  if (!("@forge/dialogue" in document.installedModules)) {
    for (const scene of document.scenes) {
      const entityWithDialogue = scene.entities.find((entity) => entity.dialogue);
      if (entityWithDialogue) {
        const firstLine = entityWithDialogue.dialogue!.nodes[0];
        const preview = firstLine ? `"${firstLine.speaker}: ${firstLine.text}"` : "(empty tree)";
        throw new Error(
          `toExportProjectInput: scene "${scene.name}" has an entity with dialogue authored (${preview}), but "@forge/dialogue" is not installed for this project. Install it from the Modules panel, or remove the dialogue from this entity, before exporting.`,
        );
      }
    }
  }

  const scenes: PlayerScene[] = document.scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    tiles: scene.tiles,
    entities: scene.entities.map(
      (entity): PlayerEntityPlacement => ({
        id: entity.id,
        prefabId: entity.prefabId,
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
    ([name, entry]) => ({
      name,
      // A marketplace-sourced module pins its own version at install
      // time — there is no local node_modules entry for
      // resolveModuleVersion to resolve a version from, unlike a
      // first-party module.
      version: entry.marketplace?.version ?? options.resolveModuleVersion(name),
      config: resolveModuleConfig(name, document, entry.config),
      ...(entry.marketplace
        ? { guestBundleUrl: entry.marketplace.bundleUrl, guestBundleSha256Hex: entry.marketplace.bundleSha256Hex }
        : {}),
    }),
  );

  // docs/adr/0018 Decision 3: only `rows` cross into the exported/player
  // shape — `columns`/`name` are editor-only metadata (`DataTableDefinition`'s
  // own doc comment), never read by `SetupContext.dataTables` consumers.
  const dataTables: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
  for (const [id, table] of Object.entries(document.dataTables)) {
    dataTables[id] = table.rows;
  }

  return {
    projectId: options.projectId,
    buildId: options.buildId ?? crypto.randomUUID(),
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    engineVersion: options.resolveEngineVersion(),
    scenes,
    installedModules,
    dataTables,
    startSceneId,
  };
}
