import { describe, expect, it } from "vitest";
import { andNode, equalsNode, greaterThanNode, lessThanNode, notNode, orNode } from "../src/nodes/comparisons";
import { makeFakeContext } from "./support";

describe("core:equals", () => {
  it("compares by strict equality, including across types", () => {
    const ctx = makeFakeContext();
    expect(equalsNode.execute(ctx, { a: 3, b: 3 }, {})).toEqual({ result: true });
    expect(equalsNode.execute(ctx, { a: 3, b: "3" }, {})).toEqual({ result: false });
    expect(ctx.nextCalls).toEqual([]);
  });
});

describe("core:greaterThan / core:lessThan", () => {
  it("compares numbers", () => {
    const ctx = makeFakeContext();
    expect(greaterThanNode.execute(ctx, { a: 5, b: 3 }, {})).toEqual({ result: true });
    expect(greaterThanNode.execute(ctx, { a: 3, b: 5 }, {})).toEqual({ result: false });
    expect(lessThanNode.execute(ctx, { a: 3, b: 5 }, {})).toEqual({ result: true });
    expect(lessThanNode.execute(ctx, { a: 5, b: 3 }, {})).toEqual({ result: false });
  });
});

describe("core:and / core:or / core:not", () => {
  it("evaluate boolean logic, coercing truthy/falsy inputs", () => {
    const ctx = makeFakeContext();
    expect(andNode.execute(ctx, { a: true, b: true }, {})).toEqual({ result: true });
    expect(andNode.execute(ctx, { a: true, b: false }, {})).toEqual({ result: false });
    expect(orNode.execute(ctx, { a: false, b: true }, {})).toEqual({ result: true });
    expect(orNode.execute(ctx, { a: false, b: false }, {})).toEqual({ result: false });
    expect(notNode.execute(ctx, { a: true }, {})).toEqual({ result: false });
    expect(notNode.execute(ctx, { a: false }, {})).toEqual({ result: true });
  });
});
