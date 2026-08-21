import { describe, expect, it } from "vitest";
import {
  questCompleteObjectiveNode,
  questIsActiveNode,
  questIsObjectiveCompleteNode,
  questStartNode,
} from "../src/nodes/quests";
import { makeFakeContext, makeFakeEvents } from "./support";

describe("core:questStart", () => {
  it("emits quest:start with the configured questId and the wired entity, then continues flow", () => {
    const events = makeFakeEvents();
    const ctx = makeFakeContext({ events });
    const outputs = questStartNode.execute(ctx, { entity: 7 }, { questId: "killWolves" });
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(events.emitted).toEqual([{ event: "quest:start", payload: { entity: 7, questId: "killWolves" } }]);
    expect(outputs).toBeUndefined();
  });
});

describe("core:questCompleteObjective", () => {
  it("emits quest:completeObjective with the configured questId/objectiveId and the wired entity, then continues flow", () => {
    const events = makeFakeEvents();
    const ctx = makeFakeContext({ events });
    questCompleteObjectiveNode.execute(ctx, { entity: 7 }, { questId: "killWolves", objectiveId: "kill3Wolves" });
    expect(ctx.nextCalls).toEqual(["flow"]);
    expect(events.emitted).toEqual([
      { event: "quest:completeObjective", payload: { entity: 7, questId: "killWolves", objectiveId: "kill3Wolves" } },
    ]);
  });
});

/**
 * `@forge/quests` isn't installed in these tests — a bare `makeFakeEvents()`
 * has no `quest:query` handler registered. These two pure nodes stand in
 * for a real `@forge/quests` responder by registering one directly on the
 * fake bus, exactly mirroring the synchronous request/response round trip
 * `queryQuest()` (`src/nodes/quests.ts`) performs against the real module.
 */
function withFakeQuestsResponder(events: ReturnType<typeof makeFakeEvents>, state: {
  active: boolean;
  completed: boolean;
  completedObjectiveIds: readonly string[];
}): void {
  events.on("quest:query", (payload) => {
    const { entity, questId } = payload as { entity: unknown; questId: string };
    events.emit("quest:queried", { entity, questId, ...state });
  });
}

describe("core:questIsActive", () => {
  it("returns true when the queried quest responds active", () => {
    const events = makeFakeEvents();
    withFakeQuestsResponder(events, { active: true, completed: false, completedObjectiveIds: [] });
    const ctx = makeFakeContext({ events });
    const outputs = questIsActiveNode.execute(ctx, { entity: 7 }, { questId: "killWolves" });
    expect(outputs).toEqual({ active: true });
  });

  it("returns false and warns when nothing responds (no @forge/quests installed)", () => {
    const events = makeFakeEvents();
    const ctx = makeFakeContext({ events });
    const outputs = questIsActiveNode.execute(ctx, { entity: 7 }, { questId: "killWolves" });
    expect(outputs).toEqual({ active: false });
    expect(ctx.warnings).toHaveLength(1);
  });

  it("only matches a response for the same entity and questId, ignoring unrelated quest:queried traffic emitted in between", () => {
    const events = makeFakeEvents();
    events.on("quest:query", (payload) => {
      const { entity, questId } = payload as { entity: unknown; questId: string };
      // A stray response for a *different* entity/quest first — must not satisfy this call...
      events.emit("quest:queried", { entity: 999, questId: "otherQuest", active: true, completed: false, completedObjectiveIds: [] });
      // ...only the matching one should.
      events.emit("quest:queried", { entity, questId, active: false, completed: true, completedObjectiveIds: [] });
    });
    const ctx = makeFakeContext({ events });
    const outputs = questIsActiveNode.execute(ctx, { entity: 7 }, { questId: "killWolves" });
    expect(outputs).toEqual({ active: false });
    expect(ctx.warnings).toHaveLength(0); // a real (mismatched-then-matched) response arrived — no "nothing responded" warning
  });
});

describe("core:questIsObjectiveComplete", () => {
  it("returns true when the objective id is in the responder's completedObjectiveIds", () => {
    const events = makeFakeEvents();
    withFakeQuestsResponder(events, { active: true, completed: false, completedObjectiveIds: ["kill3Wolves"] });
    const ctx = makeFakeContext({ events });
    const outputs = questIsObjectiveCompleteNode.execute(ctx, { entity: 7 }, { questId: "killWolves", objectiveId: "kill3Wolves" });
    expect(outputs).toEqual({ complete: true });
  });

  it("returns false for an objective not yet completed", () => {
    const events = makeFakeEvents();
    withFakeQuestsResponder(events, { active: true, completed: false, completedObjectiveIds: [] });
    const ctx = makeFakeContext({ events });
    const outputs = questIsObjectiveCompleteNode.execute(ctx, { entity: 7 }, { questId: "killWolves", objectiveId: "kill3Wolves" });
    expect(outputs).toEqual({ complete: false });
  });

  it("returns false and warns when nothing responds", () => {
    const events = makeFakeEvents();
    const ctx = makeFakeContext({ events });
    const outputs = questIsObjectiveCompleteNode.execute(ctx, { entity: 7 }, { questId: "killWolves", objectiveId: "kill3Wolves" });
    expect(outputs).toEqual({ complete: false });
    expect(ctx.warnings).toHaveLength(1);
  });
});
