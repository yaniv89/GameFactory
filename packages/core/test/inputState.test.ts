import { describe, expect, it } from "vitest";
import { InputState, type InputActionMap } from "../src/input/inputState";

const JUMP_MAP: InputActionMap = {
  jump: [{ type: "key", code: "Space" }, { type: "key", code: "KeyW" }],
  fire: [{ type: "pointerButton", button: 0 }],
};

describe("InputState", () => {
  it("isActionDown reflects the currently-held binding immediately, no beginTick() required", () => {
    const input = new InputState(JUMP_MAP);
    expect(input.isActionDown("jump")).toBe(false);
    input.handleKeyDown("Space");
    expect(input.isActionDown("jump")).toBe(true);
    input.handleKeyUp("Space");
    expect(input.isActionDown("jump")).toBe(false);
  });

  it("wasActionPressed/wasActionReleased are empty until beginTick() samples the accumulated edges", () => {
    const input = new InputState(JUMP_MAP);
    input.handleKeyDown("Space");
    expect(input.wasActionPressed("jump")).toBe(false); // not sampled yet
    input.beginTick();
    expect(input.wasActionPressed("jump")).toBe(true);
    expect(input.wasActionReleased("jump")).toBe(false);
  });

  it("a sampled press/release edge clears on the next beginTick() if nothing new happened", () => {
    const input = new InputState(JUMP_MAP);
    input.handleKeyDown("Space");
    input.beginTick();
    expect(input.wasActionPressed("jump")).toBe(true);

    input.beginTick(); // no new events since the last sample
    expect(input.wasActionPressed("jump")).toBe(false);
    expect(input.isActionDown("jump")).toBe(true); // still held, just not a new edge
  });

  it("an action with multiple bindings stays down until every binding is released", () => {
    const input = new InputState(JUMP_MAP);
    input.handleKeyDown("Space");
    input.handleKeyDown("KeyW");
    input.handleKeyUp("Space");
    expect(input.isActionDown("jump")).toBe(true); // KeyW still held
    input.handleKeyUp("KeyW");
    expect(input.isActionDown("jump")).toBe(false);
  });

  it("a quick tap between two beginTick() calls registers both a press and a release", () => {
    const input = new InputState(JUMP_MAP);
    input.handleKeyDown("Space");
    input.handleKeyUp("Space");
    input.beginTick();
    expect(input.wasActionPressed("jump")).toBe(true);
    expect(input.wasActionReleased("jump")).toBe(true);
    expect(input.isActionDown("jump")).toBe(false);
  });

  it("OS auto-repeat keydown events for an already-held key are ignored (no duplicate press edges)", () => {
    const input = new InputState(JUMP_MAP);
    input.handleKeyDown("Space");
    input.handleKeyDown("Space"); // auto-repeat
    input.handleKeyDown("Space");
    input.beginTick();
    expect(input.wasActionPressed("jump")).toBe(true);
    input.handleKeyUp("Space");
    input.beginTick();
    expect(input.wasActionReleased("jump")).toBe(true); // exactly one release, not swallowed by the extra downs
  });

  it("pointer buttons map to actions the same way keys do", () => {
    const input = new InputState(JUMP_MAP);
    input.handlePointerDown(0);
    expect(input.isActionDown("fire")).toBe(true);
    input.handlePointerUp(0);
    expect(input.isActionDown("fire")).toBe(false);
  });

  it("pointerPosition tracks the last handlePointerMove() call and is the same object identity across reads (no per-read allocation)", () => {
    const input = new InputState();
    const first = input.pointerPosition;
    expect(first).toEqual({ x: 0, y: 0 });
    input.handlePointerMove(12, 34);
    const second = input.pointerPosition;
    expect(second).toEqual({ x: 12, y: 34 });
    expect(second).toBe(first); // same object, mutated in place
  });

  it("a key with no binding in the action map is silently a no-op, not an error", () => {
    const input = new InputState(JUMP_MAP);
    expect(() => input.handleKeyDown("KeyZ")).not.toThrow();
    expect(() => input.handleKeyUp("KeyZ")).not.toThrow();
  });

  it("setActionMap() replaces bindings wholesale — a key bound under the old map stops affecting the action under the new one", () => {
    const input = new InputState(JUMP_MAP);
    input.setActionMap({ jump: [{ type: "key", code: "ArrowUp" }] });
    input.handleKeyDown("Space"); // no longer bound to anything
    expect(input.isActionDown("jump")).toBe(false);
    input.handleKeyDown("ArrowUp");
    expect(input.isActionDown("jump")).toBe(true);
  });

  it("downActionNames/pressedActionNames/releasedActionNames expose the live sampled state for the sandbox bridge's per-tick serialization", () => {
    const input = new InputState(JUMP_MAP);
    input.handleKeyDown("Space");
    input.beginTick();
    expect(Array.from(input.downActionNames)).toEqual(["jump"]);
    expect(Array.from(input.pressedActionNames)).toEqual(["jump"]);
    expect(Array.from(input.releasedActionNames)).toEqual([]);
  });
});
