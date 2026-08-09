import {
  EventBusImpl,
  InterceptorRegistry,
  Scheduler,
  World,
  type ComponentFieldType,
  type ComponentSchema,
} from "@forge/core";
import type {
  ComponentHandle,
  ComponentJsonSchema,
  ComponentShape,
  EntityId,
  EntityView,
  EventBus,
  InputSnapshot,
  InterceptorMap,
  Logger,
  SceneApi,
  SetupContext,
  StorageApi,
  SystemDefinition,
  TickContext,
  WorldApi,
} from "@forge/module-api";

/**
 * A hand-rolled, UNSANDBOXED `SetupContext`/`WorldApi` that runs a
 * first-party module directly against a real `@forge/core` `World`, for
 * the editor's live preview (Phase 7). This is deliberately not the
 * sandboxed path — `packages/runtime-host`'s QuickJS-in-Worker bridge
 * (M2) is, and remains, the only place THIRD-PARTY module code is ever
 * allowed to run (CLAUDE.md 1.1.1, "not temporarily for testing").
 * `@forge/dialogue` is code Forge itself ships and controls, not
 * installed from a marketplace — running it directly here is a
 * contained, documented exception, not a precedent. Once M6/M7 make
 * third-party modules installable and previewable, THIS path must not be
 * reused for those; they need the real sandbox pipeline runtime-host
 * already built.
 *
 * `@forge/module-api`'s `WorldApi`/`SetupContext` are just interfaces —
 * runtime-host's own implementation is built entirely around QuickJS's
 * JSON-marshalled snapshot/write-batch protocol (docs/adr/0005), so
 * there was nothing to reuse unsandboxed. This composes the same real
 * primitives runtime-host's sandboxed path eventually calls into
 * (`@forge/core`'s `World`, `Scheduler`, `EventBusImpl`,
 * `InterceptorRegistry`) directly, without a Worker or WASM interpreter
 * in between.
 */

const FIELD_TYPE_FOR: Record<"number" | "boolean", ComponentFieldType> = { number: "f64", boolean: "bool" };

interface ModuleRuntime {
  readonly world: World;
  readonly scheduler: Scheduler;
  readonly events: EventBusImpl<Record<string, unknown>>;
  readonly interceptors: InterceptorRegistry<InterceptorMap>;
  readonly ctx: SetupContext;
}

const NOOP_INPUT: InputSnapshot = {
  isActionDown: () => false,
  wasActionPressed: () => false,
  wasActionReleased: () => false,
  pointerPosition: { x: 0, y: 0 },
};

const NOOP_SCENE: SceneApi = {
  currentSceneId: "preview",
  transitionTo: () => {},
};

const NOOP_STORAGE: StorageApi = {
  get: () => null,
  set: () => {},
  delete: () => {},
};

function makeLogger(moduleName: string): Logger {
  const log = (level: "debug" | "info" | "warn" | "error", message: string, data?: Readonly<Record<string, unknown>>) => {
    const fn = level === "debug" ? console.debug : level === "info" ? console.info : level === "warn" ? console.warn : console.error;
    fn(`[forge:preview:${moduleName}] ${message}`, data ?? {});
  };
  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
  };
}

/**
 * Wraps a real `@forge/core` `World`, converting between module-api's
 * plain `number | boolean` field values and core's numbers-only storage
 * (core's `ComponentFieldValues` is `Record<string, number>` — booleans
 * are stored as 0/1, per `packages/core/src/ecs/component.ts`'s own doc
 * comment on why there's no boolean field type distinct from a number
 * one). Boolean field names are tracked per component (from the schema
 * `defineComponent` was called with) so `get` can convert 0/1 back to a
 * real `true`/`false` — the type module-api's contract actually promises.
 */
class DirectWorldApi implements WorldApi {
  private readonly booleanFieldsByComponent = new Map<string, ReadonlySet<string>>();

  constructor(private readonly world: World) {}

  registerBooleanFields(component: string, fields: ReadonlySet<string>): void {
    this.booleanFieldsByComponent.set(component, fields);
  }

  private toStorage(component: string, value: Readonly<Record<string, unknown>>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value)) {
      out[key] = typeof raw === "boolean" ? (raw ? 1 : 0) : (raw as number);
    }
    return out;
  }

  private fromStorage<T>(component: string, value: Record<string, number> | undefined): T | undefined {
    if (!value) return undefined;
    const booleans = this.booleanFieldsByComponent.get(component);
    if (!booleans || booleans.size === 0) return value as unknown as T;
    const out: Record<string, unknown> = { ...value };
    for (const field of booleans) out[field] = Boolean(value[field]);
    return out as T;
  }

  create(components?: Readonly<Record<string, unknown>>): EntityId {
    const converted: Record<string, Record<string, number>> = {};
    if (components) {
      for (const [name, value] of Object.entries(components)) {
        converted[name] = this.toStorage(name, value as Record<string, unknown>);
      }
    }
    return this.world.create(converted);
  }

  destroy(id: EntityId): void {
    this.world.destroy(id);
  }

  has(id: EntityId, component: string): boolean {
    return this.world.has(id, component);
  }

  get<T = Record<string, unknown>>(id: EntityId, component: string): Readonly<T> | undefined {
    return this.fromStorage<T>(component, this.world.get<ComponentSchema>(id, component));
  }

  set<T = Record<string, unknown>>(id: EntityId, component: string, value: Partial<T>): void {
    this.world.set(id, component, this.toStorage(component, value as Record<string, unknown>));
  }

  add<T = Record<string, unknown>>(id: EntityId, component: string, value: T): void {
    this.world.add(id, component, this.toStorage(component, value as Record<string, unknown>));
  }

  remove(id: EntityId, component: string): void {
    this.world.remove(id, component);
  }

  query(components: readonly string[]): EntityView {
    const query = this.world.query(components);
    return {
      get count() {
        return query.count();
      },
      forEach: (fn) => query.forEach((entity) => fn(entity)),
    };
  }
}

/**
 * Boots a fresh, isolated ECS world and a `SetupContext` for `moduleName`,
 * then runs `module.setup(ctx)` — mirroring exactly what
 * `packages/runtime-host`'s sandboxed bridge does at the API-contract
 * level, minus the sandbox. Returns the pieces the preview needs to keep
 * driving the simulation: `scheduler.tick(dtMs)` every frame, and
 * `events`/`world` to trigger and observe module behavior (e.g.
 * `dialogue:start`) from outside.
 */
export function createModuleRuntime(moduleName: string, config: Readonly<Record<string, unknown>>): ModuleRuntime {
  const world = new World();
  const scheduler = new Scheduler(world);
  const events = new EventBusImpl<Record<string, unknown>>();
  const interceptors = new InterceptorRegistry<InterceptorMap>();
  const directWorld = new DirectWorldApi(world);
  const log = makeLogger(moduleName);

  const ctx: SetupContext = {
    config,
    engineVersion: "0.0.0-preview",
    moduleName,
    world: directWorld,
    defineComponent<T extends ComponentShape>(name: string, schema: ComponentJsonSchema, defaults: T): ComponentHandle<T> {
      const coreSchema: Record<string, ComponentFieldType> = {};
      const booleanFields = new Set<string>();
      for (const [field, fieldSchema] of Object.entries(schema)) {
        coreSchema[field] = FIELD_TYPE_FOR[fieldSchema.type];
        if (fieldSchema.type === "boolean") booleanFields.add(field);
      }
      directWorld.registerBooleanFields(name, booleanFields);
      const numericDefaults: Record<string, number> = {};
      for (const [field, value] of Object.entries(defaults)) {
        numericDefaults[field] = typeof value === "boolean" ? (value ? 1 : 0) : (value as number);
      }
      world.defineComponent(name, coreSchema, numericDefaults);
      return { name };
    },
    addSystem(def: SystemDefinition): void {
      scheduler.addSystem({
        id: def.id,
        phase: def.phase,
        query: def.query,
        // exactOptionalPropertyTypes: only include these keys when
        // actually defined, rather than assigning `undefined` to an
        // optional property.
        ...(def.before !== undefined ? { before: def.before } : {}),
        ...(def.after !== undefined ? { after: def.after } : {}),
        ...(def.skipIfEmpty !== undefined ? { skipIfEmpty: def.skipIfEmpty } : {}),
        // Deliberately unannotated: TS infers core's own TickContext/Query
        // types here contextually (from Scheduler.addSystem's parameter
        // type), which is what this callback is actually invoked with —
        // annotating with module-api's same-named TickContext would be
        // wrong (that one has `world: WorldApi`, not core's `world: World`).
        run(coreCtx, coreQuery) {
          const moduleCtx: TickContext = {
            dt: coreCtx.dt,
            alpha: coreCtx.alpha,
            elapsed: coreCtx.elapsed,
            frame: coreCtx.frame,
            world: directWorld,
            input: NOOP_INPUT,
            scene: NOOP_SCENE,
          };
          const entities: EntityView = {
            get count() {
              return coreQuery.count();
            },
            forEach: (fn) => coreQuery.forEach((entity) => fn(entity)),
          };
          def.run(moduleCtx, entities);
        },
      });
    },
    events: events as unknown as EventBus,
    // Core's InterceptorRegistry hands its callback a *core* ctx
    // ({world: World}), not module-api's ({world: WorldApi}) — the
    // callback here ignores whatever core passes and substitutes the
    // module-api-shaped ctx the module's own `fn` actually expects.
    addInterceptor(point, priority, fn) {
      interceptors.add(point, priority, (value) => fn(value, { world: directWorld }), moduleName);
    },
    runInterceptor(point, value) {
      return interceptors.run(point, value, { world });
    },
    storage: NOOP_STORAGE,
    log,
  };

  return { world, scheduler, events, interceptors, ctx };
}
