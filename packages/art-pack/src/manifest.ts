/**
 * docs/SPEC.md Section 11.2's pack contract, typed. Every field here
 * mirrors that JSON shape exactly (field names, nesting, optionality) —
 * this is the ecosystem contract third-party pack authors' `pack.json`
 * files are written against, not an internal convenience type, so it
 * doesn't get to drift from the spec for its own tidiness.
 */

export interface ArtPackGridSpriteSize {
  readonly width: number;
  readonly height: number;
}

export interface ArtPackGrid {
  readonly tileSize: number;
  readonly spriteSize?: ArtPackGridSpriteSize;
}

/** One tileset entry, keyed by the pack author's own chosen tileset id (docs/SPEC.md Section 11.2's `"outdoor-base"`). */
export interface ArtPackTileset {
  readonly src: string;
  readonly columns: number;
  /** Terrain tags — the identity a pack-swap diff (docs/SPEC.md Section 11.5) matches tiles across packs by, not the tileset id itself. */
  readonly terrains: readonly string[];
  readonly autotile?: string;
}

export interface ArtPackAnimation {
  readonly frames: number;
  readonly fps: number;
  readonly directions: number;
}

export interface ArtPackCharacterAnchor {
  readonly x: number;
  readonly y: number;
}

export interface ArtPackCharacterTemplate {
  readonly animations: Readonly<Record<string, ArtPackAnimation>>;
  readonly anchor: ArtPackCharacterAnchor;
}

export interface ArtPackCharacters {
  readonly template: ArtPackCharacterTemplate;
  /** Character sheet image paths, keyed by the pack author's own role id (docs/SPEC.md Section 11.2's `"villager-m"`) — the identity a pack-swap diff matches sheets across packs by. */
  readonly sheets: Readonly<Record<string, string>>;
}

export interface ArtPackUiFont {
  readonly family: string;
  readonly baseSize: number;
  readonly lineHeight: number;
}

export interface ArtPackUi {
  readonly skin: string;
  readonly font: ArtPackUiFont;
  readonly palette: Readonly<Record<string, string>>;
}

export interface ArtPackAudio {
  readonly sfx?: Readonly<Record<string, string>>;
  readonly music?: Readonly<Record<string, string>>;
}

export interface ArtPackAttribution {
  readonly required: boolean;
  readonly text: string;
}

/**
 * docs/adr/0014's five new asset categories (vehicles, wagons, weapons,
 * VFX, props) — the Chroma Key prompt catalog's own asset shapes
 * (`fixtures/raw-art/`), and what the planned `VehicleComponent`/
 * `MountComponent`/`EquippableComponent`/`VfxEmitterComponent` (#139)
 * resolve real art through. A placement/grip/impact point within an
 * asset image, in pixels from the top-left — the shared shape every one
 * of the five needs. `ArtPackCharacterAnchor` is left untouched (ADR
 * decision 2): renaming/replacing an existing exported type is a breaking
 * change out of scope for an additive ADR, even though its shape happens
 * to be identical to this one.
 */
export interface ArtPackAnchor {
  readonly x: number;
  readonly y: number;
}

/** One isometric vehicle/building asset, keyed by the pack author's own chosen id — the same "one complete asset per key" convention `characters.sheets` already uses, not `tilesets`' tag-array one (docs/adr/0014 decision 1). */
export interface ArtPackVehicle {
  readonly src: string;
  /** Ground-contact point. */
  readonly anchor: ArtPackAnchor;
}

/**
 * A 1x4 facing-strip asset (south, west, east, north — docs/adr/0014
 * decision 3), keyed by the pack author's own chosen id. No
 * `frameWidth`/`frameHeight` field: frame size comes from the manifest's
 * own `grid.spriteSize` (falling back to `grid.tileSize`), the same
 * source `characters` already uses. Frame count is fixed at 4 by the
 * shape itself, so no field is needed for it either.
 */
export interface ArtPackWagon {
  readonly src: string;
  readonly anchor: ArtPackAnchor;
}

/** One flat weapon icon asset, keyed by the pack author's own chosen id. */
export interface ArtPackWeapon {
  readonly src: string;
  /** Grip point — where a wielding entity's hand attaches. */
  readonly anchor: ArtPackAnchor;
}

/** A fade-animation VFX strip asset, keyed by the pack author's own chosen id — frame count varies per effect (unlike `ArtPackWagon`'s fixed 4), so it's a real field here. */
export interface ArtPackVfx {
  readonly src: string;
  readonly frameCount: number;
  readonly fps: number;
  /** Impact/origin point the effect centers on. */
  readonly anchor: ArtPackAnchor;
}

/** One isometric prop asset, keyed by the pack author's own chosen id. No collision-footprint field: that's a per-*placement* concern the existing `Collider` component already owns (docs/adr/0014 decision 3), not something this manifest describes. */
export interface ArtPackProp {
  readonly src: string;
  /** Ground-contact point. */
  readonly anchor: ArtPackAnchor;
}

export interface ArtPackManifest {
  readonly schemaVersion: number;
  /** Scoped, e.g. `@pixelfoundry/fantasy-pack` — every registry package is scoped regardless of kind (services/Forge.Domain/Entities/Package.cs's own doc comment). */
  readonly name: string;
  readonly version: string;
  readonly kind: "artpack";
  /** The engine version range this pack targets, e.g. `>=2.0.0 <3.0.0`. Full semver-range validity is checked server-side at publish time (services/Forge.Api/Features/Registry/Publishing/ManifestValidator.cs) — this package only checks it's a non-empty string. */
  readonly engine: string;
  readonly grid: ArtPackGrid;
  /** Capability profile ids this pack claims to satisfy (docs/SPEC.md Section 11.3) — a declaration the platform trusts and filters by, not something this validator (or anything else yet) verifies against the pack's actual asset content. */
  readonly implements: readonly string[];
  /** Keyed by the pack author's own tileset id. */
  readonly tilesets: Readonly<Record<string, ArtPackTileset>>;
  readonly characters?: ArtPackCharacters;
  readonly ui?: ArtPackUi;
  readonly audio?: ArtPackAudio;
  readonly locales: readonly string[];
  readonly attribution?: ArtPackAttribution;
  /** docs/adr/0014 — all five optional, keyed by the pack author's own chosen id (see each interface's own doc comment). Additive: a pack declaring none of these remains exactly as valid as it was before this ADR. */
  readonly vehicles?: Readonly<Record<string, ArtPackVehicle>>;
  readonly wagons?: Readonly<Record<string, ArtPackWagon>>;
  readonly weapons?: Readonly<Record<string, ArtPackWeapon>>;
  readonly vfx?: Readonly<Record<string, ArtPackVfx>>;
  readonly props?: Readonly<Record<string, ArtPackProp>>;
}
