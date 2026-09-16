/**
 * Media tools (docs/MCP_TOOL_MANIFEST.md §39), Free tier.
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listFiles } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

export const mediaListTool: ToolDefinition = defineTool({
  name: "shopify.media.list",
  description: "Lists files in the Files library, paginated.",
  tier: "free",
  category: "media",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_files"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput, query: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["files"], writes: [], stores: [], returnsToClient: ["file list"] },
  docs: { examples: [{ title: "List files", input: { first: 20 } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listFiles(admin, input);
    return ok({ operationId: ctx.operationId }, mediaListTool, { summary: `${page.items.length} file(s)`, data: page });
  },
});

export function registerMediaTools(registry: ToolRegistry): void {
  registry.register(mediaListTool);
}
