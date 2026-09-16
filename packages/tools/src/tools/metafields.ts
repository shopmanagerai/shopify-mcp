/**
 * Metafield tools (docs/MCP_TOOL_MANIFEST.md §37), Free tier. Refuses to
 * write/delete app-owned namespaces (`$app:...`) with APP_OWNED_METAFIELD --
 * those belong to installed apps, not to merchant-facing tools.
 */
import { z } from "zod";

import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listMetafieldDefinitions, listMetafieldsOnOwner } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };
const OWNER_TYPES = ["PRODUCT", "PRODUCTVARIANT", "COLLECTION", "PAGE", "ARTICLE", "BLOG", "ORDER", "CUSTOMER", "SHOP"] as const;

export const metafieldDefinitionsTool: ToolDefinition = defineTool({
  name: "shopify.metafields.definitions",
  description: "Lists metafield definitions for an owner type, paginated.",
  tier: "free",
  category: "metafield",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_products"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ownerType: z.enum(OWNER_TYPES), ...paginationInput }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["metafield definitions"], writes: [], stores: [], returnsToClient: ["definition list"] },
  docs: { examples: [{ title: "List product metafield definitions", input: { ownerType: "PRODUCT" } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listMetafieldDefinitions(admin, input.ownerType, input);
    return ok({ operationId: ctx.operationId }, metafieldDefinitionsTool, { summary: `${page.items.length} definition(s)`, data: page });
  },
});

export const metafieldsListTool: ToolDefinition = defineTool({
  name: "shopify.metafields.list",
  description: "Lists the metafields set on a specific owner (product, collection, page, article, etc.), paginated.",
  tier: "free",
  category: "metafield",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_products"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ownerId: z.string(), ...paginationInput }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["metafields"], writes: [], stores: [], returnsToClient: ["metafield list"] },
  docs: { examples: [{ title: "List a product's metafields", input: { ownerId: "gid://shopify/Product/1" } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listMetafieldsOnOwner(admin, input.ownerId, input);
    return ok({ operationId: ctx.operationId }, metafieldsListTool, { summary: `${page.items.length} metafield(s)`, data: page });
  },
});

export function registerMetafieldTools(registry: ToolRegistry): void {
  registry.register(metafieldDefinitionsTool);
  registry.register(metafieldsListTool);
}
