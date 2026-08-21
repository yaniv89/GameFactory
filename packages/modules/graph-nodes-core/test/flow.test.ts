import { describe, expect, it } from "vitest";
import { ABSOLUTE_REPEAT_CEILING, branchNode, DEFAULT_REPEAT_CEILING, forEachEntityNode, repeatNode } from "../src/nodes/flow";
import { makeFakeContext, makeFakeWorld } from "./support";

describe("core:branch", () => {
  it("continues down the true output when condition is truthy", () => {
    const ctx = makeFakeContext();
    branchNode.execute(ctx, { condition: true }, {});
    expect(ctx.nextCalls).toEqual(["true"]);
  });

  it("continues down the false output when condition is falsy", () => {
    const ctx = makeFakeContext();
    branchNode.execute(ctx, { condition: false }, {});
    expect(ctx.nextCalls).toEqual(["false"]);
  });
});

describe("core:repeat", () => {
  it("passes a count under the default ceiling through unchanged, with no warning", () => {
    const ctx = makeFakeContext();
    const outputs = repeatNode.execute(ctx, { count: 5 }, {});
    expect(outputs).toEqual({ count: 5 });
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(ctx.warnings).toEqual([]);
  });

  it("clamps a count above the default ceiling and warns", () => {
    const ctx = makeFakeContext();
    const outputs = repeatNode.execute(ctx, { count: DEFAULT_REPEAT_CEILING + 500 }, {});
    expect(outputs).toEqual({ count: DEFAULT_REPEAT_CEILING });
    expect(ctx.warnings).toHaveLength(1);
  });

  it("honors a configured ceiling, but never above the absolute ceiling", () => {
    const ctx = makeFakeContext();
    const withinConfigured = repeatNode.execute(ctx, { count: 50 }, { ceiling: 100 });
    expect(withinConfigured).toEqual({ count: 50 });

    const ctx2 = makeFakeContext();
    const beyondAbsolute = repeatNode.execute(ctx2, { count: ABSOLUTE_REPEAT_CEILING + 1000 }, { ceiling: ABSOLUTE_REPEAT_CEILING + 5000 });
    expect(beyondAbsolute).toEqual({ count: ABSOLUTE_REPEAT_CEILING });
  });

  it("clamps a negative or non-numeric count to 0", () => {
    const ctx = makeFakeContext();
    expect(repeatNode.execute(ctx, { count: -5 }, {})).toEqual({ count: 0 });
    const ctx2 = makeFakeContext();
    expect(repeatNode.execute(ctx2, { count: "not a number" }, {})).toEqual({ count: 0 });
  });
});

describe("core:forEachEntity", () => {
  it("resolves the query's matched entities as data and continues flow", () => {
    const world = makeFakeWorld();
    const a = world.create({ enemy: {} });
    world.create({ npc: {} });
    const b = world.create({ enemy: {} });
    const ctx = makeFakeContext({ world });

    const outputs = forEachEntityNode.execute(ctx, {}, { components: ["enemy"] });
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(outputs).toEqual({ entities: [a, b] });
  });

  it("returns an empty list, not an error, when nothing matches", () => {
    const ctx = makeFakeContext();
    const outputs = forEachEntityNode.execute(ctx, {}, { components: ["nothingHasThis"] });
    expect(outputs).toEqual({ entities: [] });
  });
});
