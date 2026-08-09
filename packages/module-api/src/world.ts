import type { EntityId } from "./entity";
import type { EntityView } from "./scheduler";

/**
 * The narrow, capability-free view of the ECS a module gets inside
 * `TickContext`/`SetupContext`. Per `docs/adr/0005`, reads made during a
 * system's `run()` are served from a per-tick snapshot taken once for
 * that system's query, and writes (`set`/`add`/`remove`/`create`/
 * `destroy`) are queued and applied in one batch after `run()` returns —
 * the same deferred-application discipline `@forge/core`'s own
 * `CommandBuffer` already gives native systems for structural changes,
 * extended here to sandboxed systems' data writes too.
 *
 * Component values are plain JSON-serializable objects (numbers,
 * strings, booleans, nested plain objects/arrays) — never live
 * references, per `docs/security/SANDBOX-DESIGN.md` Section 4.
 */
export interface WorldApi {
  /** Deferred: the entity exists (with the given initial components, if any) once this tick's writes are applied. */
  create(components?: Readonly<Record<string, unknown>>): EntityId;
  /** Deferred. */
  destroy(id: EntityId): void;
  has(id: EntityId, component: string): boolean;
  get<T = Record<string, unknown>>(id: EntityId, component: string): Readonly<T> | undefined;
  /** Deferred. Only fields present in `value` are changed. */
  set<T = Record<string, unknown>>(id: EntityId, component: string, value: Partial<T>): void;
  /** Deferred. */
  add<T = Record<string, unknown>>(id: EntityId, component: string, value: T): void;
  /** Deferred. */
  remove(id: EntityId, component: string): void;
  query(components: readonly string[]): EntityView;
}
