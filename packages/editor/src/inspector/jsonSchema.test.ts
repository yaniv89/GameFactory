import { describe, expect, it } from "vitest";
import { compileJsonSchemaToZod, zodResolver, type ObjectSchema } from "./jsonSchema";

const SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 40 },
    startSeason: { type: "string", enum: ["spring", "summer", "autumn", "winter"] },
    seasonLengthDays: { type: "integer", minimum: 1, maximum: 365 },
    enabled: { type: "boolean" },
  },
  required: ["name"],
};

describe("compileJsonSchemaToZod", () => {
  it("accepts values that satisfy the schema", () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const result = zodSchema.safeParse({
      name: "Village",
      startSeason: "spring",
      seasonLengthDays: 28,
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a value below minLength", () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const result = zodSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a string outside the declared enum", () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const result = zodSchema.safeParse({ name: "Village", startSeason: "monsoon" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer for an integer field", () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const result = zodSchema.safeParse({ name: "Village", seasonLengthDays: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an integer outside the min/max range", () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const result = zodSchema.safeParse({ name: "Village", seasonLengthDays: 400 });
    expect(result.success).toBe(false);
  });

  it("treats a field not listed in `required` as optional", () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const result = zodSchema.safeParse({ name: "Village" });
    expect(result.success).toBe(true);
  });

  it("defaults to every property being required when `required` is omitted", () => {
    const zodSchema = compileJsonSchemaToZod({
      type: "object",
      properties: { title: { type: "string" } },
    });
    expect(zodSchema.safeParse({}).success).toBe(false);
    expect(zodSchema.safeParse({ title: "ok" }).success).toBe(true);
  });
});

describe("zodResolver", () => {
  it("returns the parsed values and no errors when valid", async () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const resolver = zodResolver(zodSchema);
    const result = await resolver({ name: "Village" }, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ name: "Village" });
  });

  it("returns a field-keyed error and no values when invalid", async () => {
    const zodSchema = compileJsonSchemaToZod(SCHEMA);
    const resolver = zodResolver(zodSchema);
    const result = await resolver({ name: "" }, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result.values).toEqual({});
    expect(result.errors.name?.message).toBeTruthy();
  });
});
