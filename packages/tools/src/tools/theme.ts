import { parseThemeJson } from "@shopmanagerai/shared";
import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Theme discovery + working-theme lifecycle tools (category "theme"):
 * list_remote, architecture, preview, duplicate, publish, delete_remote,
 * diff, files.apply. Single-file reads/writes live in theme-file.ts.
 */
import { z } from "zod";
import { type ThemeRef } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { WorkingThemeService, listAppReferences } from "@shopmanagerai/shopify-theme";
import { ThemeFileSet, buildArchitecture, buildDependencyGraph, searchFiles, findReference } from "@shopmanagerai/theme-intelligence";

import { loadThemeFileSet, requireTheme } from "../theme-loader.js";

const ThemeRefSchema = z.object({
  id: z.string(),
  gid: z.string().optional(),
  name: z.string(),
  role: z.string(),
  updatedAt: z.string().optional(),
  processing: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// shopify.theme.list_remote
// ---------------------------------------------------------------------------
export const themeListRemoteTool: ToolDefinition = defineTool({
  name: "shopify.theme.list_remote",
  aliases: ["shopify.theme.list"],
  description: "Lists all themes on the store (id, name, role, processing state).",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({}),
  outputSchema: z.object({ themes: z.array(ThemeRefSchema) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme list"], writes: [], stores: [], returnsToClient: ["theme list"] },
  docs: {
    examples: [{ title: "List themes", input: {} }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "No theme engine configured." }],
    limitations: [],
  },
  handler: async (ctx, _input) => {
    const engine = requireTheme(ctx.theme);
    const themes = await engine.listThemes();
    return ok({ operationId: ctx.operationId }, themeListRemoteTool, { summary: `${themes.length} theme(s)`, data: { themes } });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.architecture
// ---------------------------------------------------------------------------
export const themeArchitectureTool: ToolDefinition = defineTool({
  name: "shopify.theme.architecture",
  description: "Extracts a theme's static architecture: layouts, templates, sections, blocks, snippets, assets, config, locales, warnings.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ themeId: z.string().optional(), architecture: z.record(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files (redacted)"], writes: [], stores: [], returnsToClient: ["theme architecture"] },
  docs: {
    examples: [{ title: "Architecture of the live theme", input: {} }, { title: "Architecture of a specific theme", input: { themeId: "123" } }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "No theme engine configured or Theme Check unavailable." }],
    limitations: ["Static analysis only, cannot see what Liquid actually renders at runtime."],
  },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const { fileSet, maskedKeys } = await loadThemeFileSet(engine, themeId);
    const architecture = buildArchitecture(fileSet);
    return ok({ operationId: ctx.operationId }, themeArchitectureTool, {
      summary: `${architecture.counts.total} file(s): ${architecture.counts.templates} templates, ${architecture.counts.sections} sections`,
      data: { themeId, architecture: architecture as unknown as Record<string, unknown> },
      warnings: [...architecture.warnings, ...(maskedKeys.length > 0 ? [`Secrets masked in: ${maskedKeys.join(", ")}`] : [])],
    });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.preview
// ---------------------------------------------------------------------------
export const themePreviewTool: ToolDefinition = defineTool({
  name: "shopify.theme.preview",
  description: "Returns a preview URL for a theme (defaults to the working theme).",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ themeId: z.string().optional(), previewUrl: z.string() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme metadata"], writes: [], stores: [], returnsToClient: ["preview URL"] },
  docs: { examples: [{ title: "Preview the working theme", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const previewUrl = `https://${ctx.shop.domain}/?preview_theme_id=${themeId}`;
    const warnings: string[] = [];
    if (ctx.shop.passwordProtected) warnings.push("This storefront is password-protected; the preview link will prompt for the storefront password.");
    return ok({ operationId: ctx.operationId }, themePreviewTool, { summary: previewUrl, data: { themeId, previewUrl }, warnings });
  },
});













// ---------------------------------------------------------------------------
// shopify.theme.current
// ---------------------------------------------------------------------------
export const themeCurrentTool: ToolDefinition = defineTool({
  name: "shopify.theme.current",
  description: "Returns the store's live theme and the current working (unpublished ShopManager) theme, if any.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({}),
  outputSchema: z.object({ live: ThemeRefSchema, working: ThemeRefSchema.nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme list"], writes: [], stores: [], returnsToClient: ["live + working theme refs"] },
  docs: { examples: [{ title: "Get current themes", input: {} }], failureModes: [{ code: "NOT_FOUND", meaning: "No live theme found." }], limitations: [] },
  handler: async (ctx, _input) => {
    const engine = requireTheme(ctx.theme);
    const working = new WorkingThemeService(engine);
    const live = await working.live();
    const current = await working.current();
    return ok({ operationId: ctx.operationId }, themeCurrentTool, { summary: `Live: ${live.id}, working: ${current?.id ?? "none"}`, data: { live, working: current } });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.inspect / shopify.theme.info
// ---------------------------------------------------------------------------
export const themeInspectTool: ToolDefinition = defineTool({
  name: "shopify.theme.inspect",
  aliases: ["shopify.theme.info"],
  description: "Combined theme overview: ThemeRef metadata, file counts by role, and an architecture summary.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ theme: ThemeRefSchema.nullable(), counts: z.record(z.number()), architectureSummary: z.record(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme list", "theme files (redacted)"], writes: [], stores: [], returnsToClient: ["theme overview"] },
  docs: { examples: [{ title: "Inspect the working theme", input: {} }], failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "No theme engine configured." }], limitations: [] },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const themes = await engine.listThemes();
    const theme = themes.find((t) => t.id === themeId) ?? null;
    const { fileSet } = await loadThemeFileSet(engine, themeId);
    const architecture = buildArchitecture(fileSet);
    return ok({ operationId: ctx.operationId }, themeInspectTool, {
      summary: `Theme ${themeId}: ${architecture.counts.total} file(s)`,
      data: { theme, counts: fileSet.countsByRole() as unknown as Record<string, number>, architectureSummary: { counts: architecture.counts, warnings: architecture.warnings } },
    });
  },
});

// ---------------------------------------------------------------------------
// File-role listing tools: templates, sections, blocks, snippets, assets, locales
// ---------------------------------------------------------------------------
function byRoleListingTool(opts: { name: string; description: string; role: Parameters<ThemeFileSet["byRole"]>[0] }): ToolDefinition {
  const def: ToolDefinition = defineTool({
    name: opts.name,
    description: opts.description,
    tier: "free",
    category: "theme",
    riskClass: "read",
    executionPlane: "theme_engine",
    requiredEntitlements: [],
    requiredShopifyScopes: [],
    requiredStoreCapabilities: ["theme.read"],
    inputSchema: z.object({ themeId: z.string().optional() }),
    outputSchema: z.object({ themeId: z.string().optional(), files: z.array(z.unknown()) }),
    supportsDryRun: false,
    rollback: "none",
    taskMode: "sync",
    approval: "none",
    dataCategories: { reads: ["theme files (redacted)"], writes: [], stores: [], returnsToClient: ["file list"] },
    docs: { examples: [{ title: opts.name, input: {} }], failureModes: [], limitations: [] },
    handler: async (ctx, input: { themeId?: string }) => {
      const engine = requireTheme(ctx.theme);
      const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
      const { fileSet } = await loadThemeFileSet(engine, themeId);
      const files = fileSet.byRole(opts.role).map((f) => ({ key: f.key, size: f.size }));
      return ok({ operationId: ctx.operationId }, def, { summary: `${files.length} file(s)`, data: { themeId, files } });
    },
  });
  return def;
}

export const themeTemplatesTool = byRoleListingTool({ name: "shopify.theme.templates", description: "Lists a theme's JSON + Liquid template files.", role: "template_json" });
export const themeSectionsTool = byRoleListingTool({ name: "shopify.theme.sections", description: "Lists a theme's section files.", role: "section" });
export const themeBlocksTool = byRoleListingTool({ name: "shopify.theme.blocks", description: "Lists a theme's standalone block files.", role: "block" });
export const themeSnippetsTool = byRoleListingTool({ name: "shopify.theme.snippets", description: "Lists a theme's snippet files.", role: "snippet" });
export const themeAssetsTool = byRoleListingTool({ name: "shopify.theme.assets", description: "Lists a theme's asset files.", role: "asset" });
export const themeLocalesTool = byRoleListingTool({ name: "shopify.theme.locales", description: "Lists a theme's locale (translation) files.", role: "locale" });

// ---------------------------------------------------------------------------
// shopify.theme.config
// ---------------------------------------------------------------------------
export const themeConfigTool: ToolDefinition = defineTool({
  name: "shopify.theme.config",
  description: "Summarizes config/settings_schema.json: setting groups and their setting ids/types.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ themeId: z.string().optional(), groups: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: [], returnsToClient: ["settings schema summary"] },
  docs: { examples: [{ title: "Summarize settings schema", input: {} }], failureModes: [{ code: "NOT_FOUND", meaning: "config/settings_schema.json is missing or not valid JSON." }], limitations: [] },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const [file] = await engine.readFiles(themeId, ["config/settings_schema.json"]);
    if (!file?.content) {
      return fail({ operationId: ctx.operationId }, themeConfigTool, { code: "NOT_FOUND", message: "config/settings_schema.json not found.", retryable: false });
    }
    let parsed: unknown;
    try {
      parsed = parseThemeJson(file.content);
    } catch (e) {
      return fail({ operationId: ctx.operationId }, themeConfigTool, { code: "INVALID_INPUT", message: "config/settings_schema.json is not valid JSON.", technicalMessage: e instanceof Error ? e.message : String(e), retryable: false });
    }
    const groups = Array.isArray(parsed)
      ? parsed.map((g: any) => ({ name: g.name ?? "theme_info", settingIds: Array.isArray(g.settings) ? g.settings.filter((s: any) => s.id).map((s: any) => ({ id: s.id, type: s.type })) : [] }))
      : [];
    return ok({ operationId: ctx.operationId }, themeConfigTool, { summary: `${groups.length} setting group(s)`, data: { themeId, groups } });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.settings
// ---------------------------------------------------------------------------
export const themeSettingsTool: ToolDefinition = defineTool({
  name: "shopify.theme.settings",
  description: "Current config/settings_data.json values, plus the app blocks/embeds referenced within it.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ themeId: z.string().optional(), current: z.record(z.unknown()), appReferences: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme settings"], writes: [], stores: [], returnsToClient: ["current settings", "app references"] },
  docs: { examples: [{ title: "Get current settings", input: {} }], failureModes: [{ code: "NOT_FOUND", meaning: "config/settings_data.json is missing." }], limitations: [] },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const [file] = await engine.readFiles(themeId, ["config/settings_data.json"]);
    if (!file?.content) {
      return fail({ operationId: ctx.operationId }, themeSettingsTool, { code: "NOT_FOUND", message: "config/settings_data.json not found.", retryable: false });
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseThemeJson(file.content);
    } catch (e) {
      return fail({ operationId: ctx.operationId }, themeSettingsTool, { code: "INVALID_INPUT", message: "config/settings_data.json is not valid JSON.", technicalMessage: e instanceof Error ? e.message : String(e), retryable: false });
    }
    const appReferences = listAppReferences(parsed);
    return ok({ operationId: ctx.operationId }, themeSettingsTool, {
      summary: `${appReferences.length} app reference(s) in settings`,
      data: { themeId, current: (parsed.current as Record<string, unknown>) ?? {}, appReferences },
    });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.dependencies
// ---------------------------------------------------------------------------
export const themeDependenciesTool: ToolDefinition = defineTool({
  name: "shopify.theme.dependencies",
  description: "Shows what a given theme file references and what references it, via the theme dependency graph.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), key: z.string() }),
  outputSchema: z.object({ key: z.string(), referencesOf: z.array(z.unknown()), referencedBy: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: [], returnsToClient: ["dependency graph excerpt"] },
  docs: { examples: [{ title: "Find dependencies of a section", input: { key: "sections/hero.liquid" } }], failureModes: [], limitations: ["Static reference resolution only; dynamic {% render section_name %} with a variable is not resolved."] },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const { fileSet } = await loadThemeFileSet(engine, themeId);
    const architecture = buildArchitecture(fileSet);
    const graph = buildDependencyGraph(fileSet, architecture);
    return ok({ operationId: ctx.operationId }, themeDependenciesTool, {
      summary: `${graph.referencesOf(input.key).length} reference(s) out, ${graph.referencedBy(input.key).length} reference(s) in`,
      data: { key: input.key, referencesOf: graph.referencesOf(input.key), referencedBy: graph.referencedBy(input.key) },
    });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.search
// ---------------------------------------------------------------------------
export const themeSearchTool: ToolDefinition = defineTool({
  name: "shopify.theme.search",
  description: "Text/regex search over a theme's files.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), query: z.string(), regex: z.boolean().optional(), dirs: z.array(z.string()).optional(), maxResults: z.number().optional() }),
  outputSchema: z.object({ matches: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content (redacted)"], writes: [], stores: [], returnsToClient: ["search matches"] },
  docs: { examples: [{ title: "Search the theme", input: { query: "product-card" } }], failureModes: [], limitations: ["Static text/regex search only."] },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const { fileSet } = await loadThemeFileSet(engine, themeId);
    const matches = searchFiles(fileSet, input);
    return ok({ operationId: ctx.operationId }, themeSearchTool, { summary: `${matches.length} match(es)`, data: { matches } });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.find_reference
// ---------------------------------------------------------------------------
export const themeFindReferenceTool: ToolDefinition = defineTool({
  name: "shopify.theme.find_reference",
  description: "Finds where a symbol (settings id, section/snippet name, CSS class, or JS id) is referenced across the theme.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), symbol: z.string() }),
  outputSchema: z.object({ matches: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content (redacted)"], writes: [], stores: [], returnsToClient: ["symbol matches"] },
  docs: { examples: [{ title: "Find where a setting id is used", input: { symbol: "color_primary" } }], failureModes: [], limitations: ["Best-effort pattern matching, not a real Liquid/CSS/JS parser resolving scope."] },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const themeId = input.themeId! ?? (await resolveDefaultThemeId(ctx));
    const { fileSet } = await loadThemeFileSet(engine, themeId);
    const matches = findReference(fileSet, input.symbol);
    return ok({ operationId: ctx.operationId }, themeFindReferenceTool, { summary: `${matches.length} match(es)`, data: { matches } });
  },
});









export async function resolveDefaultThemeId(ctx: { theme?: import("@shopmanagerai/shared").ThemeEngine }): Promise<string> {
  const engine = requireTheme(ctx.theme);
  const working = new WorkingThemeService(engine);
  const current = await working.current();
  if (current) return current.id;
  return (await working.live()).id;
}

export function registerThemeTools(registry: ToolRegistry): void {
  registry.register(themeListRemoteTool);
  registry.register(themeArchitectureTool);
  registry.register(themePreviewTool);
  registry.register(themeCurrentTool);
  registry.register(themeInspectTool);
  registry.register(themeTemplatesTool);
  registry.register(themeSectionsTool);
  registry.register(themeBlocksTool);
  registry.register(themeSnippetsTool);
  registry.register(themeAssetsTool);
  registry.register(themeLocalesTool);
  registry.register(themeConfigTool);
  registry.register(themeSettingsTool);
  registry.register(themeDependenciesTool);
  registry.register(themeSearchTool);
  registry.register(themeFindReferenceTool);
}
