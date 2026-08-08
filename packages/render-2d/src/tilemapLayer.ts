import type { CameraBounds } from "./camera";
import type { ContainerLike } from "./containerLike";
import { EMPTY_TILE_ID, tileCoordsFromIndex, tileIndex, tileRangeInBounds } from "./tileGrid";

/** The subset of Pixi.Sprite (or a test fake) a tile needs. */
export interface TileSpriteLike {
  position: { x: number; y: number };
  visible: boolean;
  texture?: unknown;
}

export interface TilemapLayerOptions<S extends TileSpriteLike> {
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
  /** Flat, row-major tile id grid. Length must equal `gridWidth * gridHeight`. 0 means empty. */
  tiles: ArrayLike<number>;
  container: ContainerLike<S>;
  createTileSprite(): S;
  /** Resolves a tile id to whatever `S.texture` expects (e.g. a Pixi Texture cut from the tileset atlas). Return undefined if the id can't be resolved yet — the pack may still be loading — leaving that cell undrawn until a later `setTile`/rebuild. */
  resolveTileTexture(tileId: number): unknown | undefined;
}

/**
 * One tilemap layer from a scene document (docs/SPEC.md Section 7.4), as a
 * batchable Pixi display tree: one sprite per non-empty cell, sharing the
 * tileset's texture atlas so Pixi's batcher can combine draw calls.
 *
 * Sprites are created once per non-empty cell, not per frame.
 * `setTile` mutates the affected cell only — the live tile-paint patch
 * docs/SPEC.md Section 12 requires ("Patch the tilemap in place. No
 * restart"). `cull` hides off-screen sprites by toggling `.visible`
 * (a boolean flip, not a create/destroy) so panning the camera doesn't
 * churn the display tree.
 */
export class TilemapLayer<S extends TileSpriteLike> {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly tileSize: number;

  private readonly tiles: Int32Array;
  private readonly spritesByIndex = new Map<number, S>();
  private readonly container: ContainerLike<S>;
  private readonly createTileSprite: () => S;
  private resolveTileTexture: (tileId: number) => unknown | undefined;

  constructor(options: TilemapLayerOptions<S>) {
    const { gridWidth, gridHeight, tileSize, tiles, container, createTileSprite, resolveTileTexture } = options;
    if (tiles.length !== gridWidth * gridHeight) {
      throw new Error(
        `TilemapLayer: tile data length ${tiles.length} does not match the ${gridWidth}x${gridHeight} grid (expected ${gridWidth * gridHeight})`,
      );
    }

    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.tileSize = tileSize;
    this.tiles = Int32Array.from(tiles);
    this.container = container;
    this.createTileSprite = createTileSprite;
    this.resolveTileTexture = resolveTileTexture;

    for (let index = 0; index < this.tiles.length; index++) {
      this.placeTile(index, this.tiles[index]!);
    }
  }

  private placeTile(index: number, tileId: number): void {
    const existing = this.spritesByIndex.get(index);

    if (tileId === EMPTY_TILE_ID) {
      if (existing) {
        this.container.removeChild(existing);
        this.spritesByIndex.delete(index);
      }
      return;
    }

    const texture = this.resolveTileTexture(tileId);
    if (texture === undefined) return;

    let sprite = existing;
    if (!sprite) {
      const { x, y } = tileCoordsFromIndex(index, this.gridWidth);
      sprite = this.createTileSprite();
      sprite.position.x = x * this.tileSize;
      sprite.position.y = y * this.tileSize;
      this.spritesByIndex.set(index, sprite);
      this.container.addChild(sprite);
    }
    sprite.texture = texture;
  }

  /**
   * Re-resolves and reassigns the texture of every currently-placed tile
   * sprite against a new resolver, and remembers it for future
   * `setTile` calls — the live half of a pack swap (docs/SPEC.md Section
   * 11.5): the same grid of tile ids stays painted, only which pixels
   * they resolve to changes. A cell whose id the new resolver can't
   * resolve keeps its previous texture rather than going blank — matches
   * `placeTile`'s own "leave undrawn until it resolves" stance for a
   * cell that was never drawn, but there's no undrawn state to fall back
   * to for one that already has a sprite on screen.
   */
  refreshTextures(resolveTileTexture: (tileId: number) => unknown | undefined): void {
    this.resolveTileTexture = resolveTileTexture;
    for (const [index, sprite] of this.spritesByIndex) {
      const texture = resolveTileTexture(this.tiles[index]!);
      if (texture !== undefined) sprite.texture = texture;
    }
  }

  /** Overwrites one cell's tile id and updates its sprite in place. */
  setTile(x: number, y: number, tileId: number): void {
    const index = tileIndex(x, y, this.gridWidth);
    this.tiles[index] = tileId;
    this.placeTile(index, tileId);
  }

  getTile(x: number, y: number): number {
    return this.tiles[tileIndex(x, y, this.gridWidth)]!;
  }

  /** Total sprites currently instantiated (non-empty cells whose texture resolved). Exposed for tests/diagnostics, not a hot-path call. */
  get spriteCount(): number {
    return this.spritesByIndex.size;
  }

  /** Toggles `.visible` on each tile sprite based on whether its cell intersects `bounds` (expanded by `marginTiles`). */
  cull(bounds: CameraBounds, marginTiles = 1): void {
    const range = tileRangeInBounds(bounds, this.gridWidth, this.gridHeight, this.tileSize);
    const minX = Math.max(0, range.minX - marginTiles);
    const minY = Math.max(0, range.minY - marginTiles);
    const maxX = Math.min(this.gridWidth - 1, range.maxX + marginTiles);
    const maxY = Math.min(this.gridHeight - 1, range.maxY + marginTiles);

    for (const [index, sprite] of this.spritesByIndex) {
      const { x, y } = tileCoordsFromIndex(index, this.gridWidth);
      sprite.visible = x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
  }
}
