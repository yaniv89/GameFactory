import { describe, expect, it } from "vitest";
import { createEntityNode, destroyEntityNode } from "../src/nodes/entity";
import { makeFakeContext, makeFakeWorld } from "./support";

describe("core:createEntity", () => {
  it("creates an entity with the given components and continues flow", () => {
    const ctx = makeFakeContext();
    const outputs = createEntityNode.execute(ctx, { components: { health: { current: 10 } } }, {});
    expect(ctx.nextCalls).toEqual(["flow"]);
    const entity = (outputs as { entity: number }).entity;
    expect(ctx.world.get(entity, "health")).toEqual({ current: 10 });
  });

  it("creates an entity with no components when none are given", () => {
    const ctx = makeFakeContext();
    const outputs = createEntityNode.execute(ctx, {}, {});
    const entity = (outputs as { entity: number }).entity;
    expect(ctx.world.has(entity, "health")).toBe(false);
  });
});

describe("core:destroyEntity", () => {
  it("destroys the given entity and continues flow", () => {
    const world = makeFakeWorld();
    const entity = world.create({ health: { current: 5 } });
    const ctx = makeFakeContext({ world });
    destroyEntityNode.execute(ctx, { entity }, {});
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(ctx.world.has(entity, "health")).toBe(false);
  });
});
