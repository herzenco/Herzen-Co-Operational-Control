import { z } from "zod";

export type ConfigFieldKind = "text" | "number" | "boolean" | "select" | "object" | "array" | "union" | "json";

export type ConfigFieldDescriptor = {
  key: string;
  path: string[];
  label: string;
  description?: string;
  kind: ConfigFieldKind;
  required: boolean;
  options?: Array<{ label: string; value: string | number }>;
  children?: ConfigFieldDescriptor[];
  variants?: Array<{ label: string; fields: ConfigFieldDescriptor[] }>;
};

type JsonSchemaNode = {
  type?: string;
  title?: string;
  description?: string;
  const?: string | number | boolean;
  enum?: Array<string | number>;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  additionalProperties?: boolean | JsonSchemaNode;
};

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function optionLabel(value: string | number): string {
  return typeof value === "number" ? String(value) : humanize(value);
}

function descriptorFor(key: string, schema: JsonSchemaNode, path: string[], required: boolean): ConfigFieldDescriptor {
  const union = schema.oneOf ?? schema.anyOf;
  if (union && union.length > 0) {
    return {
      key,
      path,
      label: schema.title ?? humanize(key),
      description: schema.description,
      kind: "union",
      required,
      variants: union.map((variant, index) => ({
        label: variant.title ?? `Option ${index + 1}`,
        fields: fieldsForObject(variant, path),
      })),
    };
  }
  if (schema.enum || schema.const !== undefined) {
    const values = schema.enum ?? [schema.const as string | number];
    return { key, path, label: schema.title ?? humanize(key), description: schema.description, kind: "select", required, options: values.map((value) => ({ label: optionLabel(value), value })) };
  }
  if (schema.type === "object" || schema.properties) {
    return { key, path, label: schema.title ?? humanize(key), description: schema.description, kind: "object", required, children: fieldsForObject(schema, path) };
  }
  if (schema.type === "array") {
    const item = schema.items ?? {};
    return { key, path, label: schema.title ?? humanize(key), description: schema.description, kind: "array", required, children: [descriptorFor("item", item, [...path, "*"], true)] };
  }
  const kind: ConfigFieldKind = schema.type === "boolean" ? "boolean" : schema.type === "number" || schema.type === "integer" ? "number" : schema.type === "string" ? "text" : "json";
  return { key, path, label: schema.title ?? humanize(key), description: schema.description, kind, required };
}

function fieldsForObject(schema: JsonSchemaNode, parentPath: string[]): ConfigFieldDescriptor[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, child]) => descriptorFor(key, child, [...parentPath, key], required.has(key)));
}

export function configSchemaToFieldDescriptors(schema: z.ZodType): ConfigFieldDescriptor[] {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any" }) as JsonSchemaNode;
  const union = jsonSchema.oneOf ?? jsonSchema.anyOf;
  if (union && union.length > 0) {
    return [{ key: "$variant", path: [], label: "Configuration", kind: "union", required: true, variants: union.map((variant, index) => ({ label: variant.title ?? `Option ${index + 1}`, fields: fieldsForObject(variant, []) })) }];
  }
  return fieldsForObject(jsonSchema, []);
}
