/**
 * Component schema and registry. Per docs/SPEC.md Section 4.2, a component
 * is "a plain typed data struct" — here, a fixed set of numeric fields, one
 * typed array per field per archetype (Section 8.4's "contiguous chunk of
 * typed arrays"). Booleans are stored as 0/1 in a Uint8Array; there is no
 * string/object field type, matching the JSON-serializability constraint
 * this same shape has to satisfy for saves (Section 4.2's design constraint,
 * enforced properly once the save system lands in M3).
 */
export type ComponentFieldType = "f64" | "f32" | "i32" | "u32" | "u8" | "bool";

export type TypedArrayForField<F extends ComponentFieldType> = F extends "f64"
  ? Float64Array
  : F extends "f32"
    ? Float32Array
    : F extends "i32"
      ? Int32Array
      : F extends "u32"
        ? Uint32Array
        : Uint8Array;

export const FIELD_ARRAY_CTOR: {
  readonly [F in ComponentFieldType]: new (length: number) => TypedArrayForField<F>;
} = {
  f64: Float64Array,
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  u8: Uint8Array,
  bool: Uint8Array,
};

export interface ComponentSchema {
  readonly [field: string]: ComponentFieldType;
}

export type ComponentValue<S extends ComponentSchema> = {
  [K in keyof S]: number;
};

export interface ComponentDescriptor<S extends ComponentSchema = ComponentSchema> {
  readonly name: string;
  readonly id: number;
  readonly schema: S;
  readonly defaults: ComponentValue<S>;
}

/** Total component types this build supports — see mask.ts. */
export const MAX_COMPONENT_TYPES = 256;

/**
 * Assigns a stable numeric ID to each component name at registration time
 * (world setup, not per-tick). The ID is what the archetype mask and
 * column maps key on.
 */
export class ComponentRegistry {
  private readonly byName = new Map<string, ComponentDescriptor>();
  private readonly byId: ComponentDescriptor[] = [];
  private nextId = 0;

  define<S extends ComponentSchema>(
    name: string,
    schema: S,
    defaults: ComponentValue<S>,
  ): ComponentDescriptor<S> {
    if (this.byName.has(name)) {
      throw new Error(`ComponentRegistry: "${name}" is already registered`);
    }
    if (this.nextId >= MAX_COMPONENT_TYPES) {
      throw new Error(
        `ComponentRegistry: exceeded the maximum of ${MAX_COMPONENT_TYPES} component types`,
      );
    }
    const descriptor: ComponentDescriptor<S> = {
      name,
      id: this.nextId++,
      schema,
      defaults,
    };
    this.byName.set(name, descriptor as ComponentDescriptor);
    this.byId.push(descriptor as ComponentDescriptor);
    return descriptor;
  }

  getByName(name: string): ComponentDescriptor {
    const descriptor = this.byName.get(name);
    if (!descriptor) {
      throw new Error(`ComponentRegistry: unknown component "${name}"`);
    }
    return descriptor;
  }

  getById(id: number): ComponentDescriptor {
    const descriptor = this.byId[id];
    if (!descriptor) {
      throw new Error(`ComponentRegistry: unknown component id ${id}`);
    }
    return descriptor;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }
}
