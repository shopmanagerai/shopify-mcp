/**
 * Metaobject tools (docs/MCP_TOOL_MANIFEST.md §38), Free tier.
 */
import { z } from "zod";

import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listMetaobjectDefinitions, listMetaobjects } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

export const metaobjectDefinitionsTool: ToolDefinition = defineTool({
  name: "shopify.metaobjects.definitions",
  description: "Lists metaobject definitions, paginated.",
  tier: "free",
  category: "metaobject",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_metaobject_definitions"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["metaobject definitions"], writes: [], stores: [], returnsToClient: ["definition list"] },
  docs: { examples: [{ title: "List metaobject definitions", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listMetaobjectDefinitions(admin, input);
    return ok({ operationId: ctx.operationId }, metaobjectDefinitionsTool, { summary: `${page.items.length} definition(s)`, data: page });
  },
});

export const metaobjectsListTool: ToolDefinition = defineTool({
  name: "shopify.metaobjects.list",
  description: "Lists metaobject entries of a given type, paginated.",
  tier: "free",
  category: "metaobject",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_metaobjects"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ type: z.string(), ...paginationInput }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["metaobjects"], writes: [], stores: [], returnsToClient: ["metaobject list"] },
  docs: { examples: [{ title: "List size_guide entries", input: { type: "size_guide" } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listMetaobjects(admin, input.type, input);
    return ok({ operationId: ctx.operationId }, metaobjectsListTool, { summary: `${page.items.length} entr(y/ies)`, data: page });
  },
});

export function registerMetaobjectTools(registry: ToolRegistry): void {
  registry.register(metaobjectDefinitionsTool);
  registry.register(metaobjectsListTool);
}
