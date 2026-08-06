import type { CapabilityHandler } from "../capabilities";

/**
 * `storage:local` per docs/SPEC.md Section 10.3: "Namespaced save data,"
 * implicit consent at install. This implementation is an in-memory store
 * scoped to one `ModuleRuntime` instance — real persistence (the actual
 * save file, docs/SPEC.md Section 8.5) is a later milestone's concern;
 * what this proves now is the capability-bridge pattern end to end with
 * a genuinely simple, self-contained backing store.
 */
export class LocalStorageHandler implements CapabilityHandler {
  readonly capability = "storage:local" as const;
  readonly globalName = "storage";
  readonly syncMethods = ["get", "set", "delete"] as const;

  private readonly store = new Map<string, unknown>();

  /** Full-store dump for the save system (`packages/runtime-host/src/save/saveCoordinator.ts`) — never exposed to the guest, host-side use only. */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }

  /** Replaces the entire store — save-load only. Not guest-visible. */
  restore(data: Readonly<Record<string, unknown>>): void {
    this.store.clear();
    for (const [key, value] of Object.entries(data)) this.store.set(key, value);
  }

  call(method: string, args: readonly unknown[]): unknown {
    switch (method) {
      case "get": {
        const [key] = requireArgs<[string]>(args, 1, "get");
        return this.store.has(key) ? this.store.get(key) : null;
      }
      case "set": {
        const [key, value] = requireArgs<[string, unknown]>(args, 2, "set");
        if (typeof key !== "string") throw new Error("storage.set: key must be a string");
        this.store.set(key, value);
        return null;
      }
      case "delete": {
        const [key] = requireArgs<[string]>(args, 1, "delete");
        this.store.delete(key);
        return null;
      }
      default:
        throw new Error(`storage:local: unknown method "${method}"`);
    }
  }
}

function requireArgs<T extends unknown[]>(args: readonly unknown[], count: number, method: string): T {
  if (args.length < count) {
    throw new Error(`storage.${method}: expected ${count} argument(s), got ${args.length}`);
  }
  return args as unknown as T;
}
