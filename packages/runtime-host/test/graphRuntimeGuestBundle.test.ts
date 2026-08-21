import { EventBusImpl, InterceptorRegistry, Scheduler, World } from "@forge/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GraphNodeRegistry } from "../src/module/graphNodeRegistry";
import { ModuleBridge } from "../src/module/moduleBridge";

/**
 * The one thing `moduleBridge.test.ts`'s own `defineGraphNode` describe
 * block (M4) explicitly deferred: *invoking* a compiled graph through the
 * real sandbox, not just registering node types in it. `@forge/graph-runtime`'s
 * own `dist/guest-bundle.js` — the exact artifact `forge export`/the
 * player ship — is loaded off disk and run through a real
 * `ModuleBridge`/QuickJS instance here, the same "prove it through the
 * real sandbox, not a fake context" discipline
 * `packages/runtime-host/test/moduleBridge.test.ts` already established.
 * `packages/modules/graph-runtime/test/*.test.ts`'s own fake-context
 * tests cover the compiler/interpreter's *logic* in detail; this file
 * proves that logic still works once it's actually inside QuickJS,
 * reached through `ctx.defineGraphNode`'s real bridge (M4) and `ctx.config`'s
 * real prelude injection — nothing about the sandbox boundary is faked
 * here.
 */
const GUEST_BUNDLE_PATH = fileURLToPath(
  new URL("../../modules/graph-runtime/dist/guest-bundle.js", import.meta.url),
);

function readGuestBundle(): string {
  try {
    return readFileSync(GUEST_BUNDLE_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `graphRuntimeGuestBundle.test.ts: couldn't read ${GUEST_BUNDLE_PATH} — run "pnpm --filter @forge/graph-runtime run build" first (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function makeHarness() {
  const world = new World();
  const events = new EventBusImpl();
  const scheduler = new Scheduler(world, { events });
  const interceptors = new InterceptorRegistry();
  const graphNodes = new GraphNodeRegistry();
  return { world, scheduler, events, interceptors, graphNodes };
}

const bridges: ModuleBridge[] = [];
async function createBridge(
  moduleName: string,
  harness: ReturnType<typeof makeHarness>,
  config: Readonly<Record<string, unknown>>,
) {
  const bridge = await ModuleBridge.create({
    version: "1.0.0",
    engineVersion: "0.0.0-test",
    config,
    memoryLimitBytes: 16 * 1024 * 1024,
    maxStackSizeBytes: 1024 * 1024,
    computeBudgetMs: 500,
    moduleName,
    world: harness.world,
    scheduler: harness.scheduler,
    events: harness.events,
    interceptors: harness.interceptors,
    graphNodes: harness.graphNodes,
  });
  bridges.push(bridge);
  return bridge;
}

afterEach(() => {
  while (bridges.length > 0) bridges.pop()!.dispose();
});

describe("@forge/graph-runtime's real guest bundle, run through a real ModuleBridge/QuickJS sandbox (M5)", () => {
  it("registers every core node type via the real defineGraphNode bridge (M4) when loaded in the sandbox", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@forge/graph-runtime", harness, {});
    const outcome = await bridge.setup(readGuestBundle());
    expect(outcome.ok).toBe(true);
    expect(harness.graphNodes.get("core:onEvent")?.moduleName).toBe("@forge/graph-runtime");
    expect(harness.graphNodes.get("core:destroyEntity")?.moduleName).toBe("@forge/graph-runtime");
    expect(harness.graphNodes.size).toBeGreaterThanOrEqual(19);
  });

  it("compiles and interprets a real config.graphs document end to end: an event fired on the host side destroys an entity via the sandboxed interpreter", async () => {
    const harness = makeHarness();
    const graphs = [
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
    ];
    // A component must be registered (via a real ctx.defineComponent call,
    // same as any module would) before World.create() can use it — this
    // small helper bridge stands in for whatever first-party/third-party
    // module would normally own the "Health" component in a real project;
    // @forge/graph-runtime itself never defines game components (docs/adr/0017
    // — it's a pure interpreter over whatever components already exist).
    const helper = await createBridge("test-health-component", harness, {});
    const helperOutcome = await helper.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Health", { hp: { type: "f64" } }, { hp: 0 });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(helperOutcome.ok).toBe(true);

    const bridge = await createBridge("@forge/graph-runtime", harness, { graphs });
    const outcome = await bridge.setup(readGuestBundle());
    expect(outcome.ok).toBe(true);

    const entity = harness.world.create({ Health: { hp: 10 } });
    harness.world.flush();
    expect(harness.world.has(entity, "Health")).toBe(true);

    harness.events.emit("enemy:died", entity);

    expect(harness.world.has(entity, "Health")).toBe(false);
  });

  it("skips a malformed graph in config.graphs without crashing setup() inside the sandbox", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@forge/graph-runtime", harness, { graphs: [{ id: "bad" }] });
    const outcome = await bridge.setup(readGuestBundle());
    expect(outcome.ok).toBe(true);
  });
});
