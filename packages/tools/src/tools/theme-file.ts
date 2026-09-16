
import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Single theme-file tools (category "theme_file"): read, update, delete.
 * Reads go through ThemeFileSet + redaction; writes resolve the working
 * theme, validate the path, support dryRun, merge JSON structurally when
 * requested, run Theme Check best-effort, and warn on app-integration loss.
 */
import { z } from "zod";

import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { diffStrings, validateThemeKey } from "@shopmanagerai/shopify-theme";
import { ThemeFileSet, redactThemeFile, searchFiles } from "@shopmanagerai/theme-intelligence";

import { requireTheme, loadThemeFileSet } from "../theme-loader.js";

// ---------------------------------------------------------------------------
// shopify.theme_file.read
// ---------------------------------------------------------------------------
export const themeFileReadTool: ToolDefinition = defineTool({
  name: "shopify.theme.file.read",
  aliases: ["shopify.theme_file.read"],
  description: "Reads one theme file's contents, with secrets redacted. Binary files return metadata only.",
  tier: "free",
  category: "theme_file",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), key: z.string() }),
  outputSchema: z.object({ key: z.string(), content: z.string().optional(), contentBase64: z.string().optional(), masked: z.boolean(), exists: z.boolean() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content (redacted)"], writes: [], stores: [], returnsToClient: ["file content"] },
  docs: {
    examples: [{ title: "Read a section file", input: { themeId: "123", key: "sections/hero.liquid" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "The file does not exist in the theme." }, { code: "INVALID_PATH", meaning: "The key is outside the allowed theme file sandbox." }],
    limitations: ["Binary files larger than 512KB return metadata only, not content."],
  },
  handler: async (ctx, input) => {
    validateThemeKey(input.key);
    const engine = requireTheme(ctx.theme);
    const [file] = await engine.readFiles(input.themeId!, [input.key]);
    if (!file) {
      return fail({ operationId: ctx.operationId }, themeFileReadTool, { code: "NOT_FOUND", message: `File "${input.key}" not found in theme ${input.themeId!}.`, retryable: false });
    }
    const redacted = redactThemeFile(file);
    return ok({ operationId: ctx.operationId }, themeFileReadTool, {
      summary: `Read ${input.key} (${redacted.content?.length ?? 0} chars)`,
      data: { key: redacted.key, content: redacted.content, contentBase64: redacted.contentBase64, masked: redacted.masked, exists: true },
      warnings: redacted.masked ? [`Secrets were masked in ${input.key}.`] : [],
    });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.file.search
// ---------------------------------------------------------------------------
export const themeFileSearchTool: ToolDefinition = defineTool({
  name: "shopify.theme.file.search",
  description: "Searches a theme's files by text/regex query, optionally scoped to directories.",
  tier: "free",
  category: "theme_file",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({
    themeId: z.string().optional(),
    query: z.string(),
    regex: z.boolean().optional(),
    dirs: z.array(z.string()).optional(),
    maxResults: z.number().optional(),
    contextLines: z.number().optional(),
    caseSensitive: z.boolean().optional(),
  }),
  outputSchema: z.object({ matches: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content (redacted)"], writes: [], stores: [], returnsToClient: ["search matches"] },
  docs: {
    examples: [{ title: "Search for a CSS class", input: { themeId: "123", query: "product-card" } }],
    failureModes: [{ code: "THEME_ENGINE_UNAVAILABLE", meaning: "No theme engine configured." }],
    limitations: ["Static text/regex search only; results are capped by maxResults (default 100)."],
  },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const { fileSet } = await loadThemeFileSet(engine, input.themeId!);
    const matches = searchFiles(fileSet, input);
    return ok({ operationId: ctx.operationId }, themeFileSearchTool, { summary: `${matches.length} match(es)`, data: { matches } });
  },
});

// ---------------------------------------------------------------------------
// shopify.theme.file.diff
// ---------------------------------------------------------------------------
export const themeFileDiffTool: ToolDefinition = defineTool({
  name: "shopify.theme.file.diff",
  description: "Diffs one file's content between two themes, or between a theme and a snapshot.",
  tier: "free",
  category: "theme_file",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ key: z.string(), themeId: z.string().optional(), compareThemeId: z.string().optional(), compareSnapshotId: z.string().optional() }),
  outputSchema: z.object({ key: z.string(), diff: z.string(), identical: z.boolean() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme file content (redacted)", "snapshot data"], writes: [], stores: [], returnsToClient: ["file diff"] },
  docs: {
    examples: [{ title: "Diff a section between working and live theme", input: { key: "sections/hero.liquid", themeId: "124", compareThemeId: "100" } }],
    failureModes: [{ code: "INVALID_INPUT", meaning: "Neither compareThemeId nor compareSnapshotId was supplied." }, { code: "SNAPSHOT_NOT_FOUND", meaning: "compareSnapshotId does not exist." }],
    limitations: ["Binary files are compared by presence only, not diffed byte-for-byte."],
  },
  handler: async (ctx, input) => {
    if (!input.compareThemeId && !input.compareSnapshotId) {
      return fail({ operationId: ctx.operationId }, themeFileDiffTool, { code: "INVALID_INPUT", message: "Provide compareThemeId or compareSnapshotId.", retryable: false });
    }
    const engine = requireTheme(ctx.theme);
    const [fromFile] = await engine.readFiles(input.themeId!, [input.key]);

    let toContent: string | undefined;
    if (input.compareThemeId) {
      const [toFile] = await engine.readFiles(input.compareThemeId, [input.key]);
      toContent = toFile?.content;
    } else if (input.compareSnapshotId) {
      const snap = await ctx.snapshots.get(input.compareSnapshotId);
      if (!snap) {
        return fail({ operationId: ctx.operationId }, themeFileDiffTool, { code: "SNAPSHOT_NOT_FOUND", message: `Snapshot "${input.compareSnapshotId}" not found.`, retryable: false });
      }
      const [snapFile] = await ctx.snapshots.readThemeFiles(input.compareSnapshotId, [input.key]);
      toContent = snapFile?.content;
    }

    const fromText = fromFile?.content ?? "";
    const toText = toContent ?? "";
    const diff = diffStrings(fromText, toText, { fileNameBefore: input.key, fileNameAfter: input.key });
    return ok({ operationId: ctx.operationId }, themeFileDiffTool, {
      summary: fromText === toText ? "Identical" : "Differs",
      data: { key: input.key, diff, identical: fromText === toText },
    });
  },
});

export function registerThemeFileTools(registry: ToolRegistry): void {
  registry.register(themeFileReadTool);
  registry.register(themeFileSearchTool);
  registry.register(themeFileDiffTool);
}
