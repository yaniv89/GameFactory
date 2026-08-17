# 13. Module API gains a generic UI-surface capability (`SetupContext.ui`), enabling sandboxed live preview for any module

Date: 2026-08-17 (revised same day — see "Revision note" at the end)

## Status

Proposed.

## Context

Installing a marketplace package into a project (the feature this ADR is a
sub-decision of) surfaced a real gap while scoping live in-editor preview
for a newly-installed, third-party module: **the editor's live preview is
not generic today.** `packages/editor/src/preview/PreviewApp.tsx` imports
`@forge/dialogue` by name and hand-wires its `dialogue:start`/
`dialogue:shown`/`dialogue:choose` events to a hardcoded "press E near an
NPC → speech bubble, click a choice → advance" interaction.
`@forge/inventory` and `@forge/turn-battle` — both first-party, both
trusted — have no live-preview integration at all; they are only
configurable via the Modules panel's form, never actually run until
export. There is no existing generic mechanism a module uses to say
"render this UI, and tell me when the player interacts with it" that a
sandboxed path could simply reuse.

Given the choice between (a) deferring live preview for marketplace
modules entirely, (b) a minimal sandboxed preview with no designed UI
surface, or (c) building the missing generic mechanism for real — the
product direction taken is (c). This ADR is the required stop before
touching `packages/module-api` for it (CLAUDE.md Section 3.1 / Section
6.5).

This is also a security-relevant decision: a marketplace module previewed
live in the editor is untrusted third-party code. CLAUDE.md Section 4.2 is
non-negotiable that such code only ever executes inside
`packages/runtime-host`'s QuickJS-in-Worker sandbox — never in the
editor's unsandboxed `directModuleHost.ts` fast path, which
`directModuleHost.ts`'s own doc comment already anticipates and forbids.
Whatever mechanism is built here must work through that real sandbox for a
marketplace module.

CLAUDE.md Section 9.1 design rule #1 — "everything a first-party Module
can do, a third-party Module can do" — means this cannot be a
third-party-only bolt-on. It has to be one real capability every module
uses through `@forge/module-api`, the same discipline ADR 0006 applied
when `runInterceptor`/`world` turned out to be missing from v1.

## Decision

**Add `SetupContext.ui: UiApi` to `@forge/module-api`** — a small,
declarative surface, not a DOM/canvas escape hatch, built from a closed,
bounded widget vocabulary rather than a general-purpose layout language:

```ts
/** A single text run — reuses @forge/richtext's existing sanitized node type for inline formatting (bold, color), never a raw string interpreted as HTML. This is the *only* place richtext's AST is reused; the surrounding widget tree below is a separate, purpose-built vocabulary, not richtext repurposed for general layout — richtext was designed for prose (dialogue lines, reviews), not item grids or health bars, and stretching it to cover both was a mistake in the first draft of this ADR. */
type UiText = RichTextNode;

type UiWidget =
  | { readonly kind: "text"; readonly text: UiText }
  /** assetId resolves through the existing Art Pack asset-resolution pipeline (M6 Phase 4b/4e) — never an arbitrary URL, the same boundary that already governs every other module-visible image reference. */
  | { readonly kind: "icon"; readonly assetId: string }
  | { readonly kind: "bar"; readonly value: number; readonly max: number; readonly label?: UiText }
  /**
   * The interaction primitive. `onInteract` names an event this module
   * itself already listens for via the *existing* `EventBus` —
   * `ctx.events.on(event, handler)` — no new input mechanism invented:
   * when the player activates the button, the host emits exactly the
   * event/payload declared here on this module's own event bus, the same
   * "something happened, react once" path `dialogue:choose` already uses
   * today. This is what the first draft of this ADR was missing: a
   * display-only surface can show an inventory grid but can't let the
   * player click an item, which makes "inventory previews live" false in
   * anything but appearance.
   */
  | { readonly kind: "button"; readonly label: UiText; readonly onInteract: { readonly event: string; readonly payload?: JsonValue } }
  | { readonly kind: "group"; readonly direction: "row" | "column"; readonly children: readonly UiWidget[] };

interface UiSurfaceSpec {
  readonly kind: "bubble" | "panel" | "hud";
  /** World-anchored (bubble, follows an entity) or screen-anchored (panel, hud). */
  readonly anchor: { readonly entity: EntityId } | { readonly corner: "top-left" | "top-right" | "bottom-left" | "bottom-right" };
  readonly root: UiWidget;
}

interface UiApi {
  /** Declares or replaces the named surface. Re-calling with the same id updates it in place. */
  showSurface(id: string, spec: UiSurfaceSpec): void;
  hideSurface(id: string): void;
}
```

A module never touches the DOM or canvas — it describes *what* to show and
*what event fires* on interaction; the trusted host owns rendering and
input dispatch. Each `UiWidget.kind` maps to exactly one host-controlled
component, the same discipline `@forge/richtext` already uses for its own
fixed renderer set.

**Update frequency and the write-batch model, mirroring `world`'s existing
dual behavior (ADR 0005/0006) rather than inventing a new one:**

- Called from inside a system's `run()` (`TickContext`): `showSurface`
  writes coalesce into a per-tick batch, keyed by surface id — last write
  per id wins, flushed once at end of tick. A module calling `showSurface`
  fifty times in one tick for the same id costs one flush, not fifty; this
  is a natural consequence of following the same batched-write model
  `TickContext.world` already uses, not a separate rate limiter bolted on
  after the fact.
- Called from `setup()` or an event handler (`SetupContext`): applies
  immediately, same as `SetupContext.world`/`runInterceptor` already do —
  neither runs at per-tick frequency, so there's no batching win to chase.
- Independent of update frequency, a module may hold at most a fixed
  number of distinct live surface ids at once (e.g. 32) — bounds a module
  from routing around the per-id coalescing by fanning out across many
  ids instead of reusing one.
- Each `UiSurfaceSpec` is capped host-side on serialized size and
  `UiWidget` tree depth/count before rendering, the same "never trust
  guest input's size unboundedly" discipline `SANDBOX-DESIGN.md`'s
  compute-budget and memory-limit enforcement already apply elsewhere.

**Bridge wiring** (`packages/runtime-host`): a new guest-calls-host,
JSON-in/JSON-out capability — `__forge_ui_show(id, specJson)` /
`__forge_ui_hide(id)` — the same shape as the existing
`__forge_runInterceptor`/storage/net calls, not the host-calls-guest
function-handle mechanism `addSystem`/`addInterceptor` use. New hostile
fixtures join `sandbox-escape.test.ts`: an oversized spec, a
pathologically deep/wide widget tree, a spec that tries to smuggle
non-widget content through `content`/`label` fields, and a flood of
distinct surface ids attempting to exceed the per-module cap.

**Sandboxed preview host** (`packages/editor`, new): a marketplace-
installed module previews through the real sandboxed pipeline
(`packages/runtime-host`'s QuickJS-in-Worker bridge), never through
`directModuleHost.ts`.

**Adoption order — inventory/turn-battle first, dialogue last:**
`@forge/inventory` and `@forge/turn-battle` adopt `ui` first. They have no
existing live preview to regress, so they're the real, honest proof this
capability is generically usable — an inventory grid with clickable items
and a turn-battle move menu, both needing the `button`/`onInteract`
path this ADR adds, are exactly the cases a display-only version of this
ADR would have failed. Only once that's demonstrably solid does
`@forge/dialogue`'s existing, currently-working, currently-tested
bespoke preview (part of M4's "10-minute build" proof, exercised by
`walkableDemo.spec.ts`) migrate onto `ui` — deliberately last, not first,
so the one preview integration that already works in production isn't the
proving ground for a brand-new capability.

## Is this additive-safe within v1

Yes. `SetupContext` gains one new member (`ui`); nothing existing changes
shape. Verified via `api-extractor`'s tracked `.api.md` diff before/after
— it must show exactly one addition.

## Consequences

- `packages/module-api` gains `UiApi`/`UiSurfaceSpec`/`UiWidget` with
  TSDoc and a working example (an inventory panel with a clickable item
  button), per CLAUDE.md Section 10's Definition of Done.
- `packages/runtime-host` gains the `__forge_ui_show`/`__forge_ui_hide`
  bridge wiring, the per-tick coalescing behavior for `TickContext`-issued
  calls plus immediate application for `SetupContext`-issued calls, a
  spec-size/depth/surface-count budget check, and new hostile fixtures in
  `sandbox-escape.test.ts`.
- `packages/editor` gains a genuinely new subsystem: a sandboxed preview
  host for marketplace-installed modules, event dispatch from
  host-rendered widgets back onto a module's own `EventBus`, and — later,
  once proven — a replacement for `directModuleHost.ts`'s bespoke
  dialogue-only path.
- `@forge/inventory` and `@forge/turn-battle`, which today have **no**
  live preview at all, gain a real, interactive one — not just a display
  of static content — once they adopt `ui`.
- This lands as its own follow-on phase after the base "install a package
  into a project" feature (document schema, backend authorization, Install
  button, export/build bundle resolution) ships and is independently
  verified. On its own this is genuinely week(s) of work spanning three
  packages and the sandbox trust boundary; the revision below made that
  larger, not smaller, and that's an honest trade-off, not a reason to cut
  the interaction model back out.
- Trade-off stated plainly: this is a real expansion of the sandbox's
  guest-visible surface area, and now includes an inbound path (host →
  guest event dispatch from a UI interaction) as well as the outbound one
  — more surface than the first draft proposed. The frequency-coalescing,
  per-module surface-id cap, and new hostile fixtures above are the
  mitigations for that, and are part of this decision, not a follow-up to
  file later.

## Revision note

This ADR was revised before implementation started, in response to
self-review: the first draft proposed a display-only `showSurface` with no
way for a module to receive input through it, reused `@forge/richtext`'s
document AST for general widget layout (a fit for prose, not for an item
grid or a health bar), and sequenced `@forge/dialogue`'s real, working
preview as the first migration target rather than the last. All three are
fixed above — the interaction model (`button`/`onInteract` routed through
the existing `EventBus`), a small purpose-built `UiWidget` vocabulary
(richtext now used only for individual text runs within it), a stated
per-tick coalescing/frequency budget, and inventory/turn-battle adopting
the capability before dialogue migrates onto it.
