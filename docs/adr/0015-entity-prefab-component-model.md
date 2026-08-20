# 15. Replace `EntityPlacement.kind` with a prefab/component entity model

Date: 2026-08-19

## Status

Proposed

## Context

`packages/project-export/src/documentTypes.ts:23-30` defines the entire entity-authoring surface today:

```ts
export interface EntityPlacement {
  readonly id: string;
  readonly kind: "player-start" | "npc";
  readonly tileX: number;
  readonly tileY: number;
  readonly dialogue?: EntityDialogue;
}
```

Two hardcoded values. Every place that cares what an entity *is* switches on this closed union directly — nine call sites across the editor, player, and export packages: `EntityInspector.tsx:26,35` (which form to show), `DockviewPanels.tsx:155` (inspector label), `SceneCanvas.tsx:380` (which baked texture to draw), `projectStore.ts:156,399` (singleton player-start enforcement), `preview/protocol.ts:45` (wire-message validation), `PreviewApp.tsx:335,341,348` (spawn/dialogue-tracking lookups), `gameLogic.ts:149` (spawn branch), `toExportProjectInput.ts:68` (passthrough), `moduleAdapters.ts:36` (dialogue-tree eligibility). Adding a vehicle, a mount, an enemy, or a weapon pickup as a placeable entity means widening this union and re-touching all nine sites, every time, forever — the closed-union version of the exact "chained to certain choices" problem raised when planning the node-graph authoring layer (#143), just at the entity layer instead of the logic layer.

**Rendering is confirmed 100% procedural.** `packages/editor/src/canvas/entityMarkers.ts` and `packages/player/src/entityMarkers.ts` (duplicated, since the player cannot depend on the editor) both bake a `Graphics().circle(...).fill(color)` to a `Texture` — cyan for player, magenta for NPC — keyed by `kind`. `@forge/core`'s `Sprite` component (`packages/core/src/components/core.ts:27-35`: `assetId: i32, frame: i32, anchorX/anchorY: f32, tint: u32, opacity: f32`) and `Animator` (`:37-44`) already exist and are already wired at spawn (`packages/player/src/gameWorld.ts:16-30`) — but `Sprite.assetId` only ever resolves to `PLAYER_ASSET_ID`/`NPC_ASSET_ID` (`gameWorld.ts:9-10`), two constants pointing at the baked circles. The ECS has a sprite concept; nothing has ever given it a real asset to point at, and no `Animator` clip is ever actually set. There is no prefab or entity-type registry anywhere in the repo (zero matches for "prefab").

**The constraint this design must respect:** ADR 0002 already ruled that the archetype ECS (`packages/core/src/ecs/`) cannot host an open-ended, per-instance-shaped component — every component is one fixed-width typed-array column per declared field, shared across an entire archetype. Whatever replaces `kind` must compose entities purely from fixed-shape components, the same seven (soon more, per #139) already defined in `core.ts` — not invent a second, looser entity-description format that sidesteps the ECS's own storage model.

## Decision

### 1. `EntityPlacement.kind: "player-start" | "npc"` becomes `EntityPlacement.prefabId: string`

```ts
export interface EntityPlacement {
  readonly id: string;
  readonly prefabId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly dialogue?: EntityDialogue;
}
```

`prefabId` references a `Prefab` by id instead of encoding the entity's nature as a closed TypeScript union. `dialogue` stays as-is — it is genuinely per-placement data (which NPC says what), not something a prefab default should own.

### 2. A `Prefab` is a named, fixed-shape component bundle — an authoring convenience, not a new ECS concept

```ts
// packages/core/src/prefabs/prefab.ts
export interface Prefab {
  readonly id: string;
  readonly label: string;
  /** Default component values this prefab spawns with. Every field here is
   *  one of @forge/core's existing fixed-shape ComponentSchemas — no new
   *  storage strategy, per ADR 0002. Partial: a prefab declares only the
   *  components its entity actually needs. */
  readonly components: {
    readonly sprite?: Partial<SpriteFields>;
    readonly animator?: Partial<AnimatorFields>;
    readonly collider?: Partial<ColliderFields>;
    readonly velocity?: Partial<VelocityFields>;
    readonly playerControlled?: Partial<PlayerControlledFields>;
    readonly interactable?: Partial<InteractableFields>;
    readonly vehicle?: Partial<VehicleFields>;       // once #139 lands
    readonly mount?: Partial<MountFields>;           // once #139 lands
    readonly equippable?: Partial<EquippableFields>; // once #139 lands
    readonly vfxEmitter?: Partial<VfxEmitterFields>; // once #139 lands
  };
}
```

At spawn time a prefab expands into concrete component values exactly the way `gameWorld.ts`'s `spawnPlayer`/`spawnNpcMarker` already do today (`gameWorld.ts:16-30`) — this is a data-driven generalization of code that already exists, not a new runtime mechanism. `Prefab` is never itself stored in the ECS or serialized into a scene; only `prefabId` (a string) and per-instance overrides (`dialogue`, and whatever a future inspector lets an author tweak per-placement) live in `EntityPlacement`.

### 3. First-party prefab registry, in `@forge/core`, not exposed to third-party modules yet

`@forge/core` already owns every `ComponentSchema` these bundles reference, and both editor and player already depend on it — the natural, lowest-friction home. `@forge/project-export` needs no new dependency; `prefabId` is an opaque string to it, resolved by whoever spawns (editor canvas, player `gameWorld.ts`).

Ships with exactly the two prefabs that exist today — `player-start` and `npc` — defined to reproduce current spawn behavior exactly (`Sprite.assetId` still resolves to the baked-circle fallback until L1/L3/L4's Art Pack pipeline gives it something real to point at). New prefabs (`vehicle`, `mount`, `enemy`) are added as #139's components land — that is G2's (#128) implementation work, not this ADR's.

**Explicitly out of scope for this ADR:** a third-party extension point letting marketplace module authors register their own prefabs. That is real future work (the same shape of problem M4's node-registry solves for graph nodes, #146), but it is a `@forge/module-api` surface change and needs its own ADR per CLAUDE.md 3.1 — bundling it into this one would be exactly the kind of undesigned scope creep CLAUDE.md 1 warns against. Flagged here so it isn't silently assumed away, decided nowhere.

### 4. Sprite resolution: same fixed `Sprite.assetId: i32`, a real table behind it instead of two constants

No change to `Sprite`'s `ComponentSchema` shape — `assetId` stays a bare `i32`, consistent with ADR 0002's ruling that components stay fixed-width. What changes is what populates the id: a resolved-asset table (`Map<assetPath, i32>`) built once per scene load from the active Art Pack's resolution (`@forge/art-pack`'s existing asset-resolution algorithm, M6 Phase 4b, extended by ADR 0014's new categories), not the two hardcoded `PLAYER_ASSET_ID`/`NPC_ASSET_ID`. The baked-circle texture becomes the *missing-asset placeholder* specifically — rendered only when a prefab's declared sprite key has no resolution in the active pack, the same "renders as a placeholder until remapped" honesty `diffPackSwap` already promises for tiles and character sheets (`diffPackSwap.ts:82-87`). Wiring this resolution end-to-end is G2's (#128) implementation work.

### 5. Migration

`packages/project-export/src/documentTypes.ts`'s `migrateDocument` (the established mechanism, ADR 0009) gains a step: `kind: "player-start"` -> `prefabId: "player-start"`, `kind: "npc"` -> `prefabId: "npc"`. Pure rename, zero behavior change — the two shipped prefabs are defined to reproduce today's spawn behavior exactly, so no existing project's rendered output changes.

### 6. The nine call sites

| Site | Today | After |
|---|---|---|
| `EntityInspector.tsx:26,35` | `if (kind === "npc")` / `"player-start"` | Iterate `prefab.components` to decide which fields to show — dynamic, not a two-armed switch. Real form work is G2's. |
| `DockviewPanels.tsx:155` | `kind === "npc" ? "NPC" : "Player start"` | `prefab.label` |
| `SceneCanvas.tsx:380` | `textures.get(entity.kind)` | Resolve via `prefabId` + the resolved-asset table from decision 4 |
| `projectStore.ts:156,399` | `entity.kind === "player-start"` singleton check | `entity.prefabId === "player-start"` — stays a check against that specific, known, first-party id, not a new `isSingleton` flag on `Prefab`. Simplest correct thing; a flag is speculative generality this ADR doesn't need yet. |
| `preview/protocol.ts:45` | Rejects unless `kind` is one of two literals | Rejects unless `prefabId` is a member of the known prefab registry's id set — **not loosened to "any string."** This validator guards a cross-origin wire message (`app.forge.dev` -> the preview iframe, CLAUDE.md 4.3), so it keeps validating against a known-good set, just a data-driven one instead of a TypeScript union. |
| `PreviewApp.tsx:335,341,348` | Finds by `kind` | Finds by `prefabId` |
| `gameLogic.ts:149` | `kind === "player-start"` branches to `spawnPlayer` | `prefabId === "player-start"` — the player still gets its own spawn branch (real behavioral difference: input capture, camera follow), not folded into a generic prefab-spawn path |
| `toExportProjectInput.ts:68` | Copies `kind` through | Copies `prefabId` through |
| `moduleAdapters.ts:36` | `kind === "npc" && dialogue !== undefined` | `dialogue !== undefined` alone — dropping the kind check is strictly more correct: any prefab with dialogue set becomes a dialogue tree, so a future non-"npc" prefab (a talking mount, say) isn't arbitrarily excluded from a feature that only ever checked for the data it needs |

## Consequences

- Adding a new placeable entity type (vehicle, mount, enemy, weapon pickup) becomes "add a `Prefab` entry," not "widen a union and re-touch nine call sites." This is the concrete fix for the "not chained to certain choices" problem, at the entity layer.
- Composes only from `@forge/core`'s existing fixed-shape components — consistent with, and does not reopen, ADR 0002's ruling on dynamic-shape components. `Stats` remains deferred; nothing here needs it.
- `Sprite`/`Animator` finally get real assets behind them instead of a permanent placeholder — but only once G2 (#128) does the implementation work this ADR scopes; the ADR alone changes no rendered pixel.
- The player-start singleton rule and the preview wire-protocol's validation both stay exactly as strict as they are today, just re-expressed against a registry instead of a union — flagged explicitly above so neither silently loosens.
- Third-party prefab contribution is named as real future work and explicitly deferred, not decided here — it needs its own Module API ADR when a real consumer exists, per CLAUDE.md 3.1.
- No change to `@forge/module-api`'s public surface, the sandbox, auth, or the CSP — this ADR does not require the CLAUDE.md 6.1 stop-and-wait gate, and none was taken.
- Every one of the nine call sites needs a matching test update alongside the migration — `migrateDocument`'s existing golden-fixture pattern (ADR 0009, `fixtures/projects/`) is the mechanism that proves the rename is behavior-preserving, not just type-correct.
