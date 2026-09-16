/**
 * Phase 5 commerce operations tools: inventory/locations, markets, locales +
 * translations, catalogs + price lists, discounts, orders/draft orders,
 * fulfillment, returns, customers.
 *
 * Conventions: reads are `read`; ordinary writes are `write`; anything that moves
 * money or stock (inventory set/adjust, discounts, price lists, draft order
 * complete, order cancel, returns, fulfillment) is `commerce_sensitive` so the
 * production_safe profile refuses it and the risk level reads FINANCIAL_IMPACT /
 * COMMERCE_WRITE; deletes are `destructive` and need confirm:true. Orders, draft
 * orders, returns, fulfillment and customers carry protectedCustomerData. Every
 * write records a before-image; rollback strategies are honest ("inverse_operation"
 * only where the ledger can actually reverse it).
 */
import { z } from "zod";
import { type ToolDefinition, type ToolCategory, type RiskClass } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listLocations, getProductInventory, ProductNotFoundError, INVENTORY_QUANTITY_NAMES, listMarkets, getMarket, listShopLocales, getTranslatableResource, listTranslatableResources, TRANSLATABLE_RESOURCE_TYPES, listCatalogs, listPriceLists, getPriceListPrices, listDiscounts, getDiscount } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const notFound = (ctx: { operationId: string }, def: ToolDefinition, what: string) => fail({ operationId: ctx.operationId }, def, { code: "NOT_FOUND", message: `${what} not found.`, retryable: false });

const pagination = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };
const pageOut = z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() });

const EXAMPLES: Record<string, Record<string, unknown>> = {
  "shopify.locations.list": {},
  "shopify.inventory.get": { productId: "gid://shopify/Product/1" },
  "shopify.inventory.set": { productId: "gid://shopify/Product/1", quantities: [{ variantId: "gid://shopify/ProductVariant/1", locationId: "gid://shopify/Location/1", quantity: 25 }], reason: "correction" },
  "shopify.inventory.adjust": { productId: "gid://shopify/Product/1", changes: [{ variantId: "gid://shopify/ProductVariant/1", locationId: "gid://shopify/Location/1", delta: 10 }], reason: "received" },
  "shopify.inventory.item_update": { inventoryItemId: "gid://shopify/InventoryItem/1", tracked: true },
  "shopify.inventory.activate": { inventoryItemId: "gid://shopify/InventoryItem/1", locationId: "gid://shopify/Location/2", available: 0 },
  "shopify.inventory.audit": { lowStockThreshold: 5 },
  "shopify.markets.list": {},
  "shopify.markets.get": { id: "gid://shopify/Market/1" },
  "shopify.markets.create": { name: "Europe", regions: ["DE", "FR", "NL"], baseCurrency: "EUR" },
  "shopify.markets.update": { id: "gid://shopify/Market/2", status: "ACTIVE" },
  "shopify.markets.delete": { id: "gid://shopify/Market/2", confirm: true },
  "shopify.locales.list": {},
  "shopify.locales.enable": { locale: "fr" },
  "shopify.locales.publish": { locale: "fr", published: true },
  "shopify.locales.disable": { locale: "fr", confirm: true },
  "shopify.translations.get": { resourceId: "gid://shopify/Product/1", locale: "fr" },
  "shopify.translations.list": { resourceType: "PRODUCT", locale: "fr" },
  "shopify.translations.register": { resourceId: "gid://shopify/Product/1", locale: "fr", translations: [{ key: "title", value: "Planche à neige" }] },
  "shopify.translations.remove": { resourceId: "gid://shopify/Product/1", locales: ["fr"], keys: ["title"] },
  "shopify.translations.audit": { locales: ["fr"] },
  "shopify.catalogs.list": {},
  "shopify.catalogs.create": { title: "EU catalog", marketIds: ["gid://shopify/Market/2"] },
  "shopify.catalogs.update": { id: "gid://shopify/MarketCatalog/1", status: "ACTIVE" },
  "shopify.catalogs.delete": { id: "gid://shopify/MarketCatalog/1", confirm: true },
  "shopify.price_lists.list": {},
  "shopify.price_lists.prices": { id: "gid://shopify/PriceList/1" },
  "shopify.price_lists.create": { name: "EU +10%", currency: "EUR", adjustmentType: "PERCENTAGE_INCREASE", adjustmentValue: 10, catalogId: "gid://shopify/MarketCatalog/1" },
  "shopify.price_lists.delete": { id: "gid://shopify/PriceList/1", confirm: true },
  "shopify.price_lists.set_prices": { priceListId: "gid://shopify/PriceList/1", prices: [{ variantId: "gid://shopify/ProductVariant/1", amount: "89.00" }] },
  "shopify.price_lists.remove_prices": { priceListId: "gid://shopify/PriceList/1", variantIds: ["gid://shopify/ProductVariant/1"] },
  "shopify.discounts.list": { query: "status:active" },
  "shopify.discounts.get": { id: "gid://shopify/DiscountCodeNode/1" },
  "shopify.discounts.create_code": { title: "Spring 20", code: "SPRING20", percentage: 20, minimumSubtotal: "50.00", endsAt: "2026-12-31T23:59:59Z" },
  "shopify.discounts.create_automatic": { title: "Bundle 10% off", percentage: 10, collectionIds: ["gid://shopify/Collection/1"] },
  "shopify.discounts.create_free_shipping": { title: "Free shipping over 75", code: "FREESHIP", minimumSubtotal: "75.00" },
  "shopify.discounts.activate": { id: "gid://shopify/DiscountCodeNode/1" },
  "shopify.discounts.deactivate": { id: "gid://shopify/DiscountCodeNode/1" },
  "shopify.discounts.delete": { id: "gid://shopify/DiscountCodeNode/1", confirm: true },
  "shopify.orders.list": { query: "fulfillment_status:unfulfilled", first: 20 },
  "shopify.orders.get": { id: "gid://shopify/Order/1" },
  "shopify.orders.update": { id: "gid://shopify/Order/1", addTags: ["priority"], note: "Ship today" },
  "shopify.orders.close": { id: "gid://shopify/Order/1" },
  "shopify.orders.cancel": { id: "gid://shopify/Order/1", reason: "CUSTOMER", refund: true, restock: true, confirm: true },
  "shopify.draft_orders.list": { query: "status:open" },
  "shopify.draft_orders.create": { lineItems: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 2 }], email: "buyer@example.com", tags: ["wholesale"] },
  "shopify.draft_orders.update": { id: "gid://shopify/DraftOrder/1", note: "Net 30" },
  "shopify.draft_orders.complete": { id: "gid://shopify/DraftOrder/1", paymentPending: true, confirm: true },
  "shopify.draft_orders.delete": { id: "gid://shopify/DraftOrder/1", confirm: true },
  "shopify.draft_orders.send_invoice": { id: "gid://shopify/DraftOrder/1", confirm: true },
  "shopify.fulfillment.create": { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1", tracking: { number: "1Z999", company: "UPS" }, notifyCustomer: true, confirm: true },
  "shopify.returns.list": { orderId: "gid://shopify/Order/1" },
  "shopify.returns.create": { orderId: "gid://shopify/Order/1", lineItems: [{ fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/1", quantity: 1, returnReason: "SIZE_TOO_SMALL" }], confirm: true },
  "shopify.customers.list": { query: "tag:vip" },
  "shopify.customers.get": { id: "gid://shopify/Customer/1" },
  "shopify.customers.update": { id: "gid://shopify/Customer/1", addTags: ["newsletter"] },
  "shopify.customers.create": { email: "new@example.com", firstName: "Ada", tags: ["wholesale"] },
};
type Opts = { name: string; category: ToolCategory; riskClass: RiskClass; scopes: string[]; protected?: boolean; rollback?: "none" | "inverse_operation" | "ledger_before_image"; dryRun?: boolean; plan?: "plus" | "advanced" };
function base(o: Opts) {
  const write = o.riskClass !== "read";
  return {
    tier: "pro" as const,
    category: o.category,
    riskClass: o.riskClass,
    executionPlane: "shopify_admin" as const,
    requiredEntitlements: [] as never[],
    requiredShopifyScopes: o.scopes,
    requiredStoreCapabilities: (write ? ["admin.write"] : ["admin.read"]) as ["admin.write"] | ["admin.read"],
    taskMode: "sync" as const,
    approval: "none" as const,
    supportsDryRun: o.dryRun ?? write,
    rollback: (o.rollback ?? "none") as "none" | "inverse_operation" | "ledger_before_image",
    protectedCustomerData: o.protected ?? false,
    planRequirement: o.plan,
    dataCategories: { reads: [] as string[], writes: [] as string[], stores: [] as string[], returnsToClient: [] as string[] },
    docs: { examples: [{ title: "Example", input: EXAMPLES[o.name] ?? {} }], failureModes: [{ code: "SCOPE_MISSING", meaning: "The app was installed without this scope; reconnect with the scope set in shopify.auth.connect." }], limitations: [] as string[] },
  };
}

// ---------------------------------------------------------------------------
// Locations + inventory
// ---------------------------------------------------------------------------
export const locationsListTool: ToolDefinition = defineTool({
  name: "shopify.locations.list",
  description: "Lists the shop's locations (warehouses, retail stores, apps that stock inventory) with active/fulfils-online-orders flags. Needed for every inventory write.",
  ...base({ name: "shopify.locations.list", category: "inventory", riskClass: "read", scopes: ["read_locations"] }),
  inputSchema: z.object({ ...pagination, includeInactive: z.boolean().optional() }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await listLocations(requireAdmin(ctx.admin), input);
    return ok({ operationId: ctx.operationId }, locationsListTool, { summary: `${page.items.length} location(s)`, data: page });
  },
});

export const inventoryGetTool: ToolDefinition = defineTool({
  name: "shopify.inventory.get",
  aliases: ["shopify.inventory.levels"],
  description: "Inventory per variant per location for one product: available, on_hand, committed (and any other named quantity you ask for), plus the inventoryItemId and tracked flag the write tools need.",
  ...base({ name: "shopify.inventory.get", category: "inventory", riskClass: "read", scopes: ["read_inventory", "read_products"] }),
  inputSchema: z.object({ productId: z.string(), names: z.array(z.enum(INVENTORY_QUANTITY_NAMES)).optional() }),
  outputSchema: z.object({ productId: z.string(), title: z.string(), rows: z.array(z.unknown()) }),
  handler: async (ctx, input) => {
    let data: Awaited<ReturnType<typeof getProductInventory>>;
    try { data = await getProductInventory(requireAdmin(ctx.admin), input.productId, input.names); } catch (e) { if (e instanceof ProductNotFoundError) return notFound(ctx, inventoryGetTool, `Product ${input.productId}`); throw e; }
    return ok({ operationId: ctx.operationId }, inventoryGetTool, { summary: `${data.rows.length} inventory level(s) for "${data.title}"`, data });
  },
});

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------
export const marketsListTool: ToolDefinition = defineTool({
  name: "shopify.markets.list",
  description: "Lists Shopify Markets: regions (country codes), status, base currency / local currencies, web presences (domain or subfolder, default + alternate locales, root URLs) and linked catalogs.",
  ...base({ name: "shopify.markets.list", category: "markets", riskClass: "read", scopes: ["read_markets"] }),
  inputSchema: z.object({ ...pagination, query: z.string().optional() }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await listMarkets(requireAdmin(ctx.admin), input);
    return ok({ operationId: ctx.operationId }, marketsListTool, { summary: `${page.items.length} market(s)`, data: page });
  },
});
export const marketsGetTool: ToolDefinition = defineTool({
  name: "shopify.markets.get",
  description: "Reads one market with regions, currency settings, web presences and catalogs.",
  ...base({ name: "shopify.markets.get", category: "markets", riskClass: "read", scopes: ["read_markets"] }),
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ market: z.unknown() }),
  handler: async (ctx, input) => {
    const market = await getMarket(requireAdmin(ctx.admin), input.id);
    if (!market) return notFound(ctx, marketsGetTool, `Market ${input.id}`);
    return ok({ operationId: ctx.operationId }, marketsGetTool, { summary: `${market.name} (${market.regions.join(", ") || "no regions"})`, data: { market } });
  },
});

// ---------------------------------------------------------------------------
// Locales + translations
// ---------------------------------------------------------------------------
export const localesListTool: ToolDefinition = defineTool({
  name: "shopify.locales.list",
  description: "Lists shop locales (languages): primary, enabled, published. A locale must be enabled before translations register and published before buyers see it.",
  ...base({ name: "shopify.locales.list", category: "translations", riskClass: "read", scopes: ["read_locales"] }),
  inputSchema: z.object({}),
  outputSchema: z.object({ locales: z.array(z.unknown()) }),
  handler: async (ctx) => {
    const locales = await listShopLocales(requireAdmin(ctx.admin));
    return ok({ operationId: ctx.operationId }, localesListTool, { summary: `${locales.length} locale(s): ${locales.map((l) => `${l.locale}${l.primary ? "*" : ""}${l.published ? "" : " (unpublished)"}`).join(", ")}`, data: { locales } });
  },
});

export const translationsGetTool: ToolDefinition = defineTool({
  name: "shopify.translations.get",
  description: "Reads the translatable content of one resource (product, collection, page, article, menu, metafield, shop, theme…): keys, source values, digests (needed to register), and the existing translations for a locale (optionally market-scoped).",
  ...base({ name: "shopify.translations.get", category: "translations", riskClass: "read", scopes: ["read_translations"] }),
  inputSchema: z.object({ resourceId: z.string(), locale: z.string().optional(), marketId: z.string().optional() }),
  outputSchema: z.object({ resource: z.unknown() }),
  handler: async (ctx, input) => {
    const resource = await getTranslatableResource(requireAdmin(ctx.admin), input.resourceId, input.locale, input.marketId);
    if (!resource) return notFound(ctx, translationsGetTool, `Translatable resource ${input.resourceId}`);
    return ok({ operationId: ctx.operationId }, translationsGetTool, { summary: `${resource.content.length} translatable key(s), ${resource.translations.length} translated${input.locale ? ` in ${input.locale}` : ""}`, data: { resource } });
  },
});
export const translationsListTool: ToolDefinition = defineTool({
  name: "shopify.translations.list",
  description: "Lists translatable resources of one type (PRODUCT, COLLECTION, PAGE, ARTICLE, BLOG, MENU, ONLINE_STORE_THEME, METAFIELD, METAOBJECT, SHOP, …) with their content digests and, when a locale is given, what is already translated.",
  ...base({ name: "shopify.translations.list", category: "translations", riskClass: "read", scopes: ["read_translations"] }),
  inputSchema: z.object({ resourceType: z.enum(TRANSLATABLE_RESOURCE_TYPES), locale: z.string().optional(), ...pagination }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await listTranslatableResources(requireAdmin(ctx.admin), input.resourceType, input);
    return ok({ operationId: ctx.operationId }, translationsListTool, { summary: `${page.items.length} ${input.resourceType} resource(s)`, data: page });
  },
});

// ---------------------------------------------------------------------------
// Catalogs + price lists
// ---------------------------------------------------------------------------
export const catalogsListTool: ToolDefinition = defineTool({
  name: "shopify.catalogs.list",
  description: "Lists catalogs (market, B2B company-location or app catalogs) with status, linked price list, publication and markets.",
  ...base({ name: "shopify.catalogs.list", category: "markets", riskClass: "read", scopes: ["read_products", "read_markets"] }),
  inputSchema: z.object({ ...pagination, query: z.string().optional(), type: z.enum(["MARKET", "COMPANY_LOCATION", "APP"]).optional() }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await listCatalogs(requireAdmin(ctx.admin), input);
    return ok({ operationId: ctx.operationId }, catalogsListTool, { summary: `${page.items.length} catalog(s)`, data: page });
  },
});

export const priceListsListTool: ToolDefinition = defineTool({
  name: "shopify.price_lists.list",
  description: "Lists price lists: currency, parent adjustment (percentage increase/decrease over base prices), catalog and count of fixed prices.",
  ...base({ name: "shopify.price_lists.list", category: "markets", riskClass: "read", scopes: ["read_products"] }),
  inputSchema: z.object({ ...pagination }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await listPriceLists(requireAdmin(ctx.admin), input);
    return ok({ operationId: ctx.operationId }, priceListsListTool, { summary: `${page.items.length} price list(s)`, data: page });
  },
});
export const priceListsPricesTool: ToolDefinition = defineTool({
  name: "shopify.price_lists.prices",
  description: "Lists the prices in a price list (fixed and adjusted) per variant.",
  ...base({ name: "shopify.price_lists.prices", category: "markets", riskClass: "read", scopes: ["read_products"] }),
  inputSchema: z.object({ id: z.string(), ...pagination }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await getPriceListPrices(requireAdmin(ctx.admin), input.id, input);
    return ok({ operationId: ctx.operationId }, priceListsPricesTool, { summary: `${page.items.length} price(s)`, data: page });
  },
});

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------
export const discountsListTool: ToolDefinition = defineTool({
  name: "shopify.discounts.list",
  description: "Lists code and automatic discounts (basic amount-off, buy-X-get-Y, free shipping, app/Functions discounts) with status, schedule, usage, codes and combination rules. Shopify search syntax in `query` (status:active, discount_type:percentage, title:…).",
  ...base({ name: "shopify.discounts.list", category: "discounts", riskClass: "read", scopes: ["read_discounts"] }),
  inputSchema: z.object({ ...pagination, query: z.string().optional() }),
  outputSchema: pageOut,
  handler: async (ctx, input) => {
    const page = await listDiscounts(requireAdmin(ctx.admin), input);
    return ok({ operationId: ctx.operationId }, discountsListTool, { summary: `${page.items.length} discount(s)`, data: page });
  },
});
export const discountsGetTool: ToolDefinition = defineTool({
  name: "shopify.discounts.get",
  description: "Reads one discount node (code or automatic).",
  ...base({ name: "shopify.discounts.get", category: "discounts", riskClass: "read", scopes: ["read_discounts"] }),
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ discount: z.unknown() }),
  handler: async (ctx, input) => {
    const discount = await getDiscount(requireAdmin(ctx.admin), input.id);
    if (!discount) return notFound(ctx, discountsGetTool, `Discount ${input.id}`);
    return ok({ operationId: ctx.operationId }, discountsGetTool, { summary: `${discount.title} (${discount.method}, ${discount.status})`, data: { discount } });
  },
});

export const COMMERCE_OPS_TOOLS: ToolDefinition[] = [
  locationsListTool,
  inventoryGetTool,
  marketsListTool,
  marketsGetTool,
  localesListTool,
  translationsGetTool,
  translationsListTool,
  catalogsListTool,
  priceListsListTool,
  priceListsPricesTool,
  discountsListTool,
  discountsGetTool,
];

export function registerCommerceOpsTools(registry: ToolRegistry): void {
  for (const t of COMMERCE_OPS_TOOLS) registry.register(t);
}
