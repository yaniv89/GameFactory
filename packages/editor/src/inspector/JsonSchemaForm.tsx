import { Checkbox, Input, Select } from "@forge/ds";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { compileJsonSchemaToZod, zodResolver, type FormValues, type ObjectSchema } from "./jsonSchema";
import "./JsonSchemaForm.css";

export interface JsonSchemaFormProps {
  schema: ObjectSchema;
  values: FormValues;
  onSubmit: (values: FormValues) => void;
}

/**
 * Declarative editor UI per docs/SPEC.md 9.5: fields are described by a
 * JSON Schema, never React components a module author writes — the same
 * discipline that keeps a third-party module's inspector from ever being
 * an XSS surface (CLAUDE.md 1.1.3), since there is no author-supplied
 * markup to render, only data driving first-party controls.
 *
 * Commits on blur rather than an explicit Save button: leaving a field is
 * the direct-manipulation signal (CLAUDE.md 5.3). An invalid value shows
 * its error inline and is not committed.
 */
export function JsonSchemaForm({ schema, values, onSubmit }: JsonSchemaFormProps) {
  const zodSchema = compileJsonSchemaToZod(schema);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues: values,
    mode: "onBlur",
  });

  // `values` is commonly a fresh object literal every render (e.g. derived
  // from a store selector). Resetting on every render would clobber
  // in-progress, not-yet-blurred typing on an unrelated re-render, so this
  // only actually resets the form when the underlying values changed.
  const lastAppliedRef = useRef(JSON.stringify(values));
  useEffect(() => {
    const serialized = JSON.stringify(values);
    if (serialized !== lastAppliedRef.current) {
      lastAppliedRef.current = serialized;
      reset(values);
    }
  }, [values, reset]);

  const commit = handleSubmit((valid) => onSubmit(valid));

  return (
    <form
      className="fg-json-schema-form"
      onSubmit={(event) => event.preventDefault()}
      onBlur={() => void commit()}
    >
      {Object.entries(schema.properties).map(([key, field]) => {
        const label = field.title ?? key;
        const errorMessage = errors[key]?.message as string | undefined;
        // exactOptionalPropertyTypes rejects `error={undefined}` for a
        // declared-optional `error?: string` prop — only include the key
        // at all when there is a message.
        const errorProp = errorMessage !== undefined ? { error: errorMessage } : {};

        if (field.type === "boolean") {
          return <Checkbox key={key} label={label} {...register(key)} />;
        }
        if (field.type === "string" && field.enum && field.enum.length > 0) {
          return (
            <Select
              key={key}
              label={label}
              options={field.enum.map((value) => ({ value, label: value }))}
              {...errorProp}
              {...register(key)}
            />
          );
        }
        if (field.type === "number" || field.type === "integer") {
          return (
            <Input
              key={key}
              type="number"
              step={field.type === "integer" ? 1 : "any"}
              label={label}
              {...errorProp}
              {...register(key, { valueAsNumber: true })}
            />
          );
        }
        return <Input key={key} type="text" label={label} {...errorProp} {...register(key)} />;
      })}
    </form>
  );
}
