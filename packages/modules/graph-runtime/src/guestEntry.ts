import { graphRuntimeModule } from "./index";

declare const __forge_registerModule: (mod: {
  setup: typeof graphRuntimeModule.setup;
}) => void;

/**
 * The one file in this package that is never imported by `index.ts` or
 * anything else here — it's `scripts/build-guest-bundle.mjs`'s own entry
 * point, bundled standalone into a guest-runnable IIFE
 * (`dist/guest-bundle.js`). Everything real still lives in
 * `graphRuntimeModule` itself (`./index`), built against
 * `@forge/module-api` and `@forge/graph-nodes-core` only, same as always;
 * this is purely the `__forge_registerModule(...)` handoff `ModuleBridge`'s
 * own loading convention requires (see its doc comment in
 * `packages/runtime-host/src/module/moduleBridge.ts`), mirrored exactly
 * from `@forge/dialogue`'s own `guestEntry.ts`.
 */
__forge_registerModule({ setup: graphRuntimeModule.setup });
