import { dialogueModule } from "./index";

declare const __forge_registerModule: (mod: {
  setup: typeof dialogueModule.setup;
}) => void;

/**
 * The one file in this package that is never imported by `index.ts` or
 * anything else here — it's `scripts/build-guest-bundle.mjs`'s own entry
 * point, bundled standalone into a guest-runnable IIFE
 * (`dist/guest-bundle.js`). Everything real still lives in `dialogueModule`
 * itself (`./index`), built against `@forge/module-api` only, same as
 * always; this is purely the `__forge_registerModule(...)` handoff
 * `ModuleBridge`'s own loading convention requires (see its doc comment in
 * `packages/runtime-host/src/module/moduleBridge.ts`) — the same call
 * `PreviewApp`'s unsandboxed `directModuleHost.ts` never needed, since it
 * calls `dialogueModule.setup` directly instead of through the sandbox.
 */
__forge_registerModule({ setup: dialogueModule.setup });
