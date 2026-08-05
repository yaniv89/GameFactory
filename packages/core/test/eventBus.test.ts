import { describe, expect, it } from "vitest";
import { EventBusImpl } from "../src/events/eventBus";

interface TestEvents {
  "combat:hit": { attacker: number; target: number; amount: number };
  "score:changed": { value: number };
}

describe("EventBusImpl", () => {
  it("calls a subscribed handler with the emitted payload", () => {
    const bus = new EventBusImpl<TestEvents>();
    let received: TestEvents["combat:hit"] | undefined;
    bus.on("combat:hit", (payload) => {
      received = payload;
    });

    bus.emit("combat:hit", { attacker: 1, target: 2, amount: 5 });

    expect(received).toEqual({ attacker: 1, target: 2, amount: 5 });
  });

  it("calls every handler subscribed to the same event", () => {
    const bus = new EventBusImpl<TestEvents>();
    const calls: number[] = [];
    bus.on("score:changed", () => calls.push(1));
    bus.on("score:changed", () => calls.push(2));

    bus.emit("score:changed", { value: 10 });

    expect(calls).toEqual([1, 2]);
  });

  it("stops calling a handler after off()", () => {
    const bus = new EventBusImpl<TestEvents>();
    let calls = 0;
    const handler = () => calls++;
    bus.on("score:changed", handler);
    bus.off("score:changed", handler);

    bus.emit("score:changed", { value: 1 });

    expect(calls).toBe(0);
  });

  it("stops calling a handler after its unsubscribe function is invoked", () => {
    const bus = new EventBusImpl<TestEvents>();
    let calls = 0;
    const unsubscribe = bus.on("score:changed", () => calls++);

    bus.emit("score:changed", { value: 1 });
    unsubscribe();
    bus.emit("score:changed", { value: 2 });

    expect(calls).toBe(1);
  });

  it("does not throw emitting an event with no subscribers", () => {
    const bus = new EventBusImpl<TestEvents>();
    expect(() => bus.emit("score:changed", { value: 1 })).not.toThrow();
  });

  it("does not skip other handlers when one handler unsubscribes itself mid-emit", () => {
    const bus = new EventBusImpl<TestEvents>();
    const calls: string[] = [];
    let unsubscribeSelf: () => void = () => {};
    unsubscribeSelf = bus.on("score:changed", () => {
      calls.push("self");
      unsubscribeSelf();
    });
    bus.on("score:changed", () => calls.push("other"));

    bus.emit("score:changed", { value: 1 });

    expect(calls).toEqual(["self", "other"]);
  });

  it("keeps other subscribers isolated per event key", () => {
    const bus = new EventBusImpl<TestEvents>();
    let hitCalls = 0;
    let scoreCalls = 0;
    bus.on("combat:hit", () => hitCalls++);
    bus.on("score:changed", () => scoreCalls++);

    bus.emit("score:changed", { value: 1 });

    expect(hitCalls).toBe(0);
    expect(scoreCalls).toBe(1);
  });

  it("remains correct after many subscribe/unsubscribe cycles trigger internal compaction", () => {
    const bus = new EventBusImpl<TestEvents>();
    let calls = 0;
    const survivor = bus.on("score:changed", () => calls++);
    void survivor;

    for (let i = 0; i < 100; i++) {
      const unsubscribe = bus.on("score:changed", () => {});
      unsubscribe();
    }

    bus.emit("score:changed", { value: 1 });
    expect(calls).toBe(1);
  });
});
