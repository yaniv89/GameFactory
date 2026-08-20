import { InputState, registerCoreComponents, SceneManager, World, type TickContext } from "@forge/core";
import { describe, expect, it } from "vitest";
import { TransformSnapshotStore } from "../src/interpolation";
import { createSpriteSyncSystem, type SpriteLike } from "../src/spriteSync";

class FakeSprite implements SpriteLike {
  position = { x: 0, y: 0 };
  scale = { x: 1, y: 1 };
  anchor = { x: 0.5, y: 0.5 };
  rotation = 0;
  tint = 0xffffff;
  alpha = 1;
  visible = false;
  texture: unknown;
  zIndex = 0;
}

class FakeContainer {
  children: FakeSprite[] = [];
  addChild(child: FakeSprite): void {
    this.children.push(child);
  }
  removeChild(child: FakeSprite): void {
    this.children = this.children.filter((c) => c !== child);
  }
}

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function ctxAt(alpha: number): TickContext {
  return { dt: 1 / 60, alpha, elapsed: 0, frame: 0, world: undefined as never, input: new InputState(), scene: new SceneManager("") };
}

describe("createSpriteSyncSystem", () => {
  it("creates and parents a sprite the first time an entity matches Transform+Sprite", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 5, y: 5 }, Sprite: {} });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });

    system.run(ctxAt(1), world.query(["Transform", "Sprite"]));

    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.position).toEqual({ x: 5, y: 5 });
    expect(container.children[0]!.visible).toBe(true);
    void entity;
  });

  it("sets zIndex from the sprite's own interpolated y — the Y-depth sort a sortableChildren container reads", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 120 }, Sprite: {} });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });
    system.run(ctxAt(1), world.query(["Transform", "Sprite"]));

    expect(container.children[0]!.zIndex).toBe(120);
  });

  it("reuses the same sprite instance across runs instead of recreating it", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, Sprite: {} });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });
    const query = world.query(["Transform", "Sprite"]);

    system.run(ctxAt(1), query);
    system.run(ctxAt(1), query);

    expect(container.children).toHaveLength(1);
  });

  it("removes the sprite once the entity is destroyed", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, Sprite: {} });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });
    const query = world.query(["Transform", "Sprite"]);

    system.run(ctxAt(1), query);
    expect(container.children).toHaveLength(1);

    world.destroy(entity);
    world.flush();
    system.run(ctxAt(1), query);

    expect(container.children).toHaveLength(0);
  });

  it("removes the sprite once the Sprite component is removed, even though the entity survives", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, Sprite: {} });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });
    const query = world.query(["Transform", "Sprite"]);

    system.run(ctxAt(1), query);
    world.remove(entity, "Sprite");
    world.flush();
    system.run(ctxAt(1), query);

    expect(container.children).toHaveLength(0);
  });

  it("interpolates position between the snapshot and the current Transform using alpha", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, Sprite: {} });
    world.flush();

    const snapshots = new TransformSnapshotStore();
    snapshots.set(entity, 0, 0, 0);
    world.set(entity, "Transform", { x: 10, y: 20 });

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots,
      createSprite: () => new FakeSprite(),
    });

    system.run(ctxAt(0.5), world.query(["Transform", "Sprite"]));

    expect(container.children[0]!.position).toEqual({ x: 5, y: 10 });
  });

  it("falls back to the current Transform when no snapshot exists yet (a just-created entity)", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 7, y: 8 }, Sprite: {} });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });

    system.run(ctxAt(0), world.query(["Transform", "Sprite"]));

    expect(container.children[0]!.position).toEqual({ x: 7, y: 8 });
  });

  it("copies tint, opacity, and anchor from the Sprite component", () => {
    const world = makeWorld();
    world.create({
      Transform: { x: 0, y: 0 },
      Sprite: { tint: 0xff0000, opacity: 0.5, anchorX: 0, anchorY: 1 },
    });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
    });

    system.run(ctxAt(1), world.query(["Transform", "Sprite"]));

    const sprite = container.children[0]!;
    expect(sprite.tint).toBe(0xff0000);
    expect(sprite.alpha).toBe(0.5);
    expect(sprite.anchor).toEqual({ x: 0, y: 1 });
  });

  it("assigns the texture resolveTexture returns, and leaves it alone when resolveTexture returns undefined", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, Sprite: { assetId: 42, frame: 1 } });
    world.flush();

    const container = new FakeContainer();
    const texture = { id: "loaded-texture" };
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
      resolveTexture: (assetId) => (assetId === 42 ? texture : undefined),
    });

    system.run(ctxAt(1), world.query(["Transform", "Sprite"]));
    expect(container.children[0]!.texture).toBe(texture);
  });

  it("leaves the sprite's texture untouched when resolveTexture returns undefined", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, Sprite: { assetId: -1 } });
    world.flush();

    const container = new FakeContainer();
    const system = createSpriteSyncSystem({
      world,
      container,
      snapshots: new TransformSnapshotStore(),
      createSprite: () => new FakeSprite(),
      resolveTexture: () => undefined,
    });

    system.run(ctxAt(1), world.query(["Transform", "Sprite"]));
    expect(container.children[0]!.texture).toBeUndefined();
  });
});
