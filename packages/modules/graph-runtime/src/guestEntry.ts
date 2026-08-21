import { graphRuntimeModule } from "./index";

declare const __forge_registerModule: (mod: {
  setup: typeof graphRuntimeModule.setup;
  teardown?: typeof graphRuntimeModule.teardown;
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
 * `packages/runtime-host/src/module/moduleBridge.ts`), mirrored from
 * `@forge/dialogue`'s own `guestEntry.ts` — with `teardown` also passed
 * through here (dialogue has none to pass), since `ModuleBridge.teardown()`
 * already calls a guest module's own `teardown` if declared, and
 * `graphRuntimeModule` now genuinely needs it (`./index`'s own doc
 * comment on `activeUnsubscribes`).
 */
__forge_registerModule({
  setup: graphRuntimeModule.setup,
  ...(graphRuntimeModule.teardown ? { teardown: graphRuntimeModule.teardown } : {}),
});
