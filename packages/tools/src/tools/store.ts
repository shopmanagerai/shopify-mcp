import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Store tools (category "store"): summary/inspect/configuration/health_basic.
 * Uses shopify-admin operations when ctx.admin is present; falls back to a
 * theme-only summary (with a warning) otherwise.
 */
import { z } from "zod";
import { defineTool } from "@shopmanagerai/tool-registry";
import { ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { fetchShopSummary } from "@shopmanagerai/shopify-admin";

const StoreSummaryOutput = z.object({
  name: z.string().optional(),
  domain: z.string(),
  primaryDomainUrl: z.string().optional(),
  planDisplayName: z.string().optional(),
  currencyCode: z.string().optional(),
  passwordProtected: z.boolean().optional(),
  themeCount: z.number().optional(),
});

async function buildSummary(ctx: Parameters<typeof storeSummaryTool.handler>[0]) {
  const base = { domain: ctx.shop.domain, name: ctx.shop.name, passwordProtected: ctx.shop.passwordProtected };
  let admin: Awaited<ReturnType<typeof fetchShopSummary>> | undefined;
  const warnings: string[] = [];
  if (ctx.admin) {
    try {
      admin = await fetchShopSummary(ctx.admin);
    } catch (e) {
      warnings.push(`Admin summary unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    warnings.push("No Admin GraphQL client configured; returning a theme-only summary.");
  }
  let themeCount: number | undefined;
  if (ctx.theme) {
    try {
      themeCount = (await ctx.theme.listThemes()).length;
    } catch {
      // best effort
    }
  }
  return {
    data: {
      ...base,
      name: admin?.name ?? base.name,
      primaryDomainUrl: admin?.primaryDomainUrl,
      planDisplayName: admin?.planDisplayName,
      currencyCode: admin?.currencyCode ?? ctx.shop.currency,
      themeCount,
    },
    warnings,
  };
}

export const storeSummaryTool: ToolDefinition = defineTool({
  name: "shopify.store.summary",
  description: "Basic store facts: name, domain, plan, currency, password protection, theme count.",
  tier: "free",
  category: "store",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: StoreSummaryOutput,
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["shop object"], writes: [], stores: [], returnsToClient: ["store summary"] },
  docs: { examples: [{ title: "Get store summary", input: {} }], failureModes: [], limitations: ["Falls back to theme-only data when Admin API is unavailable."] },
  handler: async (ctx, _input) => {
    const { data, warnings } = await buildSummary(ctx);
    return ok({ operationId: ctx.operationId }, storeSummaryTool, { summary: `Store: ${data.name ?? data.domain}`, data, warnings });
  },
});

export function registerStoreTools(registry: ToolRegistry): void {
  registry.register(storeSummaryTool);
}
