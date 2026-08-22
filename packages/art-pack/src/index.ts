// Explicit ".js" extensions on every relative export below (unlike most
// other packages' extensionless style): `packages/cli`'s `forge export`
// (K1 Phase 2b) is the first consumer of this package whose own compiled
// dist/ output is ever `node`-executed directly rather than passed
// through a bundler (Vite) or Vitest's esbuild transform — neither of
// which cares about extensions, but plain Node's ESM loader does
// (confirmed the same way packages/player/src/gameLogic.ts's own doc
// comment already documents this exact gap: run it, don't assume it).
export * from "./manifest.js";
export * from "./capabilityProfiles.js";
export * from "./validate.js";
export * from "./resolveAsset.js";
export * from "./diffPackSwap.js";
