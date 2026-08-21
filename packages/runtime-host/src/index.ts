export * from "./sandbox/moduleRuntime";
export * from "./sandbox/capabilities";
export * from "./sandbox/capabilities/storageLocal";
export * from "./sandbox/capabilities/network";
export * from "./module/moduleBridge";
export * from "./module/graphNodeRegistry";
export * from "./module/snapshot";
export * from "./module/writeBatch";
export * from "./save/saveCoordinator";
// Deliberately NOT re-exported here: "./smoke/*" (docs/SPEC.md Section
// 10.4 gate 4) is server-side-only publish-pipeline tooling, never
// something a player's browser build should pull in. This package's own
// tests and `src/smoke/cli.ts` import it directly by path; see
// tsconfig.json's own exclusion of "src/smoke" from this package's
// tsc-emitted dist/ for the other half of keeping it out of the
// CLAUDE.md Section 7 "always shipped" budget.
