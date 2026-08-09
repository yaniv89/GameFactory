/**
 * Per docs/SPEC.md Section 8.5: a snapshot of the ECS world plus
 * module-owned global state. This is the public shape modules see via
 * `migrateSave` and the `save:beforeWrite`/`save:afterRead` interceptor
 * points (`interceptors.ts`) — the actual save/load implementation
 * lives in `@forge/core` (Milestone M3), not here; this package only
 * describes the contract.
 */
export interface SaveFile {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly projectId: string;
  readonly buildId: string;
  readonly createdAt: string;
  readonly playtimeSec: number;
  /** Version of each installed module at save time. Drives migration. */
  readonly moduleVersions: Readonly<Record<string, string>>;
  readonly world: {
    readonly entities: ReadonlyArray<{
      readonly id: number;
      readonly definitionRef?: string;
      readonly components: Readonly<Record<string, unknown>>; // namespaced keys
    }>;
    readonly nextEntityId: number;
  };
  /** Namespaced: `"@acme/weather:state"`. */
  readonly globals: Readonly<Record<string, unknown>>;
  readonly flags: Readonly<Record<string, boolean | number | string>>;
  readonly currentScene: string;
  /** Preserved verbatim for modules not currently installed — never dropped, per Section 8.5's mitigation 4. */
  readonly _orphaned: Readonly<Record<string, unknown>>;
}
