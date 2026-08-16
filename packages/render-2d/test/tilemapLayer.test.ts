import { describe, expect, it } from "vitest";
import { TilemapLayer, type TileSpriteLike } from "../src/tilemapLayer";

class FakeTileSprite implements TileSpriteLike {
  position = { x: 0, y: 0 };
  visible = false;
  texture: unknown;
}

class FakeContainer {
  children: FakeTileSprite[] = [];
  addChild(child: FakeTileSprite): void {
    this.children.push(child);
  }
  removeChild(child: FakeTileSprite): void {
    this.children = this.children.filter((c) => c !== child);
  }
}

const TEXTURE_FOR_TILE_1 = { id: "tile-1" };
const TEXTURE_FOR_TILE_2 = { id: "tile-2" };

function resolveTileTexture(tileId: number): unknown {
  if (tileId === 1) return TEXTURE_FOR_TILE_1;
  if (tileId === 2) return TEXTURE_FOR_TILE_2;
  return undefined;
}

describe("TilemapLayer", () => {
  it("rejects tile data whose length doesn't match the grid", () => {
    expect(
      () =>
        new TilemapLayer({
          gridWidth: 2,
          gridHeight: 2,
          tileSize: 32,
          tiles: [1, 1, 1], // needs 4
          container: new FakeContainer(),
          createTileSprite: () => new FakeTileSprite(),
          resolveTileTexture,
        }),
    ).toThrow(/does not match/);
  });

  it("creates a sprite only for non-empty cells, positioned by grid coordinates", () => {
    const container = new FakeContainer();
    // 2x2 grid: tile 0 (empty), tile 1, tile 0, tile 2
    new TilemapLayer({
      gridWidth: 2,
      gridHeight: 2,
      tileSize: 32,
      tiles: [0, 1, 0, 2],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    expect(container.children).toHaveLength(2);
    const positions = container.children.map((s) => `${s.position.x},${s.position.y}`).sort();
    // index 1 -> (x=1,y=0) -> world (32,0); index 3 -> (x=1,y=1) -> world (32,32)
    expect(positions).toEqual(["32,0", "32,32"]);
  });

  it("leaves a cell undrawn when resolveTileTexture returns undefined for its id", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [99], // unresolvable id
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    expect(container.children).toHaveLength(0);
    expect(layer.spriteCount).toBe(0);
  });

  it("setTile updates an existing sprite's texture in place rather than recreating it", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    const spriteBefore = container.children[0];
    layer.setTile(0, 0, 2);

    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBe(spriteBefore);
    expect(container.children[0]!.texture).toBe(TEXTURE_FOR_TILE_2);
    expect(layer.getTile(0, 0)).toBe(2);
  });

  it("setTile to the empty id removes the sprite", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    layer.setTile(0, 0, 0);

    expect(container.children).toHaveLength(0);
    expect(layer.spriteCount).toBe(0);
  });

  it("setTile from empty to non-empty creates a new sprite", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [0],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    expect(container.children).toHaveLength(0);
    layer.setTile(0, 0, 1);

    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.texture).toBe(TEXTURE_FOR_TILE_1);
  });

  it("setTiles replaces every cell at once — creates, updates, and clears sprites in one call", () => {
    const container = new FakeContainer();
    // 2x1 grid: tile 1 (has a sprite), tile 0 (no sprite).
    const layer = new TilemapLayer({
      gridWidth: 2,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1, 0],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });
    const survivingSprite = container.children[0];

    // Swap the whole scene: cell 0 changes texture (same sprite reused),
    // cell 1 goes from empty to non-empty (a sprite is created).
    layer.setTiles([2, 1]);

    expect(container.children).toHaveLength(2);
    expect(container.children[0]).toBe(survivingSprite);
    expect(layer.getTile(0, 0)).toBe(2);
    expect(layer.getTile(1, 0)).toBe(1);
    const textures = container.children.map((s) => s.texture);
    expect(textures).toContain(TEXTURE_FOR_TILE_2);
    expect(textures).toContain(TEXTURE_FOR_TILE_1);
  });

  it("setTiles removes a sprite for a cell that becomes empty", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    layer.setTiles([0]);

    expect(container.children).toHaveLength(0);
    expect(layer.spriteCount).toBe(0);
  });

  it("setTiles rejects tile data whose length doesn't match the grid", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 2,
      gridHeight: 2,
      tileSize: 32,
      tiles: [0, 0, 0, 0],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    expect(() => layer.setTiles([1, 1, 1])).toThrow(/does not match/);
  });

  it("refreshTextures re-resolves every placed sprite's texture against a new resolver", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 2,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1, 2],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    const NEW_TEXTURE_FOR_TILE_1 = { id: "swapped-tile-1" };
    const NEW_TEXTURE_FOR_TILE_2 = { id: "swapped-tile-2" };
    layer.refreshTextures((tileId) => {
      if (tileId === 1) return NEW_TEXTURE_FOR_TILE_1;
      if (tileId === 2) return NEW_TEXTURE_FOR_TILE_2;
      return undefined;
    });

    expect(container.children).toHaveLength(2);
    expect(container.children[0]!.texture).toBe(NEW_TEXTURE_FOR_TILE_1);
    expect(container.children[1]!.texture).toBe(NEW_TEXTURE_FOR_TILE_2);
  });

  it("refreshTextures leaves a sprite's texture unchanged when the new resolver can't resolve its id", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    layer.refreshTextures(() => undefined);

    expect(container.children[0]!.texture).toBe(TEXTURE_FOR_TILE_1);
  });

  it("refreshTextures's new resolver is used by later setTile calls, not just the refresh itself", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 1,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    const NEW_TEXTURE_FOR_TILE_3 = { id: "swapped-tile-3" };
    layer.refreshTextures((tileId) => (tileId === 3 ? NEW_TEXTURE_FOR_TILE_3 : undefined));
    layer.setTile(0, 0, 3);

    expect(container.children[0]!.texture).toBe(NEW_TEXTURE_FOR_TILE_3);
  });

  it("cull hides sprites outside the given bounds and shows those inside", () => {
    const container = new FakeContainer();
    // 4x1 grid, all tile 1, tileSize 32: cells at world x = 0, 32, 64, 96
    const layer = new TilemapLayer({
      gridWidth: 4,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1, 1, 1, 1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    // Bounds covering only world x in [32, 64] -> tile column 1..2, no margin
    layer.cull({ left: 32, top: 0, right: 64, bottom: 32 }, 0);

    const visibleXs = container.children.filter((s) => s.visible).map((s) => s.position.x);
    const hiddenXs = container.children.filter((s) => !s.visible).map((s) => s.position.x);

    expect(visibleXs.sort((a, b) => a - b)).toEqual([32, 64]);
    expect(hiddenXs.sort((a, b) => a - b)).toEqual([0, 96]);
  });

  it("cull's margin widens which sprites stay visible", () => {
    const container = new FakeContainer();
    const layer = new TilemapLayer({
      gridWidth: 4,
      gridHeight: 1,
      tileSize: 32,
      tiles: [1, 1, 1, 1],
      container,
      createTileSprite: () => new FakeTileSprite(),
      resolveTileTexture,
    });

    layer.cull({ left: 32, top: 0, right: 64, bottom: 32 }, 1);

    expect(container.children.every((s) => s.visible)).toBe(true);
  });
});
