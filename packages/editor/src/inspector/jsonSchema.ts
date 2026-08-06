import { z } from "zod";
import type { FieldErrors, Resolver } from "react-hook-form";

/**
 * The JSON Schema subset the inspector actually renders. This is
 * deliberately narrow, not a general JSON Schema implementation — it
 * covers exactly the shapes docs/SPEC.md Section 9.2's module
 * `configSchema` example uses (string/enum, integer/number with min/max,
 * boolean) plus what a first-party inspector like SceneInspector needs.
 * Widen it when a real module or built-in inspector needs a shape it
 * doesn't cover yet, not speculatively.
 */
export interface StringFieldSchema {
  readonly type: "string";
  readonly title?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly enum?: readonly string[];
}

export interface NumberFieldSchema {
  readonly type: "number" | "integer";
  readonly title?: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface BooleanFieldSchema {
  readonly type: "boolean";
  readonly title?: string;
}

export type FieldSchema = StringFieldSchema | NumberFieldSchema | BooleanFieldSchema;

export interface ObjectSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, FieldSchema>>;
  readonly required?: readonly string[];
}

export type FormValues = Record<string, string | number | boolean>;

function compileField(field: FieldSchema, required: boolean): z.ZodTypeAny {
  switch (field.type) {
    case "string": {
      let base: z.ZodTypeAny;
      if (field.enum && field.enum.length > 0) {
        base = z.enum(field.enum as [string, ...string[]]);
      } else {
        let str = z.string();
        if (field.minLength !== undefined) str = str.min(field.minLength);
        if (field.maxLength !== undefined) str = str.max(field.maxLength);
        base = str;
      }
      return required ? base : base.optional();
    }
    case "number":
    case "integer": {
      let num = z.number();
      if (field.type === "integer") num = num.int();
      if (field.minimum !== undefined) num = num.min(field.minimum);
      if (field.maximum !== undefined) num = num.max(field.maximum);
      const shape = required ? num : num.optional();
      // RHF's `valueAsNumber` turns an empty numeric input into NaN, not
      // undefined. `preprocess` runs on the raw value before `shape` sees
      // it, so this coerces NaN to undefined first — letting a blank
      // optional field read as "no value" instead of failing type
      // validation, while a blank required field still fails as required.
      return z.preprocess((value) => (typeof value === "number" && Number.isNaN(value) ? undefined : value), shape);
    }
    case "boolean": {
      const base = z.boolean();
      return required ? base : base.optional();
    }
  }
}

/**
 * Compiles a `configSchema`-shaped object schema to Zod, per CLAUDE.md 2.2.
 * The return type is asserted to `FormValues` rather than inferred field by
 * field: `properties` is a runtime-provided record, so its exact shape
 * isn't known to the type system, but every branch of `compileField`
 * produces a string/number/boolean (or optional thereof), matching
 * `FormValues` by construction.
 */
export function compileJsonSchemaToZod(schema: ObjectSchema): z.ZodType<FormValues> {
  const required = new Set(schema.required ?? Object.keys(schema.properties));
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    shape[key] = compileField(field, required.has(key));
  }
  return z.object(shape) as unknown as z.ZodType<FormValues>;
}

/**
 * A hand-written equivalent of `@hookform/resolvers/zod`'s adapter. Not
 * pulled in as a dependency: it is a ~15-line bridge between two libraries
 * already in Section 2.2, not a new architectural choice, and this keeps
 * the dependency list to exactly React Hook Form + Zod.
 */
export function zodResolver<T extends FormValues>(schema: z.ZodType<T>): Resolver<T> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: FieldErrors<T> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in errors)) {
        (errors as Record<string, { type: string; message: string }>)[key] = {
          type: issue.code,
          message: issue.message,
        };
      }
    }
    return { values: {}, errors };
  };
}
