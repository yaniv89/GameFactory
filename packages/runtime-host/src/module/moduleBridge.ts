import type {
  ComponentFieldType,
  EntityId,
  EventBusImpl,
  InterceptorRegistry,
  Phase,
  Query,
  Scheduler,
  TickContext,
  World,
} from "@forge/core";
import { PHASE_ORDER } from "@forge/core";
import type { QuickJSHandle } from "quickjs-emscripten";
import type { CapabilityHandler } from "../sandbox/capabilities";
import { NetworkHandler } from "../sandbox/capabilities/network";
import { LocalStorageHandler } from "../sandbox/capabilities/storageLocal";
import { ModuleRuntime, type EvalOutcome } from "../sandbox/moduleRuntime";
import { buildModulePrelude } from "./prelude";
import { serializeEntitySnapshot, type TickSnapshot } from "./snapshot";
import { applyWriteBatch, type QueuedWrite } from "./writeBatch";

const VALID_PHASES = new Set<string>(PHASE_ORDER);

export interface ModuleBridgeOptions {
  readonly moduleName: string;
  /** The module's own declared version (manifest `version`, docs/SPEC.md Section 9.2) — save/load's `moduleVersions`/`migrateSave` bookkeeping (packages/runtime-host/src/save/saveCoordinator.ts) keys off this, not off `engineVersion`. */
  readonly version: string;
  readonly engineVersion: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly world: World;
  readonly scheduler: Scheduler;
  readonly events: EventBusImpl;
  readonly interceptors: InterceptorRegistry;
  readonly memoryLimitBytes: number;
  readonly maxStackSizeBytes: number;
  readonly computeBudgetMs: number;
  /** Presence grants the `network` capability; absence means `SetupContext.net` is `undefined` in the guest, per the absence-is-the-enforcement pattern in docs/security/SANDBOX-DESIGN.md. */
  readonly networkAllowedOrigins?: readonly string[];
}

function qualify(moduleName: string, id: string): string {
  return `${moduleName}::${id}`;
}

function logModuleMessage(moduleName: string, level: "debug" | "info" | "warn" | "error", message: string, data: unknown): void {
  const prefix = `[forge:module:${moduleName}]`;
  const logger = console[level] ?? console.log;
  if (data !== null && data !== undefined) logger(prefix, message, data);
  else logger(prefix, message);
}

/**
 * Bridges one sandboxed module instance's `SetupContext`/`WorldApi`
 * (`@forge/module-api`) onto real `@forge/core` infrastructure, per
 * docs/adr/0005. One `ModuleBridge` = one `ModuleRuntime` (one QuickJS
 * runtime+context) = one installed module, sharing the caller-supplied
 * `World`/`Scheduler`/`EventBusImpl`/`InterceptorRegistry` with every other
 * module installed in the same project — modules cooperate in one shared
 * game world by design (the WordPress-plugin analogy CLAUDE.md Section 0
 * opens with), so nothing here isolates one module's world access from
 * another's.
 *
 * Module loading convention: the module's compiled source is expected to
 * call `__forge_registerModule({ setup, teardown?, migrateSave? })` as a
 * side effect of evaluating (not to be the eval's completion value — a
 * function-valued completion can't be safely `dump()`ed to a plain JS
 * value, which is what `ModuleRuntime.eval()` always does). A minimal
 * module looks like:
 *
 * ```js
 * (function () {
 *   function setup(ctx) { ctx.addSystem({ id: "move", phase: "Update", query: ["Transform"], run: function (ctx, entities) { ... } }); }
 *   __forge_registerModule({ setup: setup });
 * })();
 * ```
 *
 * v1 limitations, documented rather than silently unsupported:
 * - `before`/`after` system-ordering constraints are scoped to this
 *   module's own systems (ids are namespaced `moduleName::id` internally);
 *   cross-module ordering isn't part of the v1 surface.
 * - `setup()` is called synchronously; a returned `Promise<void>` is not
 *   awaited to completion (tracked: github.com/yaniv89/GameFactory/issues/4).
 * - `TickContext.input`/`.scene` throw `not implemented` — no Input or
 *   Scene system exists in `@forge/core` yet (M4 concern; tracked:
 *   github.com/yaniv89/GameFactory/issues/3).
 */
export class ModuleBridge {
  private readonly ownedHandles = new Set<QuickJSHandle>();
  private setupHandle: QuickJSHandle | undefined;
  private teardownHandle: QuickJSHandle | undefined;
  private migrateSaveHandle: QuickJSHandle | undefined;
  private disposed = false;

  private constructor(
    private readonly runtime: ModuleRuntime,
    private readonly options: ModuleBridgeOptions,
    private readonly storageHandler: LocalStorageHandler,
  ) {}

  get moduleName(): string {
    return this.options.moduleName;
  }

  get moduleVersion(): string {
    return this.options.version;
  }

  static async create(options: ModuleBridgeOptions): Promise<ModuleBridge> {
    const storageHandler = new LocalStorageHandler();
    const capabilities: CapabilityHandler[] = [storageHandler];
    if (options.networkAllowedOrigins) {
      capabilities.push(new NetworkHandler({ allowedOrigins: options.networkAllowedOrigins }));
    }
    const runtime = await ModuleRuntime.create({
      memoryLimitBytes: options.memoryLimitBytes,
      maxStackSizeBytes: options.maxStackSizeBytes,
      computeBudgetMs: options.computeBudgetMs,
      capabilities,
    });
    const bridge = new ModuleBridge(runtime, options, storageHandler);
    bridge.installNativeFunctions();
    const preludeOutcome = bridge.runtime.eval(
      buildModulePrelude(options.moduleName, options.engineVersion, options.config),
    );
    if (!preludeOutcome.ok) {
      bridge.dispose();
      throw new Error(
        `ModuleBridge: failed to install the guest-side prelude for "${options.moduleName}": ${preludeOutcome.error.message}`,
      );
    }
    return bridge;
  }

  /**
   * Evaluates the module's compiled source (expected to call
   * `__forge_registerModule(...)`, see class doc comment) and then calls
   * its `setup(ctx)`. Returns the outcome of whichever step failed first,
   * or of `setup()` itself on success.
   */
  setup(moduleSourceCode: string): EvalOutcome {
    const loadOutcome = this.runtime.eval(moduleSourceCode);
    if (!loadOutcome.ok) return loadOutcome;

    if (!this.setupHandle) {
      return {
        ok: false,
        error: {
          name: "Error",
          message: `Module "${this.options.moduleName}" did not call __forge_registerModule(...) — no setup() was registered`,
        },
      };
    }

    const context = this.runtime.context;
    const ctxHandle = context.getProp(context.global, "__forge_setupContext");
    const outcome = this.runtime.callFunction(this.setupHandle, [ctxHandle]);
    ctxHandle.dispose();
    return outcome;
  }

  /** Calls the module's `teardown(ctx)` if it declared one. No-op otherwise. */
  teardown(): EvalOutcome | undefined {
    if (!this.teardownHandle) return undefined;
    const context = this.runtime.context;
    const teardownCtxHandle = context.newObject();
    const nameHandle = context.newString(this.options.moduleName);
    context.setProp(teardownCtxHandle, "moduleName", nameHandle);
    nameHandle.dispose();
    const outcome = this.runtime.callFunction(this.teardownHandle, [teardownCtxHandle]);
    teardownCtxHandle.dispose();
    return outcome;
  }

  /** This module's `storage:local` contents — the save system's source for `SaveFile.globals[moduleName]` (docs/SPEC.md Section 8.5). Empty object if the module never wrote anything. */
  snapshotStorage(): Record<string, unknown> {
    return this.storageHandler.snapshot();
  }

  /** Replaces this module's `storage:local` contents wholesale — save-load only. */
  restoreStorage(data: Readonly<Record<string, unknown>>): void {
    this.storageHandler.restore(data);
  }

  /**
   * Calls the module's `migrateSave(from, to, data)` if it declared one.
   * Returns `undefined` if it didn't — the save coordinator
   * (packages/runtime-host/src/save/saveCoordinator.ts) is the one that
   * decides whether that's fine (no migration needed) or a hard refusal
   * (a major version bump with no migration path, per docs/SPEC.md
   * Section 8.5 point 1) — this method just reports what happened.
   * Throws if the guest's `migrateSave` itself throws or exceeds its
   * compute budget: a failed migration must not silently drop data.
   */
  migrateSave(from: number, to: number, data: unknown): unknown {
    if (!this.migrateSaveHandle) return undefined;
    const context = this.runtime.context;
    const fromHandle = context.newNumber(from);
    const toHandle = context.newNumber(to);
    const dataHandle = context.newString(JSON.stringify(data === undefined ? null : data));
    const outcome = this.runtime.callFunction(this.migrateSaveHandle, [fromHandle, toHandle, dataHandle]);
    fromHandle.dispose();
    toHandle.dispose();
    dataHandle.dispose();
    if (!outcome.ok) {
      throw new Error(
        `Module "${this.options.moduleName}" migrateSave(${from} -> ${to}) failed: ${outcome.error.message}`,
      );
    }
    return JSON.parse(outcome.value as string);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of this.ownedHandles) {
      try {
        handle.dispose();
      } catch (err) {
        console.error(
          `ModuleBridge.dispose(): failed disposing a guest handle for module "${this.options.moduleName}", continuing cleanup`,
          err,
        );
      }
    }
    this.ownedHandles.clear();
    this.runtime.dispose();
  }

  private logGuestError(where: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[forge:module:${this.options.moduleName}] ${where} failed:`, message);
  }

  private runGuestSystem(localSystemId: string, queryComponents: readonly string[], runHandle: QuickJSHandle, ctx: TickContext, entities: Query): void {
    const context = this.runtime.context;
    try {
      const snapshot: TickSnapshot = {
        dt: ctx.dt,
        alpha: ctx.alpha,
        elapsed: ctx.elapsed,
        frame: ctx.frame,
        entities: serializeEntitySnapshot(this.options.world, entities, queryComponents),
      };
      const payloadHandle = context.newString(JSON.stringify(snapshot));
      const outcome = this.runtime.callFunction(runHandle, [payloadHandle]);
      payloadHandle.dispose();

      if (!outcome.ok) {
        this.logGuestError(`system "${localSystemId}"`, new Error(outcome.error.message));
        return;
      }
      const result = JSON.parse(outcome.value as string) as { writes?: readonly QueuedWrite[] };
      if (result.writes && result.writes.length > 0) {
        applyWriteBatch(this.options.world, result.writes);
      }
    } catch (err) {
      // A bug in this bridge's own snapshot/apply code, not a guest-level
      // failure — still must not propagate into Scheduler.runPhase(), which
      // has no try/catch around a system's run() and would take the whole
      // phase (every other module's systems in it) down with it.
      this.logGuestError(`system "${localSystemId}" (host-side bridge error)`, err);
    }
  }

  private runGuestInterceptor(point: string, fnHandle: QuickJSHandle, value: unknown): unknown {
    const context = this.runtime.context;
    try {
      const valueHandle = context.newString(JSON.stringify(value === undefined ? null : value));
      const outcome = this.runtime.callFunction(fnHandle, [valueHandle]);
      valueHandle.dispose();
      if (!outcome.ok) {
        this.logGuestError(`interceptor "${point}"`, new Error(outcome.error.message));
        return value; // fail open — an interceptor with no opinion is a no-op, per InterceptorRegistry's own "unchanged if none registered" default.
      }
      return JSON.parse(outcome.value as string);
    } catch (err) {
      this.logGuestError(`interceptor "${point}" (host-side bridge error)`, err);
      return value;
    }
  }

  private invokeGuestEventHandler(event: string, handlerFn: QuickJSHandle, payload: unknown): void {
    const context = this.runtime.context;
    try {
      const payloadHandle = context.newString(JSON.stringify(payload === undefined ? null : payload));
      const outcome = this.runtime.callFunction(handlerFn, [payloadHandle]);
      payloadHandle.dispose();
      if (!outcome.ok) {
        this.logGuestError(`event handler for "${event}"`, new Error(outcome.error.message));
      }
    } catch (err) {
      this.logGuestError(`event handler for "${event}" (host-side bridge error)`, err);
    }
  }

  private installNativeFunctions(): void {
    const context = this.runtime.context;
    const moduleName = this.options.moduleName;

    this.installFn("__forge_addSystem", (idHandle, phaseHandle, queryJsonHandle, optionsJsonHandle, runFnHandle) => {
      const id = context.getString(idHandle);
      const phase = context.getString(phaseHandle);
      if (!VALID_PHASES.has(phase)) {
        throw new Error(`addSystem: unknown phase "${phase}"`);
      }
      const query = JSON.parse(context.getString(queryJsonHandle)) as string[];
      const opts = JSON.parse(context.getString(optionsJsonHandle)) as {
        before: string[];
        after: string[];
        skipIfEmpty: boolean;
      };
      const runHandle = runFnHandle.dup();
      this.ownedHandles.add(runHandle);
      this.options.scheduler.addSystem({
        id: qualify(moduleName, id),
        phase: phase as Phase,
        query,
        before: opts.before.map((b) => qualify(moduleName, b)),
        after: opts.after.map((a) => qualify(moduleName, a)),
        skipIfEmpty: opts.skipIfEmpty,
        run: (ctx, entities) => this.runGuestSystem(id, query, runHandle, ctx, entities),
      });
    });

    this.installFn("__forge_addInterceptor", (pointHandle, priorityHandle, fnHandle) => {
      const point = context.getString(pointHandle);
      const priority = context.getNumber(priorityHandle);
      const fn = fnHandle.dup();
      this.ownedHandles.add(fn);
      this.options.interceptors.add(point, priority, (value) => this.runGuestInterceptor(point, fn, value), moduleName);
    });

    this.installFn("__forge_runInterceptor", (pointHandle, valueJsonHandle) => {
      const point = context.getString(pointHandle);
      const value = JSON.parse(context.getString(valueJsonHandle));
      const result = this.options.interceptors.run(point, value, { world: this.options.world });
      return context.newString(JSON.stringify(result));
    });

    this.installFn("__forge_eventsOn", (eventHandle, handlerFnHandle) => {
      const event = context.getString(eventHandle);
      const handlerFn = handlerFnHandle.dup();
      this.ownedHandles.add(handlerFn);
      const unsubscribeCore = this.options.events.on(event, (payload) => this.invokeGuestEventHandler(event, handlerFn, payload));
      return context.newFunction("unsubscribe", () => {
        unsubscribeCore();
        if (this.ownedHandles.delete(handlerFn)) handlerFn.dispose();
      });
    });

    this.installFn("__forge_eventsEmit", (eventHandle, payloadJsonHandle) => {
      const event = context.getString(eventHandle);
      const payload = JSON.parse(context.getString(payloadJsonHandle));
      this.options.events.emit(event, payload);
    });

    this.installFn("__forge_defineComponent", (nameHandle, schemaJsonHandle, defaultsJsonHandle) => {
      const name = context.getString(nameHandle);
      const schemaIn = JSON.parse(context.getString(schemaJsonHandle)) as Record<string, { type: "number" | "boolean" }>;
      const defaultsIn = JSON.parse(context.getString(defaultsJsonHandle)) as Record<string, number | boolean>;
      const schema: Record<string, ComponentFieldType> = {};
      const defaults: Record<string, number> = {};
      for (const field of Object.keys(schemaIn)) {
        schema[field] = schemaIn[field]!.type === "boolean" ? "bool" : "f64";
        const d = defaultsIn[field];
        defaults[field] = typeof d === "boolean" ? (d ? 1 : 0) : ((d as number | undefined) ?? 0);
      }
      this.options.world.defineComponent(name, schema, defaults);
      return context.newString(name);
    });

    this.installFn("__forge_log", (levelHandle, messageHandle, dataJsonHandle) => {
      const level = context.getString(levelHandle) as "debug" | "info" | "warn" | "error";
      const message = context.getString(messageHandle);
      const data = JSON.parse(context.getString(dataJsonHandle));
      logModuleMessage(moduleName, level, message, data);
    });

    this.installFn("__forge_world", (methodHandle, argsJsonHandle) => {
      const method = context.getString(methodHandle);
      const args = JSON.parse(context.getString(argsJsonHandle)) as unknown[];
      const world = this.options.world;
      let result: unknown;
      switch (method) {
        case "get":
          result = world.get(args[0] as EntityId, args[1] as string) ?? null;
          break;
        case "has":
          result = world.has(args[0] as EntityId, args[1] as string);
          break;
        case "query": {
          const q = world.query(args[0] as string[]);
          const ids: EntityId[] = [];
          q.forEach((e) => ids.push(e));
          result = ids;
          break;
        }
        // create/destroy/add/remove are deferred in @forge/core (World's own
        // doc comment: "applied by World.flush() at a phase boundary") —
        // but ctx.world's whole point (docs/adr/0006) is a live, immediately-
        // visible view, unlike a system's snapshot-batched WorldApi. There's
        // no cross-system-ordering hazard in flushing eagerly here (unlike
        // inside a system's write-batch apply): these calls only ever happen
        // from setup() or an event handler, never mid-tick inside a phase.
        case "create":
          result = world.create(args[0] as Record<string, Record<string, number>>);
          world.flush();
          break;
        case "destroy":
          world.destroy(args[0] as EntityId);
          world.flush();
          break;
        case "add":
          world.add(args[0] as EntityId, args[1] as string, args[2] as Record<string, number>);
          world.flush();
          break;
        case "remove":
          world.remove(args[0] as EntityId, args[1] as string);
          world.flush();
          break;
        case "set":
          world.set(args[0] as EntityId, args[1] as string, args[2] as Record<string, number>);
          break;
        default:
          throw new Error(`__forge_world: unknown method "${method}"`);
      }
      return context.newString(JSON.stringify(result === undefined ? null : result));
    });

    this.installFn("__forge_registerModuleNative", (moduleHandle) => {
      const setupProp = context.getProp(moduleHandle, "setup");
      if (context.typeof(setupProp) !== "function") {
        setupProp.dispose();
        throw new Error(`Module "${moduleName}": setup must be a function`);
      }
      this.setupHandle = setupProp;
      this.ownedHandles.add(setupProp);

      const teardownProp = context.getProp(moduleHandle, "teardown");
      if (context.typeof(teardownProp) === "function") {
        this.teardownHandle = teardownProp;
        this.ownedHandles.add(teardownProp);
      } else {
        teardownProp.dispose();
      }

      const migrateProp = context.getProp(moduleHandle, "migrateSave");
      if (context.typeof(migrateProp) === "function") {
        this.migrateSaveHandle = migrateProp;
        this.ownedHandles.add(migrateProp);
      } else {
        migrateProp.dispose();
      }
    });
  }

  /** `context.newFunction` + `setProp` onto global + dispose the installer's own handle, per the pattern established in sandbox/bridge.ts. */
  private installFn(name: string, impl: (...args: QuickJSHandle[]) => QuickJSHandle | void): void {
    const context = this.runtime.context;
    const handle = context.newFunction(name, impl);
    context.setProp(context.global, name, handle);
    handle.dispose();
  }
}
