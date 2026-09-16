/**
 * Product catalog tools (docs/MCP_TOOL_MANIFEST.md §29-32). Reads are Free
 * tier, `admin.read`. Writes are Free tier, `admin.write`, dryRun-capable,
 * and record a `Change` with resource `"product:<gid>"` /
 * `"variant:<gid>"` so `@shopmanagerai/ledger` can roll them back via
 * `inverse_operation`. Price/compareAtPrice/sku/barcode live only on
 * `variant.update`, which is `commerce_sensitive` (docs/ARCHITECTURE_REVIEW.md
 * C2), `product.update_basic` never touches price.
 */
import { z } from "zod";

import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listProducts, getProduct } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

// ---------------------------------------------------------------------------
// shopify.products.list
// ---------------------------------------------------------------------------
export const productsListTool: ToolDefinition = defineTool({
  name: "shopify.products.list",
  aliases: ["shopify.products.search"],
  description: "Lists/searches products (Shopify search-syntax `query`), paginated.",
  tier: "free",
  category: "product",
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
  dataCategories: { reads: ["product summaries"], writes: [], stores: [], returnsToClient: ["product list"] },
  docs: {
    examples: [{ title: "List active products", input: { query: "status:active", first: 20 } }],
    failureModes: [{ code: "ADMIN_CLIENT_UNAVAILABLE", meaning: "No Shopify Admin API client is configured." }],
    limitations: ["Search syntax follows Shopify's product search grammar."],
  },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listProducts(admin, input);
    return ok({ operationId: ctx.operationId }, productsListTool, { summary: `${page.items.length} product(s)`, data: page });
  },
});

// ---------------------------------------------------------------------------
// shopify.product.get
// ---------------------------------------------------------------------------
export const productGetTool: ToolDefinition = defineTool({
  name: "shopify.product.get",
  description: "Reads a single product: core fields, seo, variants, media count, collections, publications count.",
  tier: "free",
  category: "product",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_products"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ product: z.unknown().nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["product detail"], writes: [], stores: [], returnsToClient: ["product detail"] },
  docs: {
    examples: [{ title: "Read a product", input: { id: "gid://shopify/Product/1" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "No product with that id." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const product = await getProduct(admin, input.id);
    if (!product) return fail({ operationId: ctx.operationId }, productGetTool, { code: "NOT_FOUND", message: `Product "${input.id}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, productGetTool, { summary: `Read ${product.title}`, data: { product } });
  },
});
























export function registerProductTools(registry: ToolRegistry): void {
  registry.register(productsListTool);
  registry.register(productGetTool);
}
