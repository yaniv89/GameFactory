# 6. Module API gains `SetupContext.runInterceptor` and `SetupContext.world` — a module can trigger a chain it owns, and reach the world outside a system tick

## Status

Accepted.

## Context

M3 Phase 5 is building `@forge/dialogue` against `@forge/module-api` only, per CLAUDE.md Section 3.2 — "if dialogue, inventory, and turn-battle cannot be built with the public API, the public API is not good enough, and you find that out in week three instead of year two." This is that finding.

`docs/SPEC.md` Section 9.4 describes the interceptor mechanism as a WordPress-style filter chain: "a Module transforms a value in a priority-ordered chain without patching the producer." `InterceptorMap` (`packages/module-api/src/interceptors.ts`) already lists `dialogue:line` and `dialogue:choices` as named points — the clear intent is that the dialogue module's own output for a line/choice set flows through this chain so a third-party module (a localization pack, a text-effects module) can transform it before it reaches the player, exactly as a WordPress theme filters `the_content`.

The v1 surface only has half of that mechanism. `SetupContext.addInterceptor(point, priority, fn)` lets a module *join* a chain. Nothing lets a module *run* one. `InterceptorRegistry.run()` (`packages/core/src/events/interceptors.ts`) exists and works — `ModuleBridge`'s own `__forge_addInterceptor` wiring (M3 Phase 3) already calls it — but only the *host* was ever wired to trigger it (a system reading a query, an interceptor's own registered handler running as part of the chain). Nothing gave a *module* the ability to be the thing that starts a chain for a point it conceptually owns.

Without this, `@forge/dialogue` cannot use `dialogue:line`/`dialogue:choices` for their stated purpose at all — the only mechanism left in v1 is `events.emit`, which is fire-and-forget pub/sub with no return value and no priority ordering, a fundamentally different (and here, wrong) mechanism per SPEC 9.3's own description of `EventBus` vs. `InterceptorRegistry`'s different roles.

**A second, related gap surfaced by the same exercise**: `SetupContext` has no `world: WorldApi` at all. `docs/adr/0005`'s own opening line frames the problem it exists to solve as "`SetupContext.world` (a `WorldApi`) has to be implemented by something" — but the type that landed in M3 Phase 2 (`packages/module-api/src/module.ts`) never actually added the field, only `TickContext.world` (a system's per-tick, snapshot-backed view) and `InterceptorContext.world` (an interceptor callback's live view) exist. `@forge/dialogue`'s `dialogue:choose` event handler needs to read and write a `DialogueState` component in response to a player's choice — an entirely ordinary "something happened, react by touching the world" pattern, not a per-tick simulation concern and not an interceptor. There is currently no way to do that outside of a system's `run()` or an interceptor's callback, which is not where event handlers live.

## Decision (part 2)

**Add `SetupContext.world: WorldApi`**, the same live, one-host-call-per-method `WorldApi` `InterceptorContext.world` already uses (`__forge_world` in `packages/runtime-host/src/module/moduleBridge.ts`, guest-side `makeLiveWorld()` in `prelude.ts` — no new bridge mechanism, just reusing the existing one from a third call site). It is available from `setup()` itself (for any one-time world setup a module wants to do) and, critically, from inside `events.on()` handlers via closure over `ctx`, since `ctx` is the same `SetupContext` value passed to `setup()`.

## Decision

**Add `SetupContext.runInterceptor<K>(point: K, value: InterceptorMap[K]): InterceptorMap[K]`, symmetric with the existing `addInterceptor`.** `addInterceptor` subscribes to a chain; `runInterceptor` triggers it — the same relationship `events.on`/`events.emit` already have on the `EventBus` side, which is precedent inside this same API surface for exactly this add/trigger pairing.

Mechanically, `runInterceptor` calls into the *same shared* `InterceptorRegistry` every module's `addInterceptor` calls register into (one registry per project, per ADR 0005's "modules cooperate in one shared game world by design") — a module calling `runInterceptor("dialogue:line", value)` gets back `value` run through every module's registered `dialogue:line` filter, in priority order, including filters registered by modules other than the caller. The calling module is never required to have registered its own filter for the point it's triggering — in the ordinary case (dialogue module triggers `dialogue:line`, a translation module filters it) it won't have.

Implementation-side (`packages/runtime-host/src/module/`), this is a small, low-risk addition: a new native bridge function `__forge_runInterceptor(point, valueJson) -> resultJson`, JSON-in/JSON-out, no live handle involved — it's the guest-calls-host direction, the same shape as the existing `storage`/`network` capability calls and the existing `__forge_world` dispatcher (M3 Phase 3's `SANDBOX-DESIGN.md` Section 4.2 distinction: this is *not* the host-calls-guest function-handle mechanism `addInterceptor`/`addSystem`/`events.on` use). The `InterceptorContext.world` passed to every filter in the chain reuses the identical lightweight synchronous `WorldApi` bridge already built in Phase 3 for a *registered* interceptor's own callback context — refactored into one shared guest-side helper in `prelude.ts` so there's exactly one implementation of "the WorldApi an interceptor sees," used from both directions.

## Is this additive-safe within v1

Yes for both. `SetupContext` gains two new members (`runInterceptor`, `world`); nothing existing changes shape. `api-extractor`'s tracked `.api.md` report shows exactly those two additions — verified by running the api-check gate before and after.

## Consequences

- `packages/module-api/src/module.ts`'s `SetupContext` gains `runInterceptor` and `world`. TSDoc with a working example ships in the same change, per CLAUDE.md Section 10's Definition of Done.
- `packages/runtime-host/src/module/moduleBridge.ts` and `prelude.ts` gain the `__forge_runInterceptor` wiring, expose `world` on `__forge_setupContext`, and the shared guest-side `WorldApi` builder refactor (one `makeLiveWorld()` used by the interceptor-callback context, `ctx.world`, and now — implicitly, since it's the same object — anything closing over `ctx` from `setup()`).
- A module's `setup()`-time or event-handler-time world writes are **not** batched the way a system's are (ADR 0005 step 3) — each `WorldApi` call is one immediate host round trip, same as an interceptor's. This is the right tradeoff for the same reason it's right for interceptors: neither setup() nor an event handler runs at per-entity, per-tick frequency, so there's no batching win to chase, and immediate application is simpler to reason about for "something happened, react once."
- This is the mechanism `@forge/dialogue`, and later any first-party or third-party module that owns a named interception point, uses to actually make that point live. `@forge/inventory` (M3 Phase 6) is expected to need the same thing for `inventory:canAddItem`/`inventory:itemPrice`, confirming this wasn't a dialogue-specific one-off.
- Future interceptor points a module wants to *own* (as opposed to a point the host engine owns, like a hypothetical future core-triggered `render:tileTint`) now have a real mechanism without inventing a second one later.
