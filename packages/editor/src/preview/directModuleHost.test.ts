import { dialogueModule, DIALOGUE_STATE_COMPONENT, type DialogueStateShape } from "@forge/dialogue";
import { describe, expect, it, vi } from "vitest";
import { createModuleRuntime } from "./directModuleHost";

describe("createModuleRuntime", () => {
  it("runs @forge/dialogue's real setup() unsandboxed and drives a one-line dialogue end to end", () => {
    const runtime = createModuleRuntime("@forge/dialogue", {
      trees: [{ id: "npc1", nodes: [{ speaker: "NPC", text: "Hello there!" }] }],
    });
    dialogueModule.setup(runtime.ctx);

    const shown: unknown[] = [];
    const ended: unknown[] = [];
    runtime.events.on("dialogue:shown", (payload) => shown.push(payload));
    runtime.events.on("dialogue:ended", (payload) => ended.push(payload));

    const entity = runtime.ctx.world.create();
    runtime.world.flush(); // world.create() is deferred — flush before the entity is usable
    runtime.events.emit("dialogue:start", { entity, treeId: "npc1" });

    expect(shown).toEqual([{ entity, speaker: "NPC", text: "Hello there!", locale: "en" }]);
    expect(ended).toEqual([{ entity, treeId: "npc1" }]);
  });

  it("converts boolean component fields correctly in both directions (core stores 0/1, WorldApi reads real booleans)", () => {
    const runtime = createModuleRuntime("@forge/dialogue", {
      trees: [{ id: "npc1", nodes: [{ speaker: "NPC", text: "Hi" }] }],
    });
    dialogueModule.setup(runtime.ctx);

    const entity = runtime.ctx.world.create();
    runtime.world.flush();
    runtime.events.emit("dialogue:start", { entity, treeId: "npc1" });
    // World.add (used the first time an entity gets DialogueState) is
    // deferred, per @forge/core's CommandBuffer — flush to apply it
    // before reading back.
    runtime.world.flush();

    const state = runtime.ctx.world.get<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT);
    expect(state).toBeDefined();
    expect(typeof state?.active).toBe("boolean");
    expect(state?.tree).toBe(0);
    expect(state?.autoAdvanceSec).toBe(-1);
  });

  it("registers the autoAdvance system with the scheduler without throwing, and tick() runs it safely", () => {
    const runtime = createModuleRuntime("@forge/dialogue", { trees: [] });
    expect(() => dialogueModule.setup(runtime.ctx)).not.toThrow();
    expect(() => runtime.scheduler.tick(16)).not.toThrow();
    expect(() => runtime.scheduler.tick(16)).not.toThrow();
  });

  it("logs a warning through the real Logger when config.trees is malformed, instead of throwing", () => {
    const runtime = createModuleRuntime("@forge/dialogue", { trees: [{ id: "bad" }] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => dialogueModule.setup(runtime.ctx)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
