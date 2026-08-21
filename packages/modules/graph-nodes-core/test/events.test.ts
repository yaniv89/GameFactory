import { describe, expect, it } from "vitest";
import { emitEventNode, onEventNode } from "../src/nodes/events";
import { makeFakeContext, makeFakeEvents } from "./support";

describe("core:onEvent", () => {
  it("passes the interpreter-supplied payload through and continues flow", () => {
    const ctx = makeFakeContext();
    const outputs = onEventNode.execute(ctx, { payload: { amount: 3 } }, {});
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(outputs).toEqual({ payload: { amount: 3 } });
  });

  it("normalizes a missing payload to null rather than undefined", () => {
    const ctx = makeFakeContext();
    const outputs = onEventNode.execute(ctx, {}, {});
    expect(outputs).toEqual({ payload: null });
  });
});

describe("core:emitEvent", () => {
  it("emits the configured event name with the given payload and continues flow", () => {
    const events = makeFakeEvents();
    const ctx = makeFakeContext({ events });
    emitEventNode.execute(ctx, { payload: { amount: 5 } }, { event: "quest:updated" });
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(events.emitted).toEqual([{ event: "quest:updated", payload: { amount: 5 } }]);
  });
});
