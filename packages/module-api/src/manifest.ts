/** Per docs/SPEC.md Section 10.3. */
export type CapabilityName =
  | "render"
  | "audio"
  | "storage:local"
  | "storage:global"
  | "network"
  | "input:raw"
  | "clipboard"
  | "player-identity";

export interface ModuleAuthor {
  readonly name: string;
  readonly userId: string;
}

export interface ModuleProvides {
  readonly components?: readonly string[];
  readonly systems?: readonly string[];
  readonly graphNodes?: readonly string[];
  readonly editorPanels?: readonly string[];
  readonly assets?: readonly string[];
}

export interface ModuleEntryPoints {
  readonly runtime: string;
  /** Editor-only code. Must never ship inside a published game — docs/SPEC.md Section 9.2. */
  readonly editor?: string;
}

/** Per docs/SPEC.md Section 9.2. */
export interface ModuleManifest {
  readonly schemaVersion: number;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly summary: string;
  readonly author: ModuleAuthor;
  readonly license: string;
  /** Semver range of compatible engine versions. */
  readonly engine: string;
  readonly kind: "module";
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly capabilities?: readonly CapabilityName[];
  readonly provides?: ModuleProvides;
  /** Compiles to a Zod schema (CLAUDE.md Section 2.2) for validating `SetupContext.config`. Kept as `unknown` here — the JSON Schema meta-shape is not this package's concern. */
  readonly configSchema?: unknown;
  readonly saveSchemaVersion?: number;
  readonly entry: ModuleEntryPoints;
}
