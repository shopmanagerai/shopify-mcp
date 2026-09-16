/**
 * Navigation menu tools (docs/MCP_TOOL_MANIFEST.md §36). `menuUpdate` replaces
 * the full item tree, so `navigation.update` requires `confirm: true`, shows
 * a tree diff on dryRun, and records the previous tree for rollback.
 */
import { z } from "zod";

import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listMenus, getMenu } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

export const menusListTool: ToolDefinition = defineTool({
  name: "shopify.navigation.list",
  description: "Lists navigation menus (main-menu, footer, etc.), paginated.",
  tier: "free",
  category: "navigation",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_online_store_navigation"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["menus"], writes: [], stores: [], returnsToClient: ["menu list"] },
  docs: { examples: [{ title: "List menus", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listMenus(admin, input);
    return ok({ operationId: ctx.operationId }, menusListTool, { summary: `${page.items.length} menu(s)`, data: page });
  },
});

export const menuGetTool: ToolDefinition = defineTool({
  name: "shopify.navigation.get",
  aliases: ["shopify.navigation.inspect"],
  description: "Reads a menu's full nested item tree.",
  tier: "free",
  category: "navigation",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_online_store_navigation"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ menu: z.unknown().nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["menu tree"], writes: [], stores: [], returnsToClient: ["menu detail"] },
  docs: { examples: [{ title: "Read a menu", input: { id: "gid://shopify/Menu/1" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No menu with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const menu = await getMenu(admin, input.id);
    if (!menu) return fail({ operationId: ctx.operationId }, menuGetTool, { code: "NOT_FOUND", message: `Menu "${input.id}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, menuGetTool, { summary: `Read menu ${menu.title} (${menu.items.length} top-level item(s))`, data: { menu } });
  },
});

export function registerNavigationTools(registry: ToolRegistry): void {
  registry.register(menusListTool);
  registry.register(menuGetTool);
}
