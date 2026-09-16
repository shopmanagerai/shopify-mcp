import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * JSON Schema for MCP tool definitions. MCP clients (Claude Code among them) require
 * `inputSchema.type === "object"` at the root and reject `$ref`-rooted documents, so
 * refs are inlined and the root is normalised. `$schema` is dropped (MCP declares
 * JSON Schema 2020-12 for the whole document).
 */
export function toMcpJsonSchema(schema: ZodTypeAny, name?: string): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, { name, $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  let root: Record<string, unknown> = raw;
  // With a name, zod-to-json-schema nests the schema under definitions[name] and roots a $ref.
  if (typeof raw.$ref === "string" && raw.definitions && typeof raw.definitions === "object") {
    const key = (raw.$ref as string).split("/").pop()!;
    const def = (raw.definitions as Record<string, unknown>)[key];
    if (def && typeof def === "object") root = { ...(def as Record<string, unknown>) };
  }
  delete root.$schema;
  delete root.definitions;
  delete root.$ref;
  if (root.type === undefined && (root.properties !== undefined || root.additionalProperties !== undefined)) root.type = "object";
  if (root.type === undefined && Object.keys(root).length === 0) root.type = "object";
  return root;
}
