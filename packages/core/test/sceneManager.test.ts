import { describe, expect, it } from "vitest";
import { EventBusImpl } from "../src/events/eventBus";
import { SceneManager, type SceneChangedEvent } from "../src/scene/sceneManager";

describe("SceneManager", () => {
  it("starts at the constructor's initialSceneId with no pending transition applied", () => {
    const scene = new SceneManager("village");
    expect(scene.currentSceneId).toBe("village");
    expect(scene.applyPendingTransition()).toBeUndefined();
    expect(scene.currentSceneId).toBe("village");
  });

  it("transitionTo() does not change currentSceneId until applyPendingTransition() is called", () => {
    const scene = new SceneManager("village");
    scene.transitionTo("dungeon");
    expect(scene.currentSceneId).toBe("village");
    const applied = scene.applyPendingTransition();
    expect(applied).toEqual({ from: "village", to: "dungeon" });
    expect(scene.currentSceneId).toBe("dungeon");
  });

  it("a second transitionTo() before apply overwrites the first — last write wins", () => {
    const scene = new SceneManager("village");
    scene.transitionTo("dungeon");
    scene.transitionTo("beach");
    const applied = scene.applyPendingTransition();
    expect(applied).toEqual({ from: "village", to: "beach" });
  });

  it("transitioning to the already-current scene is a no-op — no event, undefined return", () => {
    const scene = new SceneManager("village");
    scene.transitionTo("village");
    expect(scene.applyPendingTransition()).toBeUndefined();
    expect(scene.currentSceneId).toBe("village");
  });

  it("applyPendingTransition() with nothing queued is a no-op", () => {
    const scene = new SceneManager("village");
    expect(scene.applyPendingTransition()).toBeUndefined();
  });

  it("emits scene:changed on the provided event bus exactly when a real transition is applied", () => {
    const events = new EventBusImpl<{ "scene:changed": SceneChangedEvent }>();
    const received: SceneChangedEvent[] = [];
    events.on("scene:changed", (payload) => received.push(payload));

    const scene = new SceneManager("village", events);
    scene.transitionTo("village"); // no-op, no event
    scene.applyPendingTransition();
    expect(received).toEqual([]);

    scene.transitionTo("dungeon");
    scene.applyPendingTransition();
    expect(received).toEqual([{ from: "village", to: "dungeon" }]);
  });

  it("works with no event bus at all — currentSceneId still tracks correctly", () => {
    const scene = new SceneManager("village");
    scene.transitionTo("dungeon");
    scene.applyPendingTransition();
    expect(scene.currentSceneId).toBe("dungeon");
  });

  it("a queued transition is cleared after being applied — the next apply() call is a no-op", () => {
    const scene = new SceneManager("village");
    scene.transitionTo("dungeon");
    scene.applyPendingTransition();
    expect(scene.applyPendingTransition()).toBeUndefined();
  });
});
