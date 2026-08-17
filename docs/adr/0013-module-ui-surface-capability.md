# 13. Module API gains a generic UI-surface capability (`SetupContext.ui`), enabling sandboxed live preview for any module

Date: 2026-08-17

## Status

Proposed.

## Context

Installing a marketplace package into a project (the feature this ADR is a
sub-decision of) surfaced a real gap while scoping live in-editor preview
for a newly-installed, third-party module: **the editor's live preview is
not generic today.** `packages/editor/src/preview/PreviewApp.tsx` imports
`@forge/dialogue` by name and hand-wires its `dialogue:start`/
`dialogue:shown` events to a hardcoded "press E near an NPC → speech
bubble" interaction. `@forge/inventory` and `@forge/turn-battle` — both
first-party, both trusted — have no live-preview integration at all; they
are only configurable via the Modules panel's form, never actually run
until export. There is no existing generic mechanism a module uses to say
"render this UI" that a third path could simply reuse in sandboxed form.

Given the choice between (a) deferring live preview for marketplace
modules entirely, (b) a minimal sandboxed preview with no designed UI
surface (module runs, but nothing renders), or (c) building the missing
generic mechanism for real — the product direction taken is (c). This ADR
is the required stop before touching `packages/module-api` for it
(CLAUDE.md Section 3.1 / Section 6.5, and the "Adding to the Module API"
session template: "Write the ADR first ... Do not touch
`packages/module-api` until the ADR is agreed").

This is also a security-relevant decision: a marketplace module previewed
live in the editor is untrusted third-party code. CLAUDE.md Section 4.2 is
non-negotiable that such code only ever executes inside
`packages/runtime-host`'s QuickJS-in-Worker sandbox — never in the
editor's own unsandboxed `directModuleHost.ts` fast path, which
`directModuleHost.ts`'s own doc comment already anticipates and forbids
("Once M6/M7 make third-party modules installable and previewable, THIS
path must not be reused for those"). Whatever UI mechanism is built here
must work through that real sandbox for a marketplace module, not around
it.

CLAUDE.md Section 9.1 design rule #1 (cited in `module.ts`'s own doc
comment) — "everything a first-party Module can do, a third-party Module
can do" — means this cannot be a third-party-only bolt-on API. It has to
be one real capability every module, first- or third-party, uses through
`@forge/module-api`, the same discipline ADR 0006 already applied when
`runInterceptor`/`world` turned out to be missing from v1.

## Decision

**Add `SetupContext.ui: UiApi` to `@forge/module-api`** — a small,
declarative surface, not a DOM/canvas escape hatch:

```ts
interface UiSurfaceSpec {
  readonly kind: "bubble" | "panel" | "hud";
  /** World-anchored (bubble, follows an entity) or screen-anchored (panel, hud). */
  readonly anchor: { readonly entity: EntityId } | { readonly corner: "top-left" | "top-right" | "bottom-left" | "bottom-right" };
  /** @forge/richtext's existing sanitized AST node type — never a raw string interpreted as HTML, the same boundary CLAUDE.md 1.1.3 already enforces everywhere else. */
  readonly content: RichTextNode;
}

interface UiApi {
  /** Declares or replaces the named surface. Re-calling with the same id updates it in place — the same "forward carries the new value" shape every other part of this API already uses. */
  showSurface(id: string, spec: UiSurfaceSpec): void;
  hideSurface(id: string): void;
}
```

A module never touches the DOM or the canvas directly — it describes
*what* to show; the trusted host owns *how*. The host renders through a
fixed, small set of host-controlled components (a bubble, a panel, a HUD
strip), the same discipline `@forge/richtext` already uses to render its
sanitized AST through fixed React components, never
`dangerouslySetInnerHTML`. This closes the same class of risk CLAUDE.md
1.1.3 names for rich text, generalized: a module can never render
arbitrary markup, only a constrained, host-interpreted structure.

**Bridge wiring** (`packages/runtime-host`): a new guest-calls-host,
JSON-in/JSON-out capability — `__forge_ui_show(id, specJson)` /
`__forge_ui_hide(id)` — the same shape as the existing
`__forge_runInterceptor`/storage/net calls (ADR 0006's precedent), not the
host-calls-guest function-handle mechanism `addSystem`/`addInterceptor`
use, since a module only ever pushes UI state outward and never receives a
callback through this path.

**Budget enforcement**: a `UiSurfaceSpec` is capped host-side before
rendering (max serialized size, max nested `RichTextNode` depth/count) —
the same "never allocate/trust unboundedly from guest input" discipline
`SANDBOX-DESIGN.md`'s compute-budget and memory-limit enforcement already
apply elsewhere, extended so this new surface can't become an unguarded
DoS vector of its own. New hostile fixtures join the existing
`sandbox-escape.test.ts` suite: an oversized spec, a pathologically deep
`RichTextNode` tree, and a spec that tries to smuggle non-AST content
through the `content` field.

**Sandboxed preview host** (`packages/editor`, new): a marketplace-
installed module previews through the real sandboxed pipeline
(`packages/runtime-host`'s QuickJS-in-Worker bridge), never through
`directModuleHost.ts`. This is the actual enforcement point that keeps
CLAUDE.md 4.2 intact even though the editor now runs third-party code
live during editing, not only at export/publish time.

**`@forge/dialogue`'s existing preview integration migrates onto `ui`
too**, replacing its hardcoded bubble wiring in `PreviewApp.tsx`, rather
than leaving two permanently-diverging preview mechanisms (one bespoke and
unsandboxed, one generic and sandboxed) to maintain forever. This is the
same dogfooding principle ADR 0006 already established: if the first-party
module that motivated a capability can't be rebuilt on top of it, the
capability isn't real yet.

## Is this additive-safe within v1

Yes. `SetupContext` gains one new member (`ui`); nothing existing changes
shape. Verified via `api-extractor`'s tracked `.api.md` diff before/after
— it must show exactly one addition.

## Consequences

- `packages/module-api` gains `UiApi`/`UiSurfaceSpec` with TSDoc and a
  working example, per CLAUDE.md Section 10's Definition of Done.
- `packages/runtime-host` gains the `__forge_ui_show`/`__forge_ui_hide`
  bridge wiring, a spec-size/depth budget check, and new hostile fixtures
  in `sandbox-escape.test.ts`.
- `packages/editor` gains a genuinely new subsystem: a sandboxed preview
  host for marketplace-installed modules, replacing
  `directModuleHost.ts`'s bespoke dialogue-only path. This is materially
  more than "wire an Install button" — on its own it is week(s) of work
  spanning three packages and the sandbox trust boundary.
- `@forge/inventory` and `@forge/turn-battle` — which today have **no**
  live preview at all — gain one for free once they adopt `ui`, a real
  improvement beyond what installing a marketplace package originally
  asked for.
- Because of the size above, this lands as its own follow-on phase after
  the base "install a package into a project" feature (document schema,
  backend authorization, Install button, export/build bundle resolution)
  ships and is independently verified — not because live preview matters
  less, but because shipping the base feature first, verified on its own,
  is safer than one combined change spanning this many trust boundaries
  at once.
- Trade-off honestly stated: this is a real expansion of the sandbox's
  guest-visible surface area. Every new bridge capability is more attack
  surface, which is exactly why the budget enforcement and new hostile
  fixtures above are part of the decision, not a follow-up.
