import { describe, expect, it } from "vitest";
import { constantNode, getFieldNode, setFieldNode } from "../src/nodes/data";
import { makeFakeContext } from "./support";

describe("core:constant", () => {
  it("returns config.value unchanged and never touches flow", () => {
    const ctx = makeFakeContext();
    expect(constantNode.execute(ctx, {}, { value: 42 })).toEqual({ value: 42 });
    expect(constantNode.execute(ctx, {}, { value: "heal" })).toEqual({ value: "heal" });
    expect(constantNode.execute(ctx, {}, { value: true })).toEqual({ value: true });
    expect(ctx.nextCalls).toEqual([]);
  });
});

describe("core:getField", () => {
  it("extracts a named field from a compound object input", () => {
    const ctx = makeFakeContext();
    const outputs = getFieldNode.execute(ctx, { object: { player: 7, itemId: 3, amount: 1 } }, { field: "player" });
    expect(outputs).toEqual({ value: 7 });
  });

  it("returns undefined for a missing field, without throwing", () => {
    const ctx = makeFakeContext();
    expect(getFieldNode.execute(ctx, { object: { a: 1 } }, { field: "doesNotExist" })).toEqual({ value: undefined });
  });

  it("returns undefined when the input isn't an object at all", () => {
    const ctx = makeFakeContext();
    expect(getFieldNode.execute(ctx, { object: null }, { field: "x" })).toEqual({ value: undefined });
    expect(getFieldNode.execute(ctx, { object: 5 }, { field: "x" })).toEqual({ value: undefined });
    expect(getFieldNode.execute(ctx, {}, { field: "x" })).toEqual({ value: undefined });
  });
});

describe("core:setField", () => {
  it("wraps a scalar into a single-key object under config.field", () => {
    const ctx = makeFakeContext();
    expect(setFieldNode.execute(ctx, { value: 57 }, { field: "current" })).toEqual({ object: { current: 57 } });
    expect(setFieldNode.execute(ctx, { value: "hi" }, { field: "text" })).toEqual({ object: { text: "hi" } });
  });

  it("never touches flow", () => {
    const ctx = makeFakeContext();
    setFieldNode.execute(ctx, { value: 1 }, { field: "x" });
    expect(ctx.nextCalls).toEqual([]);
  });
});
