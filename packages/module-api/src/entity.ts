/**
 * An opaque entity handle. Modules never construct or decompose this
 * value — it is only ever received from `WorldApi` and passed back to
 * it. Deliberately not the same type as `@forge/core`'s internal
 * `EntityId` (which packs an index/generation bit layout) — that's an
 * implementation detail this public surface does not expose, and must
 * not, since `@forge/core`'s packing scheme is free to change without
 * that being a Module API break.
 */
export type EntityId = number;
