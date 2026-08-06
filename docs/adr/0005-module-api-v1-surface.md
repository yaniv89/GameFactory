# 5. Module API v1 surface and the WorldApi bridging mechanism

Date: 2026-08-06

## Status

Accepted.

## Context

M3's exit criterion (`CLAUDE.md` Section 8) is "lint rule proving public-API-only is green; save survives module uninstall/reinstall." `docs/SPEC.md` Section 9 already specs the shape of the public surface in detail — `ForgeModule`, `SetupContext`, `SystemDefinition`/`Phase`/`TickContext`, `WorldApi`, `InterceptorMap`, the module manifest JSON schema. `packages/module-api` is "types and constants only. Zero runtime code, zero dependencies" (CLAUDE.md Section 3.1), and CLAUDE.md Section 1.2 guardrail 12 makes this expensive to get wrong: "Never break the public Module API within a major version. Additive changes only."

The open question this ADR has to resolve before the types can be written: **`SetupContext.world` (a `WorldApi`) has to be implemented by something, for a module running inside the QuickJS sandbox — and that something has to actually work at the call frequency real systems need it at.**

`docs/SPEC.md` Section 10.2 already flagged this as a real cost: QuickJS-in-WASM has "a serialization boundary for world access," mitigated by "keeping hot paths... in core native JS, and exposing the ECS component arrays as a `SharedArrayBuffer` view so modules read and write component data directly without message passing." But `docs/adr/0004` explicitly deferred that `SharedArrayBuffer` fast-path: "not part of this design and is not being built in M2... needs its own dedicated adversarial review before it's added."

The capability bridge built in M2 Phase 4 (`packages/runtime-host/src/sandbox/bridge.ts`) is a JSON-marshaled `__hostCall`/`__hostCallAsync` dispatcher — proven correct and secure for occasional calls (`storage.get`, `network.fetch`). It was not designed for what `WorldApi.get`/`.set`/`.query` actually need: a system's `run()` can touch dozens to thousands of entities' component fields in a single fixed-step tick. Naively routing every individual `world.get(id, "Transform")` through a full JSON-stringify/dispatch/JSON-parse round trip would make the bridge itself the bottleneck, defeating M1's whole zero-allocation, sub-millisecond-per-system performance work before a single third-party system runs.

## Decision

**System execution gets one batched JSON round trip per system per tick, not one per field access — reusing the deferred-write pattern `@forge/core`'s own `CommandBuffer` already established, rather than inventing a new mechanism.**

Concretely, when a module's `addSystem(def)`-registered system is due to run for a fixed step:

1. **Host-side, before calling into the guest**: the runtime-host bridge resolves `def.query` against the real `World`, walks the matching archetypes' chunks (the same `forEachChunk` path `@forge/core`'s own systems use — no new query mechanism), and serializes the matching entities' *declared-query* component fields into one JSON snapshot. This is the only read-side cost, and it's proportional to what the system actually queried, not the whole world.
2. **One bridge call**: that snapshot, plus the tick's `dt`/`alpha`/`elapsed`/`frame`, crosses into the guest as a single `__hostCall` invocation. The guest's `run(ctx, entities)` — where `entities` is a plain-JS array/iterator over the snapshot, not live handles — executes entirely against that in-memory snapshot. `WorldApi.get()` calls the module makes during `run()` are served from this snapshot, not a fresh round trip each time.
3. **`WorldApi.set()`/`.add()`/`.remove()`/`.create()`/`.destroy()` calls the guest makes during `run()` are queued host-side in the snapshot's return payload**, not applied immediately — exactly the semantics `CommandBuffer` (`packages/core/src/ecs/commandBuffer.ts`) already gives *native* systems for structural changes. This ADR extends that same deferred-application discipline to sandboxed systems' *data* writes too, for the same reason: correctness under concurrent iteration, and now also because it's what makes a single round trip sufficient.
4. **After `run()` returns**, the host applies the queued writes to the real `World` in one pass and calls `world.flush()` as usual.

This means a system with an empty query still costs nothing extra (the scheduler's own `skipIfEmpty` already prevents the call), and a system touching 500 entities costs one serialize + one bridge call + one deserialize + one batch-apply per tick — not 500 round trips.

**Explicitly not decided here**: whether this is fast enough at real scale. That's an empirical question for `tools/bench` once it exists for the sandboxed case, per CLAUDE.md Section 1.5 guardrail 22 ("profile first"). If profiling shows this batched-JSON approach is still too slow for some class of system, the fallback is the `SharedArrayBuffer` path `docs/SPEC.md` already named — deferred, per ADR 0004, until it earns its own dedicated review, not built speculatively now.

### The rest of the v1 surface

Everything else follows `docs/SPEC.md` Section 9 directly, with no changes proposed here:

- `ForgeModule` (`setup`/`teardown`/`migrateSave`), `SetupContext` (`config`, `engineVersion`, `moduleName`, `defineComponent`, `addSystem`, `defineGraphNode`, `events`, `addInterceptor`, `storage`, capability-gated `audio`/`render`/`net`, `log`).
- `SystemDefinition`/`Phase`/`TickContext` match `@forge/core`'s own scheduler types (`packages/core/src/scheduler/`) structurally — `Phase` is literally the same seven-value union already implemented, not a new one.
- `InterceptorMap` and `addInterceptor` map onto `@forge/core`'s already-built `InterceptorRegistry` (`packages/core/src/events/interceptors.ts`) the same way `events`/`EventBus` maps onto `EventBusImpl` — both already exist and already work; this ADR's job is exposing a *narrowed, capability-appropriate* view of them through the sandbox bridge, not rebuilding them.
- `storage`/`net` map directly onto the `storage:local`/`network` `CapabilityHandler`s already built in M2 Phase 4 (`packages/runtime-host/src/sandbox/capabilities/`) — no new capability mechanism, just module-api types describing the same bridge.
- The module manifest JSON schema (`docs/SPEC.md` Section 9.2) becomes a real JSON Schema (or Zod schema compiled to one, per CLAUDE.md Section 2.2's "Module `configSchema` compiles to Zod") validated at install time — implementation detail for the actual M3 work, not this ADR.

### Is this additive-safe within v1 (there is no prior version to break, but stating it for the record per the ADR template)

Yes by construction — this is the *first* version of the surface, so "additive" reduces to "don't ship anything the batched-snapshot model can't support cleanly later." The one thing flagged as a future risk: if a future capability genuinely needs live, sub-tick reactive access to the world (not achievable via a once-per-tick snapshot), that's a new mechanism to design then, not a retrofit of this one — noted so it doesn't get discovered as a surprise breaking change later.

## Consequences

- `packages/runtime-host` gains a new `module/` area (name TBD at implementation time) implementing the snapshot-serialize / batch-apply bridge described above, built on top of the capability-bridge primitives from M2 Phase 4 — not a parallel mechanism.
- `@forge/core`'s `CommandBuffer` pattern is now load-bearing for two callers (native systems' structural changes, and sandboxed systems' data writes), which is a good sign it was designed generally enough, not a coincidence to paper over.
- Real performance characterization of the batched-snapshot bridge is deferred to implementation + profiling, consistent with how M1's benchmark harness was built after the mechanism existed, not before.
- `dialogue`, `inventory`, and `turn-battle` (the M3 first-party modules) become the real test of whether this surface is sufficient — per CLAUDE.md Section 3.2, if they can't be built against it, the API is not good enough, and that's found out now rather than after third parties depend on it.
- The save system (`docs/SPEC.md` Section 8.5) needs `moduleVersions` and `_orphaned` handling that reads module-declared `migrateSave` — implemented once this ADR's `ForgeModule` shape exists, tracked as a separate, sequenced piece of M3 work, not blocked on this ADR beyond needing the type to exist.
