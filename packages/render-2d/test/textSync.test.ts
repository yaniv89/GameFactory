import { InputState, registerCoreComponents, SceneManager, World, type TickContext } from "@forge/core";
import { describe, expect, it } from "vitest";
import { createTextSyncSystem, type TextLike } from "../src/textSync";

function ctxAt(alpha: number): TickContext {
  return { dt: 1 / 60, alpha, elapsed: 0, frame: 0, world: undefined as never, input: new InputState(), scene: new SceneManager("") };
}

class FakeText implements TextLike {
  position = { x: 0, y: 0 };
  alpha = 1;
  text = "";
  zIndex = 0;
}

class FakeContainer {
  children: FakeText[] = [];
  addChild(child: FakeText): void {
    this.children.push(child);
  }
  removeChild(child: FakeText): void {
    this.children = this.children.filter((c) => c !== child);
  }
}

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

describe("createTextSyncSystem", () => {
  it("creates and parents a text object the first time an entity matches Transform+FloatingText", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 5, y: 5 }, FloatingText: { value: 10, age: 0, ttl: 1 } });
    world.flush();

    const container = new FakeContainer();
    const system = createTextSyncSystem({ world, container, createText: () => new FakeText() });
    system.run(ctxAt(1), world.query(["Transform", "FloatingText"]));

    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.position).toEqual({ x: 5, y: 5 });
    expect(container.children[0]!.zIndex).toBe(5);
  });

  it("shows the value with a leading '-', rounded, and fades alpha with age/ttl", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, FloatingText: { value: 12.6, age: 0.4, ttl: 0.8 } });
    world.flush();

    const container = new FakeContainer();
    const system = createTextSyncSystem({ world, container, createText: () => new FakeText() });
    system.run(ctxAt(1), world.query(["Transform", "FloatingText"]));

    expect(container.children[0]!.text).toBe("-13");
    expect(container.children[0]!.alpha).toBeCloseTo(0.5, 5);
  });

  it("reuses the same text instance across runs instead of recreating it", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, FloatingText: { value: 1, age: 0, ttl: 1 } });
    world.flush();

    const container = new FakeContainer();
    const system = createTextSyncSystem({ world, container, createText: () => new FakeText() });
    const query = world.query(["Transform", "FloatingText"]);

    system.run(ctxAt(1), query);
    system.run(ctxAt(1), query);

    expect(container.children).toHaveLength(1);
  });

  it("removes the text object once the entity is destroyed", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, FloatingText: { value: 1, age: 0, ttl: 1 } });
    world.flush();

    const container = new FakeContainer();
    const system = createTextSyncSystem({ world, container, createText: () => new FakeText() });
    const query = world.query(["Transform", "FloatingText"]);
    system.run(ctxAt(1), query);
    expect(container.children).toHaveLength(1);

    world.destroy(entity);
    world.flush();
    system.run(ctxAt(1), query);

    expect(container.children).toHaveLength(0);
  });
});
