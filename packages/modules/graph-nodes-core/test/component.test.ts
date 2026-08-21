import { describe, expect, it } from "vitest";
import { getComponentNode, hasComponentNode, setComponentNode } from "../src/nodes/component";
import { makeFakeContext, makeFakeWorld } from "./support";

describe("core:getComponent", () => {
  it("returns the component value named by config", () => {
    const world = makeFakeWorld();
    const entity = world.create({ health: { current: 7 } });
    const ctx = makeFakeContext({ world });
    const outputs = getComponentNode.execute(ctx, { entity }, { component: "health" });
    expect(outputs).toEqual({ value: { current: 7 } });
  });

  it("returns null, not undefined, when the entity lacks the component", () => {
    const world = makeFakeWorld();
    const entity = world.create();
    const ctx = makeFakeContext({ world });
    const outputs = getComponentNode.execute(ctx, { entity }, { component: "missing" });
    expect(outputs).toEqual({ value: null });
  });

  it("never calls next() — it is a pure node", () => {
    const world = makeFakeWorld();
    const entity = world.create({ health: { current: 1 } });
    const ctx = makeFakeContext({ world });
    getComponentNode.execute(ctx, { entity }, { component: "health" });
    expect(ctx.nextCalls).toEqual([]);
  });
});

describe("core:hasComponent", () => {
  it("reports true when the component is present", () => {
    const world = makeFakeWorld();
    const entity = world.create({ health: { current: 1 } });
    const ctx = makeFakeContext({ world });
    expect(hasComponentNode.execute(ctx, { entity }, { component: "health" })).toEqual({ has: true });
  });

  it("reports false when the component is absent", () => {
    const world = makeFakeWorld();
    const entity = world.create();
    const ctx = makeFakeContext({ world });
    expect(hasComponentNode.execute(ctx, { entity }, { component: "health" })).toEqual({ has: false });
  });
});

describe("core:setComponent", () => {
  it("merges the given value into the entity's component and continues flow", () => {
    const world = makeFakeWorld();
    const entity = world.create({ health: { current: 10, max: 10 } });
    const ctx = makeFakeContext({ world });
    setComponentNode.execute(ctx, { entity, value: { current: 4 } }, { component: "health" });
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(world.get(entity, "health")).toEqual({ current: 4, max: 10 });
  });
});
