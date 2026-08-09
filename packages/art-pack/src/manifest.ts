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
}
