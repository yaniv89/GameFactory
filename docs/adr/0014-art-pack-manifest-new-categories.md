# 14. Extend the Art Pack manifest for vehicles, wagons, weapons, VFX, and props

Date: 2026-08-19

## Status

Proposed

## Context

`packages/art-pack/src/manifest.ts`'s `ArtPackManifest` today declares exactly four asset sections: `tilesets` (terrain strips, sliced by `columnIndex * grid.tileSize`), `characters` (role-keyed walk-cycle sheets sliced by `grid.spriteSize`/`grid.tileSize` against `template.animations`), `ui` (a single skin + palette), and `audio` (sfx/music, flat id -> path). That is the entire asset surface a pack author can declare, and it's the entire surface `packages/art-pack/src/validate.ts` (`validateArtPackManifest`) and `packages/art-pack/src/diffPackSwap.ts` (`diffPackSwap`) know how to check and diff.

Two things now need a place in that surface that doesn't exist:

1. **The Chroma Key prompt catalog** (1,500 prompts across 15 themes, `fixtures/raw-art/`) produces five asset shapes with no manifest home: single isometric objects on a magenta key (buildings/vehicles/props), a 1×4 facing strip (wagons/mounts), a flat icon on a magenta key (weapons), and a 1×5 fade animation strip (hit types/VFX). `terrain` and `characters/npcs/enemies` already map cleanly to `tilesets` and `characters` respectively — this ADR is only about the other five.
2. **The planned ECS components** `VehicleComponent`, `MountComponent`, `EquippableComponent`, and `VfxEmitterComponent` (task #139) need art to actually reference at spawn/equip/trigger time, the same way `Sprite.assetId` needs a real asset behind it instead of the baked-circle placeholder documented in the entity-model research for ADR-0015 (G1).

Everything below is **additive** to the manifest — every new field is optional, no existing field changes shape or meaning, and no `schemaVersion` bump is required: a pack with today's `schemaVersion` that declares none of the new sections remains exactly as valid as it is now, per `validateArtPackManifest`'s existing pattern of gating each optional section behind `"x" in data && data["x"] !== undefined` (`validate.ts:94-106`).

## Decision

### 1. Five new top-level manifest sections, all optional

```ts
readonly vehicles?: Readonly<Record<string, ArtPackVehicle>>;
readonly wagons?: Readonly<Record<string, ArtPackWagon>>;
readonly weapons?: Readonly<Record<string, ArtPackWeapon>>;
readonly vfx?: Readonly<Record<string, ArtPackVfx>>;
readonly props?: Readonly<Record<string, ArtPackProp>>;
```

Each keyed by the pack author's own chosen id — the same convention `characters.sheets` already uses (`manifest.ts:47`'s own doc comment: *"the pack author's own role id... the identity a pack-swap diff matches sheets across packs by"*), not `tilesets`' `terrains` tag-array convention. The tag-array exists specifically because one tileset image holds multiple terrain types per column; every one of these five new categories is one complete asset per key, structurally identical to one character sheet, so the simpler keyed-record pattern is the honest fit, not a tag array with exactly one tag in it.

### 2. A shared anchor type, not a new one per category

```ts
/** A placement/grip/impact point within an asset image, in pixels from the top-left. */
export interface ArtPackAnchor {
  readonly x: number;
  readonly y: number;
}
```

`ArtPackCharacterAnchor` (`manifest.ts:34-37`) is left untouched — renaming or replacing it is a breaking change to an existing exported type, out of scope for an additive ADR. `ArtPackAnchor` is the shape every new category needs; a future ADR can consolidate `ArtPackCharacterAnchor` into it if the duplication becomes a real cost, not assumed here.

### 3. The five new interfaces

```ts
export interface ArtPackVehicle {
  readonly src: string;
  readonly anchor: ArtPackAnchor; // ground-contact point
}

export interface ArtPackWagon {
  readonly src: string;
  readonly anchor: ArtPackAnchor;
  // No frameWidth/frameHeight field: frame size comes from the existing
  // grid.spriteSize (falling back to grid.tileSize), the same source
  // characters already use. Frame count is fixed at 4 by the shape
  // itself (south, west, east, north) — no field needed.
}

export interface ArtPackWeapon {
  readonly src: string;
  readonly anchor: ArtPackAnchor; // grip point, where a wielding entity's hand attaches
}

export interface ArtPackVfx {
  readonly src: string;
  readonly frameCount: number; // varies per effect, unlike wagons' fixed 4
  readonly fps: number;
  readonly anchor: ArtPackAnchor; // impact/origin point the effect centers on
}

export interface ArtPackProp {
  readonly src: string;
  readonly anchor: ArtPackAnchor; // ground-contact point
}
```

No collision-footprint field on `ArtPackProp`. Footprint is a per-*placement* concern the existing `Collider` component (`packages/core/src/components/core.ts:46-56`, already has `width`/`height`) already owns — putting it on the manifest would conflate "what this asset looks like" with "how big a hitbox a scene author wants for one placed instance," which is exactly the kind of feature-not-asked-for CLAUDE.md 1 warns against designing in ahead of a real consumer.

### 4. Validator additions

Five new `validateX` functions in `validate.ts`, each mirroring `validateTilesets`'s existing shape (loop entries, per-field `addError`, only include a validated entry in the output, return `undefined` on any failure) — not `validateCharacters`' shape, since none of the five need a nested template. Each gated the same way `characters`/`ui`/`audio` already are: `"vehicles" in data && data["vehicles"] !== undefined`. Golden-fixture tests per category, per `fixtures/packs/` existing pattern — this is L2's scope, not this ADR's.

### 5. `diffPackSwap` extension

One generic helper, not five near-duplicates of `diffCharacterSheets`:

```ts
function diffKeyedCategory(
  categoryLabel: string,
  source: Readonly<Record<string, unknown>> | undefined,
  target: Readonly<Record<string, unknown>> | undefined,
  findings: PackSwapFinding[],
): void
```

matching by key presence exactly like `diffCharacterSheets` does today (`diffPackSwap.ts:91-108`), called once per new category (`vehicles`, `wagons`, `weapons`, `vfx`, `props`). `diffCharacterSheets` itself is left as its own function rather than refactored onto the new helper in this ADR — it has the extra `diffAnimations` call `diffPackSwap` already makes right after it, and reshaping working, tested code to deduplicate five lines is not this ADR's job. Wiring `diffKeyedCategory` into `diffPackSwap` for the five new sections is in scope for **L2**, alongside the validator work — both touch the same files in the same PR.

## Consequences

- The five asset shapes the Chroma Key prompt catalog already produces (and any future prompt set) have a real, validated home in the manifest, closing the gap L3/L4's ingestion pipeline needs filled before it has anywhere to write its output.
- `VehicleComponent`/`MountComponent`/`EquippableComponent`/`VfxEmitterComponent` (#139) can resolve real art through `@forge/art-pack`'s asset-resolution algorithm (already built, M6 Phase 4b) the same way `Sprite` resolves character sheets today, instead of needing their own bespoke lookup.
- Pack-swap diffing (docs/SPEC.md 11.5, the platform's most demo-able feature per CLAUDE.md 5.8) now honestly reports incompatibilities across all nine asset categories instead of silently ignoring five of them — a creator swapping packs today would get a false "fully compatible" result for any project using a vehicle, wagon, weapon, VFX, or prop asset, since nothing currently diffs those categories at all.
- No change to `@forge/module-api`'s public surface, the sandbox, auth, or the CSP — this ADR does not require the CLAUDE.md 6.1 stop-and-wait gate, and none was taken. It does add public exports to `@forge/art-pack`, which is not `module-api` and carries no CI-enforced `.api.md` gate.
- `grid.spriteSize` goes from an optional, effectively-unused field to the real shared frame-size source for two new categories (`wagons`, and character sheets already lean on it) — existing packs that omit it still work via the `grid.tileSize` fallback L2 implements, so this is not a breaking reinterpretation.
- Five more asset categories a third-party pack author can get wrong. Each needs the same "these will render as placeholders until remapped" honesty `diffPackSwap` already gives tilesets/characters, not a silent gap — covered by the `diffKeyedCategory` wiring above.
