import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Theme Check tools (category "theme_check"): summary (counts by severity)
 * and inspect_issue (detail for a single offense).
 */
import { z } from "zod";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { runThemeCheck } from "@shopmanagerai/shopify-theme";
import { requireTheme } from "../theme-loader.js";

export const themeCheckSummaryTool: ToolDefinition = defineTool({
  name: "shopify.theme_check.summary",
  description: "Runs Theme Check across a theme's files and returns offense counts by severity, plus the full offense list.",
  tier: "free",
  category: "theme_check",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }), offenses: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: [], returnsToClient: ["theme check offenses"] },
  docs: {
    examples: [{ title: "Theme Check summary", input: { themeId: "123" } }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "Theme Check could not load/run in this environment." }],
    limitations: ["Runs against the theme's current files; does not simulate merchant-specific settings values."],
  },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const metas = await engine.listFiles(input.themeId!);
    const files = await engine.readFiles(input.themeId!, metas.map((f) => f.key));
    try {
      const result = await runThemeCheck(files);
      return ok({ operationId: ctx.operationId }, themeCheckSummaryTool, {
        summary: `${result.counts.error} error(s), ${result.counts.warning} warning(s), ${result.counts.info} info`,
        data: result,
      });
    } catch (e) {
      if (e instanceof ShopManagerAIError) return fail({ operationId: ctx.operationId }, themeCheckSummaryTool, e);
      throw e;
    }
  },
});

export const themeCheckInspectIssueTool: ToolDefinition = defineTool({
  name: "shopify.theme_check.inspect_issue",
  description: "Runs Theme Check and returns detail for offenses matching a given check name and/or file.",
  tier: "free",
  category: "theme_check",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), check: z.string().optional(), file: z.string().optional() }),
  outputSchema: z.object({ offenses: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: [], returnsToClient: ["theme check offense detail"] },
  docs: {
    examples: [{ title: "Inspect a specific check", input: { themeId: "123", check: "UnknownFilter" } }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "Theme Check could not load/run in this environment." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const metas = await engine.listFiles(input.themeId!);
    const files = await engine.readFiles(input.themeId!, metas.map((f) => f.key));
    try {
      const result = await runThemeCheck(files);
      const offenses = result.offenses.filter((o) => (!input.check || o.check === input.check) && (!input.file || o.file === input.file));
      return ok({ operationId: ctx.operationId }, themeCheckInspectIssueTool, { summary: `${offenses.length} matching offense(s)`, data: { offenses } });
    } catch (e) {
      if (e instanceof ShopManagerAIError) return fail({ operationId: ctx.operationId }, themeCheckInspectIssueTool, e);
      throw e;
    }
  },
});

// ---------------------------------------------------------------------------
// shopify.theme_check.run
// ---------------------------------------------------------------------------
export const themeCheckRunTool: ToolDefinition = defineTool({
  name: "shopify.theme_check.run",
  aliases: ["shopify.theme.check"],
  description: "Runs Theme Check, optionally scoped to a subset of file keys and/or filtered by minimum severity.",
  tier: "free",
  category: "theme_check",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), keys: z.array(z.string()).optional(), severity: z.enum(["error", "warning", "info"]).optional() }),
  outputSchema: z.object({ counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }), offenses: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: [], returnsToClient: ["theme check offenses"] },
  docs: {
    examples: [
      { title: "Run against the whole theme", input: { themeId: "123" } },
      { title: "Run against specific files", input: { themeId: "123", keys: ["sections/hero.liquid"] } },
    ],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "Theme Check could not load/run in this environment." }],
    limitations: ["Runs against the theme's current files; does not simulate merchant-specific settings values."],
  },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const metas = await engine.listFiles(input.themeId!);
    const keys = input.keys ?? metas.map((f) => f.key);
    const files = await engine.readFiles(input.themeId!, keys);
    const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
    try {
      const result = await runThemeCheck(files);
      const offenses = input.severity
        ? result.offenses.filter((o) => severityRank[o.severity]! <= severityRank[input.severity as string]!)
        : result.offenses;
      return ok({ operationId: ctx.operationId }, themeCheckRunTool, {
        summary: `${offenses.length} offense(s) (of ${result.offenses.length} total)`,
        data: { counts: result.counts, offenses },
      });
    } catch (e) {
      if (e instanceof ShopManagerAIError) return fail({ operationId: ctx.operationId }, themeCheckRunTool, e);
      throw e;
    }
  },
});

// ---------------------------------------------------------------------------
// shopify.theme_check.list_checks
// ---------------------------------------------------------------------------
export const themeCheckListChecksTool: ToolDefinition = defineTool({
  name: "shopify.theme_check.list_checks",
  description: "Lists the Theme Check check names this environment's @shopify/theme-check-node can run, derived by running it once against the given theme (or a minimal built-in theme skeleton).",
  tier: "free",
  category: "theme_check",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ checks: z.array(z.string()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: [], returnsToClient: ["check name list"] },
  docs: {
    examples: [{ title: "List available checks", input: {} }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "Theme Check could not load/run in this environment." }],
    limitations: [
      "@shopify/theme-check-node does not export a static check registry in the version this package depends on, so this list is DERIVED empirically: it runs Theme Check once and reports the check names actually observed offending. A theme with zero offenses for a given check will not surface that check's name here. This is a lower bound on the available checks, not a complete registry.",
    ],
  },
  handler: async (ctx, input) => {
    let files: Array<{ key: string; content?: string }>;
    if (input.themeId!) {
      const engine = requireTheme(ctx.theme);
      const metas = await engine.listFiles(input.themeId!);
      files = await engine.readFiles(input.themeId!, metas.map((f) => f.key));
    } else {
      // Minimal skeleton likely to trigger a broad set of common checks.
      files = [
        { key: "layout/theme.liquid", content: "<html><head></head><body>{{ content_for_layout }}</body></html>" },
        { key: "templates/index.json", content: '{"sections":{},"order":[]}' },
        { key: "sections/broken.liquid", content: "{% assign x = 1 %}{{ undefined_variable }}{% unknownfilter: 1 %}" },
      ];
    }
    try {
      const result = await runThemeCheck(files);
      const checks = [...new Set(result.offenses.map((o) => o.check))].sort();
      return ok({ operationId: ctx.operationId }, themeCheckListChecksTool, { summary: `${checks.length} check name(s) observed`, data: { checks } });
    } catch (e) {
      if (e instanceof ShopManagerAIError) return fail({ operationId: ctx.operationId }, themeCheckListChecksTool, e);
      throw e;
    }
  },
});

export function registerThemeCheckTools(registry: ToolRegistry): void {
  registry.register(themeCheckSummaryTool);
  registry.register(themeCheckInspectIssueTool);
  registry.register(themeCheckRunTool);
  registry.register(themeCheckListChecksTool);
}
