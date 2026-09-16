/**
 * Fallback tool registry, used only while @shopmanagerai/tools has not yet
 * shipped `createRegistry` / `loadSkills` / `listResources` / `readResource`
 * (it is being built concurrently by another agent, see task brief). Every
 * call site goes through `src/tools-boundary.ts`, which prefers the real
 * package the moment it exposes these exports.
 *
 * Registers a small number of real, working tools so the server is testable
 * end to end today: theme architecture read, theme file write (working
 * theme), and a diagnostics tool.
 */
import { z } from "zod";
import { ShopManagerAIError, type ToolContext, type ToolDefinition } from "@shopmanagerai/shared";
import { ToolRegistry } from "@shopmanagerai/tool-registry";

const ThemeArchitectureInput = z.object({ themeId: z.string().optional() });
const ThemeArchitectureOutput = z.object({
  themeId: z.string(),
  sections: z.array(z.string()),
  templates: z.array(z.string()),
  fileCount: z.number(),
});

const themeArchitectureTool: ToolDefinition = {
  name: "shopify.theme.architecture",
  version: "0.1.0",
  description: "Summarise a theme's layout, templates, sections and snippets.",
  tier: "free",
  category: "theme",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: ThemeArchitectureInput,
  outputSchema: ThemeArchitectureOutput,
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: false,
  taskMode: "sync",
  idempotency: "natural",
  timeoutMs: 15000,
  rateLimitCategory: "theme",
  audit: "mutations_only",
  approval: "none",
  dataCategories: { reads: ["theme_files"], writes: [], stores: [], returnsToClient: ["theme_structure"] },
  docs: {
    examples: [{ title: "Architecture of the live theme", input: {} }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "No theme engine configured for this store." }],
    limitations: ["Metadata only; does not return full file contents."],
  },
  handler: async (ctx: ToolContext, input) => {
    if (!ctx.theme) throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "No theme engine available for this store.");
    const theme = input.themeId ? await ctx.theme.getTheme(input.themeId) : await (ctx.workingTheme ? ctx.workingTheme.live() : ctx.theme.listThemes().then((t) => t[0]));
    if (!theme) throw new ShopManagerAIError("NOT_FOUND", "Theme not found.");
    const files = await ctx.theme.listFiles(theme.id);
    const sections = files.filter((f) => f.key.startsWith("sections/")).map((f) => f.key);
    const templates = files.filter((f) => f.key.startsWith("templates/")).map((f) => f.key);
    return {
      ok: true,
      operationId: ctx.operationId,
      tool: "shopify.theme.architecture",
      summary: `Theme "${theme.name}" has ${files.length} files (${sections.length} sections, ${templates.length} templates).`,
      risk: "read",
      data: { themeId: theme.id, sections, templates, fileCount: files.length },
      changes: [],
      evidence: [],
      warnings: [],
      errors: [],
      nextActions: [],
      rollback: { available: false, strategy: "none" },
    };
  },
};

const ThemeFileUpdateInput = z.object({
  key: z.string(),
  content: z.string(),
});
const ThemeFileUpdateOutput = z.object({ key: z.string(), themeId: z.string() });

const themeFileUpdateTool: ToolDefinition = {
  name: "shopify.theme.file.update",
  version: "0.1.0",
  description: "Write a file to the store's working (unpublished) theme.",
  tier: "free",
  category: "theme_file",
  riskClass: "theme_write",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.write"],
  inputSchema: ThemeFileUpdateInput,
  outputSchema: ThemeFileUpdateOutput,
  supportsDryRun: false,
  rollback: "ledger_before_image",
  supportsPagination: false,
  taskMode: "sync",
  idempotency: "key_required",
  timeoutMs: 15000,
  rateLimitCategory: "theme",
  audit: "always",
  approval: "none",
  dataCategories: { reads: ["theme_files"], writes: ["theme_files"], stores: ["ledger_before_image"], returnsToClient: ["write_result"] },
  docs: {
    examples: [{ title: "Update a section file", input: { key: "sections/hero.liquid", content: "{% comment %}...{% endcomment %}" } }],
    failureModes: [{ code: "WORKING_THEME_MISSING", meaning: "No working theme could be created or found." }],
    limitations: ["Never writes to the live/published theme."],
  },
  handler: async (ctx: ToolContext, input) => {
    if (!ctx.theme) throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "No theme engine available for this store.");
    if (!ctx.workingTheme) throw new ShopManagerAIError("WORKING_THEME_MISSING", "No working-theme service configured.");
    const working = await ctx.workingTheme.ensure();
    const [before] = await ctx.theme.readFiles(working.id, [input.key]);
    const result = await ctx.theme.writeFiles(working.id, [{ key: input.key, content: input.content }]);
    if (result.errors.length > 0) {
      throw new ShopManagerAIError("UPSTREAM_ERROR", `Failed to write ${input.key}: ${result.errors.map((e) => e.message).join("; ")}`);
    }
    return {
      ok: true,
      operationId: ctx.operationId,
      tool: "shopify.theme.file.update",
      summary: `Updated ${input.key} in working theme ${working.id}.`,
      risk: "theme_write",
      data: { key: input.key, themeId: working.id },
      changes: [
        {
          resource: `theme_file:${working.id}:${input.key}`,
          kind: before ? "update" : "create",
          before: before ?? null,
          after: { content: input.content },
        },
      ],
      evidence: [],
      warnings: [],
      errors: [],
      nextActions: [],
      rollback: { available: true, strategy: "ledger_before_image" },
    };
  },
};

const DiagnosticsInput = z.object({});
const DiagnosticsOutput = z.object({ checks: z.array(z.object({ id: z.string(), status: z.string(), detail: z.string().optional() })) });

const diagnosticsTool: ToolDefinition = {
  name: "commerce.diagnostics",
  version: "0.1.0",
  description: "Report basic store-capability diagnostics.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: DiagnosticsInput,
  outputSchema: DiagnosticsOutput,
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: false,
  taskMode: "sync",
  idempotency: "natural",
  timeoutMs: 5000,
  rateLimitCategory: "none",
  audit: "mutations_only",
  approval: "none",
  dataCategories: { reads: ["capabilities"], writes: [], stores: [], returnsToClient: ["diagnostics"] },
  docs: {
    examples: [{ title: "Run diagnostics", input: {} }],
    failureModes: [],
    limitations: ["Fallback implementation; not the full commerce.diagnostics from @shopmanagerai/tools."],
  },
  handler: async (ctx: ToolContext) => {
    const checks = [
      { id: "admin", status: ctx.admin ? "ok" : "skip", detail: ctx.admin ? undefined : "No admin client configured." },
      { id: "theme", status: ctx.theme ? "ok" : "skip", detail: ctx.theme ? undefined : "No theme engine configured." },
      { id: "browser", status: ctx.browser ? "ok" : "skip", detail: ctx.browser ? undefined : "No browser plane configured." },
    ];
    return {
      ok: true,
      operationId: ctx.operationId,
      tool: "commerce.diagnostics",
      summary: `${checks.filter((c) => c.status === "ok").length}/${checks.length} planes available.`,
      risk: "read",
      data: { checks },
      changes: [],
      evidence: [],
      warnings: [],
      errors: [],
      nextActions: [],
      rollback: { available: false, strategy: "none" },
    };
  },
};

export function createFallbackRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(themeArchitectureTool);
  registry.register(themeFileUpdateTool);
  registry.register(diagnosticsTool);
  return registry;
}

export async function loadSkillsFallback(_dir: string): Promise<Array<{ name: string; title: string; description: string; tier: string }>> {
  return [];
}

export async function listResourcesFallback(_ctx?: unknown): Promise<Array<{ uri: string; name: string; description?: string; mimeType?: string }>> {
  return [];
}

export async function readResourceFallback(_ctx?: unknown, _uri?: string): Promise<Array<{ uri: string; mimeType?: string; text?: string }>> {
  throw new ShopManagerAIError("NOT_FOUND", "Resource not found.");
}
