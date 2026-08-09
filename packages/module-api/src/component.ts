/**
 * A component's declared shape. Per docs/SPEC.md Section 4.2's
 * serializability constraint ("no functions, no class instances, no
 * circular references") and `@forge/core`'s archetype storage
 * (`packages/core/src/ecs/component.ts`'s own doc comment: "a fixed set
 * of numeric fields... no string/object field type"), a module-defined
 * component is numeric/boolean fields only in v1. Richer field types
 * (strings, nested objects) would need a different storage strategy in
 * `@forge/core` first — see `docs/adr/0002` for the same constraint
 * already hit and deferred for the built-in `Stats` component.
 */
export type ComponentShape = Readonly<Record<string, number | boolean>>;

export interface ComponentFieldSchema {
  readonly type: "number" | "boolean";
}

export type ComponentJsonSchema = Readonly<Record<string, ComponentFieldSchema>>;

/** An opaque handle to a component a module registered via `SetupContext.defineComponent`. */
export interface ComponentHandle<T extends ComponentShape> {
  /** The namespaced component name it was registered under, e.g. `"@acme/weather-system:WeatherReactive"`. */
  readonly name: string;
  /** Present only for type inference — never actually populated on the handle at runtime. */
  readonly __shape?: T;
}
