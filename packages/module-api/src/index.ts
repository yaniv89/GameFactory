/**
 * @forge/module-api — the public Module API surface.
 *
 * This package is types and constants ONLY. Zero runtime code, zero
 * dependencies (CLAUDE.md Section 3.1). Any change to its public surface
 * requires an ADR in docs/adr/ (see docs/adr/0005 for the v1 surface's),
 * and CI runs api-extractor against `.api.md` to catch accidental
 * changes.
 */
export const MODULE_API_VERSION = "0.1.0";

export * from "./entity";
export * from "./component";
export * from "./scheduler";
export * from "./world";
export * from "./events";
export * from "./interceptors";
export * from "./capabilities";
export * from "./save";
export * from "./manifest";
export * from "./graph";
export * from "./module";
