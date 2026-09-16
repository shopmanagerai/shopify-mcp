/**
 * Collection tools (docs/MCP_TOOL_MANIFEST.md §33) plus `collection.assign_template`
 * / `product.assign_template` (docs/ARCHITECTURE_REVIEW.md C2: template
 * assignment is a distinct, narrowly-scoped write from full product/collection
 * updates).
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listCollections, getCollection } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

export const collectionsListTool: ToolDefinition = defineTool({
  name: "shopify.collections.list",
  aliases: ["shopify.collections.search"],
  description: "Lists/searches collections, paginated.",
  tier: "free",
  category: "collection",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_products"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput, query: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["collection summaries"], writes: [], stores: [], returnsToClient: ["collection list"] },
  docs: { examples: [{ title: "List collections", input: { first: 20 } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listCollections(admin, input);
    return ok({ operationId: ctx.operationId }, collectionsListTool, { summary: `${page.items.length} collection(s)`, data: page });
  },
});

export const collectionGetTool: ToolDefinition = defineTool({
  name: "shopify.collection.get",
  description: "Reads a collection: description, seo, image, ruleSet (if smart), metafields, and its products.",
  tier: "free",
  category: "collection",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_products"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ id: z.string(), productsFirst: z.number().int().min(1).max(250).optional() }),
  outputSchema: z.object({ collection: z.unknown().nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["collection detail"], writes: [], stores: [], returnsToClient: ["collection detail"] },
  docs: { examples: [{ title: "Read a collection", input: { id: "gid://shopify/Collection/1" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No collection with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const collection = await getCollection(admin, input.id, input);
    if (!collection) return fail({ operationId: ctx.operationId }, collectionGetTool, { code: "NOT_FOUND", message: `Collection "${input.id}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, collectionGetTool, { summary: `Read ${collection.title}`, data: { collection } });
  },
});

export function registerCollectionTools(registry: ToolRegistry): void {
  registry.register(collectionsListTool);
  registry.register(collectionGetTool);
}
