import { parseThemeJson } from "@shopmanagerai/shared";
import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Section/block/template tool family (categories "section"/"block"/"template").
 * One handler per operation (inspect/schema/references/validate/create/update/
 * delete_local), expanded via ToolRegistry.registerFamily into
 * shopify.section.*, shopify.block.*, shopify.template.* using the `kind`
 * input field the registry injects.
 */
import { z } from "zod";

import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";

import { inspectLiquid } from "@shopmanagerai/theme-intelligence";
import { requireTheme } from "../theme-loader.js";

const KIND_VALUES = ["section", "block", "template"] as const;
type Kind = (typeof KIND_VALUES)[number];

function keyFor(kind: Kind, name: string): string {
  if (name.includes("/")) return name;
  if (kind === "section") return `sections/${name}.liquid`;
  if (kind === "block") return `blocks/${name}.liquid`;
  return `templates/${name}.json`;
}

async function readOne(theme: Parameters<typeof requireTheme>[0], themeId: string, key: string) {
  const engine = requireTheme(theme);
  const [file] = await engine.readFiles(themeId, [key]);
  return file;
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------
const InspectInput = z.object({ kind: z.enum(KIND_VALUES).optional(), themeId: z.string().optional(), name: z.string() });

export const familyInspectTool: ToolDefinition = defineTool({
  name: "shopify.{kind}.inspect",
  family: { param: "kind", values: [...KIND_VALUES] },
  description: "Inspects a section/block/template file: content summary, schema (for liquid), or structure (for JSON templates).",
  tier: "free",
  category: "section",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: InspectInput,
  outputSchema: z.record(z.unknown()),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content"], writes: [], stores: [], returnsToClient: ["inspection result"] },
  docs: {
    examples: [{ title: "Inspect a section", input: { themeId: "123", name: "hero" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "The file does not exist." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    const kind = (input.kind ?? "section") as Kind;
    const key = keyFor(kind, input.name);
    const file = await readOne(ctx.theme, input.themeId!, key);
    if (!file) return fail({ operationId: ctx.operationId }, familyInspectTool, { code: "NOT_FOUND", message: `${input.kind} "${input.name}" (${key}) not found.`, retryable: false });
    if (key.endsWith(".json")) {
      let json: unknown = null;
      try {
        json = parseThemeJson(file.content ?? "{}");
      } catch (e) {
        return fail({ operationId: ctx.operationId }, familyInspectTool, { code: "INVALID_INPUT", message: `${key} is not valid JSON.`, technicalMessage: e instanceof Error ? e.message : String(e), retryable: false });
      }
      return ok({ operationId: ctx.operationId }, familyInspectTool, { summary: `Inspected ${key}`, data: { key, json } });
    }
    const insp = inspectLiquid(key, file.content ?? "");
    return ok({ operationId: ctx.operationId }, familyInspectTool, { summary: `Inspected ${key}`, data: insp as unknown as Record<string, unknown> });
  },
});

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------
export const familySchemaTool: ToolDefinition = defineTool({
  name: "shopify.{kind}.schema",
  family: { param: "kind", values: [...KIND_VALUES] },
  description: "Returns the {% schema %} block (parsed JSON) for a section/block, or the root structure for a template.",
  tier: "free",
  category: "section",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: InspectInput,
  outputSchema: z.record(z.unknown()),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content"], writes: [], stores: [], returnsToClient: ["schema JSON"] },
  docs: { examples: [{ title: "Get a section's schema", input: { themeId: "123", name: "hero" } }], failureModes: [{ code: "NOT_FOUND", meaning: "The file or schema does not exist." }], limitations: [] },
  handler: async (ctx, input) => {
    const kind = (input.kind ?? "section") as Kind;
    const key = keyFor(kind, input.name);
    const file = await readOne(ctx.theme, input.themeId!, key);
    if (!file) return fail({ operationId: ctx.operationId }, familySchemaTool, { code: "NOT_FOUND", message: `${input.kind} "${input.name}" not found.`, retryable: false });
    if (key.endsWith(".json")) {
      const json = parseThemeJson(file.content ?? "{}");
      return ok({ operationId: ctx.operationId }, familySchemaTool, { summary: `Structure of ${key}`, data: { key, schema: json } });
    }
    const insp = inspectLiquid(key, file.content ?? "");
    if (!insp.schema) return fail({ operationId: ctx.operationId }, familySchemaTool, { code: "NOT_FOUND", message: `${key} has no {% schema %} block.`, retryable: false });
    return ok({ operationId: ctx.operationId }, familySchemaTool, {
      summary: `Schema of ${key}`,
      data: { key, schema: insp.schema.json, errors: insp.schema.errors },
      warnings: insp.schema.errors.length > 0 ? [`Schema JSON has ${insp.schema.errors.length} error(s).`] : [],
    });
  },
});
















export function registerSectionBlockTemplateTools(registry: ToolRegistry): void {
  registry.registerFamily(familyInspectTool, { familyNameTemplate: "shopify.{kind}.inspect" });
  registry.registerFamily(familySchemaTool, { familyNameTemplate: "shopify.{kind}.schema" });
}
