/**
 * URL redirect tools (`shopify.redirects.*`), Free tier. Delete is
 * destructive and requires confirm:true.
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listUrlRedirects } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

export const redirectsListTool: ToolDefinition = defineTool({
  name: "shopify.redirects.list",
  description: "Lists URL redirects, paginated.",
  tier: "free",
  category: "seo",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_online_store_navigation"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput, query: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["url redirects"], writes: [], stores: [], returnsToClient: ["redirect list"] },
  docs: { examples: [{ title: "List redirects", input: { first: 20 } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listUrlRedirects(admin, input);
    return ok({ operationId: ctx.operationId }, redirectsListTool, { summary: `${page.items.length} redirect(s)`, data: page });
  },
});

export function registerRedirectTools(registry: ToolRegistry): void {
  registry.register(redirectsListTool);
}
