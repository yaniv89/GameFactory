import { describe, expect, it } from "vitest";
import { addNode, divideNode, multiplyNode, subtractNode } from "../src/nodes/math";
import { makeFakeContext } from "./support";

describe("core:add / core:subtract / core:multiply", () => {
  it("compute the arithmetic result and never touch flow", () => {
    const ctx = makeFakeContext();
    expect(addNode.execute(ctx, { a: 2, b: 3 }, {})).toEqual({ result: 5 });
    expect(subtractNode.execute(ctx, { a: 5, b: 2 }, {})).toEqual({ result: 3 });
    expect(multiplyNode.execute(ctx, { a: 4, b: 3 }, {})).toEqual({ result: 12 });
    expect(ctx.nextCalls).toEqual([]);
  });
});

describe("core:divide", () => {
  it("divides normally when the divisor is non-zero", () => {
    const ctx = makeFakeContext();
    expect(divideNode.execute(ctx, { a: 10, b: 4 }, {})).toEqual({ result: 2.5 });
    expect(ctx.warnings).toEqual([]);
  });

  it("returns 0 and warns, instead of propagating NaN/Infinity, on divide by zero", () => {
    const ctx = makeFakeContext();
    const outputs = divideNode.execute(ctx, { a: 10, b: 0 }, {});
    expect(outputs).toEqual({ result: 0 });
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]?.message).toMatch(/divisor of 0/);
  });
});
