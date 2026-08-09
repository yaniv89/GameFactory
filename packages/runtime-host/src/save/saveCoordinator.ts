import { deserializeWorld, serializeWorld, type SavedWorld, type World } from "@forge/core";
import type { SaveFile } from "@forge/module-api";
import type { ModuleBridge } from "../module/moduleBridge";

/** An orphaned module's last known version and globals — see `loadSave`'s doc comment for the round trip this supports. */
interface OrphanedModuleEntry {
  readonly version: string;
  readonly globals: unknown;
}

export interface CreateSaveOptions {
  readonly world: World;
  readonly modules: readonly ModuleBridge[];
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly projectId: string;
  readonly buildId: string;
  readonly playtimeSec: number;
  readonly flags: Readonly<Record<string, boolean | number | string>>;
  readonly currentScene: string;
  /** Carried forward from a prior `loadSave()`'s return value — modules that were installed when that save was made but aren't installed now. Passing the empty object (or omitting) is correct the first time a project is ever saved. */
  readonly orphaned?: Readonly<Record<string, unknown>>;
}

/**
 * Builds a `SaveFile` (docs/SPEC.md Section 8.5) from the live World and
 * the currently-installed modules. `world` is serialized via
 * `@forge/core`'s `serializeWorld` — this function's own job is the
 * module-aware bookkeeping `@forge/core` can't do (it has no concept of
 * modules): `moduleVersions`/`globals` for what's installed now, and
 * carrying forward `_orphaned` for what was installed in a previous save
 * but isn't anymore.
 */
export function createSave(options: CreateSaveOptions): SaveFile {
  const moduleVersions: Record<string, string> = {};
  const globals: Record<string, unknown> = {};
  for (const bridge of options.modules) {
    moduleVersions[bridge.moduleName] = bridge.moduleVersion;
    const snapshot = bridge.snapshotStorage();
    if (Object.keys(snapshot).length > 0) globals[bridge.moduleName] = snapshot;
  }

  const installedNames = new Set(options.modules.map((b) => b.moduleName));
  const _orphaned: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(options.orphaned ?? {})) {
    if (installedNames.has(name)) continue; // reinstalled since the save this was carried forward from — loadSave() already folded it back into moduleVersions/globals for that module.
    _orphaned[name] = entry;
  }

  return {
    schemaVersion: options.schemaVersion,
    engineVersion: options.engineVersion,
    projectId: options.projectId,
    buildId: options.buildId,
    createdAt: new Date().toISOString(),
    playtimeSec: options.playtimeSec,
    moduleVersions,
    world: serializeWorld(options.world),
    globals,
    flags: options.flags,
    currentScene: options.currentScene,
    _orphaned,
  };
}

export interface LoadSaveResult {
  /** Feed this back into the next `createSave()` call's `orphaned` option. */
  readonly orphaned: Readonly<Record<string, unknown>>;
}

function parseMajor(version: string, context: string): number {
  const match = /^(\d+)\./.exec(version);
  if (!match) {
    throw new Error(`loadSave: cannot parse a major version out of "${version}" (${context})`);
  }
  return Number(match[1]);
}

/**
 * Restores `world` and every installed module's `storage:local` state from
 * `save`, per docs/SPEC.md Section 8.5's two hard rules:
 *
 * 1. If a module's installed major version is *ahead* of the save's, its
 *    `migrateSave(from, to, data)` is invoked and must exist — refusing to
 *    load otherwise ("Modules must declare migrateSave if they bump a
 *    major version").
 * 2. If a module's installed major version is *behind* the save's (the
 *    save is from a newer module than what's installed), loading is
 *    refused outright — this is the "don't silently corrupt" guardrail,
 *    not a migration case.
 *
 * A module present in `save.moduleVersions` but not in `modules` (i.e.
 * not currently installed) has its version+globals folded into the
 * returned `orphaned` map, preserved verbatim per Section 8.5's
 * `_orphaned` field — the exact mechanism that lets a save survive a
 * module being uninstalled and later reinstalled: `save._orphaned`
 * entries for modules that *are* in `modules` this time go through the
 * same migrate-or-refuse path as an ordinary installed module, un-
 * orphaning them.
 */
export function loadSave(world: World, modules: readonly ModuleBridge[], save: SaveFile): LoadSaveResult {
  const seenIds = new Set<number>();
  for (const entity of save.world.entities) {
    if (seenIds.has(entity.id)) {
      throw new Error(`loadSave: corrupt save — duplicate entity id ${entity.id}`);
    }
    seenIds.add(entity.id);
  }
  // save.world is module-api's loosely-typed SaveFile shape (components: Record<string, unknown>,
  // since @forge/module-api has zero dependency on @forge/core's field-value types by design —
  // CLAUDE.md 3.1). The numeric-fields assumption is enforced structurally by World.restoreEntity
  // itself (it writes into typed-array columns), not provable at this boundary.
  deserializeWorld(world, save.world as unknown as SavedWorld);

  const byName = new Map(modules.map((bridge) => [bridge.moduleName, bridge] as const));
  const orphaned: Record<string, unknown> = {};

  const restoreModuleData = (bridge: ModuleBridge, savedVersion: string, data: unknown): void => {
    const savedMajor = parseMajor(savedVersion, `save data for module "${bridge.moduleName}"`);
    const installedMajor = parseMajor(bridge.moduleVersion, `installed module "${bridge.moduleName}"`);

    if (savedMajor > installedMajor) {
      throw new Error(
        `loadSave: module "${bridge.moduleName}" save data is version ${savedVersion}, newer than the installed ${bridge.moduleVersion} — refusing to load rather than risk silent corruption, per docs/SPEC.md Section 8.5 point 2.`,
      );
    }

    let resolved = data;
    if (installedMajor > savedMajor && data !== undefined) {
      const migrated = bridge.migrateSave(savedMajor, installedMajor, data);
      if (migrated === undefined) {
        throw new Error(
          `loadSave: module "${bridge.moduleName}" was saved at version ${savedVersion} but is now ${bridge.moduleVersion} and declares no migrateSave() — refusing to load, per docs/SPEC.md Section 8.5 point 1.`,
        );
      }
      resolved = migrated;
    }

    if (resolved !== undefined) bridge.restoreStorage(resolved as Record<string, unknown>);
  };

  for (const [name, savedVersion] of Object.entries(save.moduleVersions)) {
    const bridge = byName.get(name);
    if (!bridge) {
      orphaned[name] = { version: savedVersion, globals: save.globals[name] } satisfies OrphanedModuleEntry;
      continue;
    }
    restoreModuleData(bridge, savedVersion, save.globals[name]);
  }

  for (const [name, rawEntry] of Object.entries(save._orphaned)) {
    const entry = rawEntry as OrphanedModuleEntry;
    const bridge = byName.get(name);
    if (!bridge) {
      orphaned[name] = entry;
      continue;
    }
    restoreModuleData(bridge, entry.version, entry.globals);
  }

  return { orphaned };
}
