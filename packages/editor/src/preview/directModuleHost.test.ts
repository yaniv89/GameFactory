import { EventBusImpl, World } from "@forge/core";
import { dialogueModule, DIALOGUE_STATE_COMPONENT, type DialogueStateShape } from "@forge/dialogue";
import { graphRuntimeModule } from "@forge/graph-runtime";
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

  it("gives ctx.storage a real, working get/set/delete round trip — not a no-op that silently discards every write", () => {
    const runtime = createModuleRuntime("@forge/dialogue", { trees: [] });
    expect(runtime.ctx.storage.get("k")).toBeNull();
    runtime.ctx.storage.set("k", { a: 1 });
    expect(runtime.ctx.storage.get("k")).toEqual({ a: 1 });
    runtime.ctx.storage.delete("k");
    expect(runtime.ctx.storage.get("k")).toBeNull();
  });

  it("gives each createModuleRuntime call its own isolated storage", () => {
    const runtimeA = createModuleRuntime("@forge/dialogue", { trees: [] });
    const runtimeB = createModuleRuntime("@forge/dialogue", { trees: [] });
    runtimeA.ctx.storage.set("k", "a");
    expect(runtimeB.ctx.storage.get("k")).toBeNull();
  });

  it("snapshotStorage/restoreStorage round-trip real storage state across two separate runtimes (I1f)", () => {
    const runtimeA = createModuleRuntime("@forge/dialogue", { trees: [] });
    runtimeA.ctx.storage.set("gold", 42);
    runtimeA.ctx.storage.set("season", "winter");
    expect(runtimeA.snapshotStorage()).toEqual({ gold: 42, season: "winter" });

    const runtimeB = createModuleRuntime("@forge/dialogue", { trees: [] });
    expect(runtimeB.snapshotStorage()).toEqual({});
    runtimeB.restoreStorage(runtimeA.snapshotStorage());
    expect(runtimeB.ctx.storage.get("gold")).toBe(42);
    expect(runtimeB.ctx.storage.get("season")).toBe("winter");
  });

  it("restoreStorage replaces the whole contents rather than merging", () => {
    const runtime = createModuleRuntime("@forge/dialogue", { trees: [] });
    runtime.ctx.storage.set("stale", "value");
    runtime.restoreStorage({ fresh: "value" });
    expect(runtime.ctx.storage.get("stale")).toBeNull();
    expect(runtime.ctx.storage.get("fresh")).toBe("value");
  });

  describe("shared world/events (docs/adr/0017, M6)", () => {
    it("without `shared`, each call still gets its own isolated World (existing dialogue/inventory behavior, unregressed)", () => {
      const a = createModuleRuntime("@forge/dialogue", { trees: [] });
      const b = createModuleRuntime("@forge/dialogue", { trees: [] });
      // Proven via a component only ever defined in a's own registry —
      // not via cross-world isAlive()/has() on a's entity id against b:
      // @forge/core's EntityAllocator.isAlive(id) can't distinguish
      // "never allocated" from "currently alive at generation 0" for a
      // *fresh* World (every untouched slot defaults to generation 0,
      // the same generation every entity is first created with), so a
      // brand-new, completely untouched b would read almost any of a's
      // ids as "alive" regardless of whether the two Worlds are
      // genuinely separate. A real, pre-existing @forge/core quirk this
      // test would otherwise trip over — out of scope to fix here (it
      // doesn't affect @forge/graph-runtime's own correctness, which
      // never compares ids across two separate Worlds this way), worth a
      // real follow-up issue.
      a.ctx.defineComponent("OnlyInA", { n: { type: "number" } }, { n: 0 });
      const entity = a.ctx.world.create({ OnlyInA: { n: 1 } });
      a.world.flush();
      expect(a.world.has(entity, "OnlyInA")).toBe(true);
      // World.has() checks location (alive-in-*this*-world) before it
      // would ever reach the component registry, so this reads false
      // safely rather than throwing "unknown component" — either way,
      // proof the two Worlds don't share entity state.
      expect(b.world.has(entity, "OnlyInA")).toBe(false);
    });

    it("with `shared`, two runtimes operate on the exact same World and events — a real @forge/graph-runtime instance can mutate an entity another runtime (standing in for the rest of PreviewApp.tsx) created", () => {
      const sharedWorld = new World();
      const sharedEvents = new EventBusImpl<Record<string, unknown>>();

      const graphRuntime = createModuleRuntime(
        "@forge/graph-runtime",
        {
          graphs: [
            {
              id: "g1",
              name: "kill on event",
              nodes: [
                { id: "trigger", type: "core:onEvent", config: { event: "enemy:died" } },
                { id: "destroy", type: "core:destroyEntity", config: {} },
              ],
              edges: [
                { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
                { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
              ],
            },
          ],
        },
        { world: sharedWorld, events: sharedEvents },
      );
      graphRuntimeModule.setup(graphRuntime.ctx);

      // A separate entity, created against the *same* shared World directly
      // (standing in for PreviewApp.tsx's own `world.create(...)` calls,
      // not graph-runtime's) — proves the graph really operates on real
      // game entities, not a phantom world only it can see.
      const entity = sharedWorld.create({});
      sharedWorld.flush();
      expect(sharedWorld.isAlive(entity)).toBe(true);

      sharedEvents.emit("enemy:died", entity);
      // core:destroyEntity's world.destroy() is deferred through the same
      // command buffer every World write goes through — in the real
      // preview, the next rAF tick's own `scheduler.tick()` (which always
      // flushes) applies it; here, nothing is ticking, so an explicit
      // flush stands in for that.
      sharedWorld.flush();
      expect(sharedWorld.isAlive(entity)).toBe(false);

      graphRuntimeModule.teardown?.({ moduleName: "@forge/graph-runtime" });
    });
  });
});
