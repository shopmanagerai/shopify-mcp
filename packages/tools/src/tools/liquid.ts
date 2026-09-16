import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Liquid inspection tools (category "liquid"). All read-only, static analysis
 * over theme-intelligence's `inspectLiquid`/dependency graph/complexity.
 */
import { z } from "zod";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { inspectLiquid } from "@shopmanagerai/theme-intelligence";
import { requireTheme } from "../theme-loader.js";

async function loadLiquidText(theme: Parameters<typeof requireTheme>[0], themeId: string, key: string): Promise<string> {
  const engine = requireTheme(theme);
  const [file] = await engine.readFiles(themeId, [key]);
  if (!file || file.content === undefined) {
    throw Object.assign(new Error(`File "${key}" not found or not text in theme ${themeId}.`), { code: "NOT_FOUND" });
  }
  return file.content;
}

const InputSchema = z.object({ themeId: z.string().optional(), key: z.string() });

function baseLiquidTool<O extends z.ZodTypeAny>(opts: {
  name: string;
  description: string;
  outputSchema: O;
  example: Record<string, unknown>;
}) {
  return {
    name: opts.name,
    description: opts.description,
    tier: "free" as const,
    category: "liquid" as const,
    riskClass: "read" as const,
    executionPlane: "theme_engine" as const,
    requiredEntitlements: [],
    requiredShopifyScopes: [],
    requiredStoreCapabilities: ["theme.read" as const],
    inputSchema: InputSchema,
    outputSchema: opts.outputSchema,
    supportsDryRun: false,
    rollback: "none" as const,
    taskMode: "sync" as const,
    approval: "none" as const,
    dataCategories: { reads: ["theme file content"], writes: [], stores: [], returnsToClient: ["liquid inspection"] },
    docs: { examples: [{ title: opts.name, input: opts.example }], failureModes: [{ code: "NOT_FOUND", meaning: "File not found or not text." }], limitations: ["Static analysis; cannot see conditional runtime behavior."] },
  };
}

export const liquidParseTool: ToolDefinition = defineTool({
  ...baseLiquidTool({ name: "shopify.liquid.parse", description: "Parses a Liquid file and returns line count and parse errors.", outputSchema: z.object({ key: z.string(), lineCount: z.number(), errors: z.array(z.unknown()) }), example: { themeId: "123", key: "sections/hero.liquid" } }),
  handler: async (ctx, input) => {
    try {
      const text = await loadLiquidText(ctx.theme, input.themeId!, input.key);
      const insp = inspectLiquid(input.key, text);
      return ok({ operationId: ctx.operationId }, liquidParseTool, { summary: `${insp.lineCount} lines, ${insp.errors.length} error(s)`, data: { key: input.key, lineCount: insp.lineCount, errors: insp.errors } });
    } catch (e: any) {
      return fail({ operationId: ctx.operationId }, liquidParseTool, { code: e.code ?? "NOT_FOUND", message: e.message, retryable: false });
    }
  },
});

export const liquidInspectTool: ToolDefinition = defineTool({
  ...baseLiquidTool({ name: "shopify.liquid.inspect", description: "Full Liquid inspection: renders, sections, schema, tags, filters, variables, nesting depth.", outputSchema: z.record(z.unknown()), example: { themeId: "123", key: "sections/hero.liquid" } }),
  handler: async (ctx, input) => {
    try {
      const text = await loadLiquidText(ctx.theme, input.themeId!, input.key);
      const insp = inspectLiquid(input.key, text);
      return ok({ operationId: ctx.operationId }, liquidInspectTool, { summary: `${insp.tagsUsed.length} tag(s), ${insp.renders.length} render(s)`, data: insp as unknown as Record<string, unknown> });
    } catch (e: any) {
      return fail({ operationId: ctx.operationId }, liquidInspectTool, { code: e.code ?? "NOT_FOUND", message: e.message, retryable: false });
    }
  },
});

export const liquidValidateTool: ToolDefinition = defineTool({
  ...baseLiquidTool({ name: "shopify.liquid.validate", description: "Validates a Liquid file: true if it parses with no errors (including schema JSON errors).", outputSchema: z.object({ valid: z.boolean(), errors: z.array(z.unknown()) }), example: { themeId: "123", key: "sections/hero.liquid" } }),
  handler: async (ctx, input) => {
    try {
      const text = await loadLiquidText(ctx.theme, input.themeId!, input.key);
      const insp = inspectLiquid(input.key, text);
      const errors = [...insp.errors, ...(insp.schema?.errors ?? [])];
      return ok({ operationId: ctx.operationId }, liquidValidateTool, { summary: errors.length === 0 ? "Valid" : `${errors.length} error(s)`, data: { valid: errors.length === 0, errors } });
    } catch (e: any) {
      return fail({ operationId: ctx.operationId }, liquidValidateTool, { code: e.code ?? "NOT_FOUND", message: e.message, retryable: false });
    }
  },
});

export function registerLiquidTools(registry: ToolRegistry): void {
  registry.register(liquidParseTool);
  registry.register(liquidInspectTool);
  registry.register(liquidValidateTool);
}
