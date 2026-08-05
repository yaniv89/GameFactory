# 2. Defer dynamic-shape components (Stats) past M1

Date: 2026-08-05

## Status

Accepted

## Context

`docs/SPEC.md` Section 4.3 lists `Stats` as a core component with the shape `{ values: Record<string, number> }` — an arbitrary, per-entity, per-project set of named numeric stats (HP, attack, whatever a creator's data tables define).

The archetype ECS built in Milestone M1 (`packages/core/src/ecs/`) stores every component as one fixed-width typed array per declared field, shared across every entity in that archetype (`docs/SPEC.md` Section 8.4's "contiguous chunk of typed arrays"). That model assumes a component's field set is known and identical for every instance — it has no representation for "an open-ended map of keys the creator defines at data-table-authoring time," which is what `Stats` actually needs.

Forcing `Stats` into today's model would mean one of:
- A fixed, hardcoded set of stat names (`hp`, `mp`, `atk`, `def`, ...) — wrong, it contradicts the "creator-definable" requirement the whole Data Tables system (`docs/SPEC.md` Section 12.3) exists to serve.
- A per-entity JS object/Map stored outside the typed-array columns — defeats the point of archetype storage (no longer contiguous, allocates per entity, can't be iterated by a tight typed-array loop).

Neither is honest work; both would be presented as "Stats: done" when it isn't.

## Decision

`Stats` is not implemented in M1. The seven other core components (`Transform`, `Sprite`, `Animator`, `Collider`, `Velocity`, `PlayerControlled`, `Interactable`) are — they all have a fixed, known field set and fit the current model cleanly.

Dynamic-shape components need a second storage strategy, decided when something in the roadmap actually needs one — most likely the Data Tables / `@forge/turn-battle` work in M3, since that's the first consumer. Candidate approaches to evaluate then, not now:
1. A per-archetype dictionary column: a `Map<string, Float64Array>` keyed by stat name, built from the union of stat names any entity in that archetype actually uses — keeps iteration typed-array-backed but adds a level of indirection per lookup.
2. A dedicated "sparse component" storage tier alongside the dense archetype tables, for components whose shape is genuinely per-instance rather than per-archetype.
3. Requiring stat *names* to be a closed set at the project level (declared once in `project.json`, not per-entity) — turns `Stats` back into a fixed-schema component after all, just with project-specific field lists instead of engine-hardcoded ones.

## Consequences

- M1's exit criterion (5000/1000-entity benchmark, ECS core, scheduler, renderer, collision) does not depend on `Stats` and is unaffected.
- Anything in M1–M2 that would reference `Stats` (there is nothing yet) has no component to reference. First real consumer is expected in M3.
- This ADR is the tracked reference for that gap — no bare `TODO` comment needed in `packages/core/src/components/core.ts`; it points here instead.
