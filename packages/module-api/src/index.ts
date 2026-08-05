/**
 * @forge/module-api — the public Module API surface.
 *
 * This package is types and constants ONLY. Zero runtime code, zero
 * dependencies (CLAUDE.md Section 3.1). Any change to its public surface
 * requires an ADR in docs/adr/, and CI runs api-extractor against
 * `.api.md` to catch accidental changes.
 *
 * The full contract (ForgeModule, SetupContext, WorldApi, InterceptorMap,
 * etc.) is specified in docs/SPEC.md Section 9 and is implemented in
 * Milestone M3. This file is a placeholder export so the package resolves
 * as a valid workspace member before that milestone starts.
 */
export const MODULE_API_VERSION = "0.0.0";
