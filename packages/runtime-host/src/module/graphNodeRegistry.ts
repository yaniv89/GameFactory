import type { GraphSocketDefinition } from "@forge/module-api";
import type { QuickJSHandle } from "quickjs-emscripten";

/**
 * What `ModuleBridge`'s `__forge_defineGraphNode` captures when a
 * module's sandboxed `setup()` calls `ctx.defineGraphNode(def)` — the
 * host-side record of one `GraphNodeDefinition` (`@forge/module-api`).
 * `inputs`/`outputs` cross the boundary as plain JSON (same shape
 * `__forge_defineComponent`'s schema/defaults args already use);
 * `executeHandle` is a live, `.dup()`'d guest function handle — the same
 * "the host calls back into guest code later" shape
 * `__forge_addSystem`/`__forge_addInterceptor` already establish for a
 * callback that isn't JSON-serializable in the first place
 * (docs/security/SANDBOX-DESIGN.md Section 4.2).
 *
 * M4's own scope stops at registration (docs/adr/0017 Decision 4's task
 * split: "proving a third-party-shaped node type end-to-end"). Nothing
 * calls `executeHandle` yet — `@forge/graph-runtime` (M5) is what defines
 * the actual invocation protocol (what a host-marshaled
 * `GraphNodeExecutionContext` looks like crossing the boundary), which
 * doesn't exist yet and isn't guessed at here.
 */
export interface RegisteredGraphNode {
  readonly type: string;
  readonly moduleName: string;
  readonly inputs: readonly GraphSocketDefinition[];
  readonly outputs: readonly GraphSocketDefinition[];
  readonly executeHandle: QuickJSHandle;
}

/**
 * Shared across every `ModuleBridge` in one project, the same way
 * `World`/`Scheduler`/`EventBusImpl`/`InterceptorRegistry` already are
 * (`ModuleBridgeOptions`) — a graph node type registered by one module is
 * available to a graph regardless of which module's `setup()` happened to
 * declare it, matching how `defineComponent`'s components and
 * `addInterceptor`'s filter points are already shared, not
 * per-module-scoped.
 */
export class GraphNodeRegistry {
  private readonly nodes = new Map<string, RegisteredGraphNode>();

  /** Throws on a duplicate `type` — two modules silently overwriting each other's node type would be a real correctness bug, not a case to paper over. */
  register(node: RegisteredGraphNode): void {
    const existing = this.nodes.get(node.type);
    if (existing) {
      throw new Error(
        `GraphNodeRegistry: node type "${node.type}" is already registered by module "${existing.moduleName}" (attempted again by "${node.moduleName}")`,
      );
    }
    this.nodes.set(node.type, node);
  }

  get(type: string): RegisteredGraphNode | undefined {
    return this.nodes.get(type);
  }

  get size(): number {
    return this.nodes.size;
  }
}
