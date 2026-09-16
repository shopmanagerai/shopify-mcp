/**
 * Publication tools (`shopify.product.publish` / `shopify.product.unpublish`),
 * Free tier, "publish" risk class (docs/PRODUCT_ARCHITECTURE.md risk vocabulary).
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listPublications, getProductPublications } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";






export const productPublicationStatusTool: ToolDefinition = defineTool({
  name: "shopify.publications.list",
  description: "Lists sales channel publications and, when a product id is given, whether that product is published to each.",
  tier: "free",
  category: "product",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_publications"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ productId: z.string().optional() }),
  outputSchema: z.object({ publications: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["publications"], writes: [], stores: [], returnsToClient: ["publication list"] },
  docs: { examples: [{ title: "List publications", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    if (input.productId) {
      const publications = await getProductPublications(admin, input.productId);
      return ok({ operationId: ctx.operationId }, productPublicationStatusTool, { summary: `${publications.length} publication(s)`, data: { publications } });
    }
    const publications = await listPublications(admin);
    return ok({ operationId: ctx.operationId }, productPublicationStatusTool, { summary: `${publications.length} publication(s)`, data: { publications } });
  },
});

export function registerPublicationTools(registry: ToolRegistry): void {
  registry.register(productPublicationStatusTool);
}
