/**
 * ShopifyApiVersionManager: one place that knows, per Admin API capability we
 * depend on, the minimum version, replacement/deprecation, required scopes,
 * protected-customer-data status, plan gating and preview status.
 *
 * Every entry carries `verified`: "live" = exercised against a real store by our
 * sweeps; "docs" = taken from current Shopify developer documentation but not yet
 * exercised. Tools consult this before calling Shopify so a missing scope, an
 * unsupported version or a plan limit becomes a useful MCP error instead of a
 * GraphQL failure.
 */
import { ShopifyApiVersionService } from "./version.js";

export type Verification = "live" | "docs";

export interface ApiCapability {
  /** Stable key, e.g. "themeFilesUpsert". */
  name: string;
  kind: "mutation" | "query" | "feature";
  /** Short description of what it does and where we use it. */
  description: string;
  /** First quarterly version the capability exists in. */
  minVersion: string;
  /** Version in which it was deprecated, if any. */
  deprecatedIn?: string;
  /** What replaced it, if deprecated. */
  replacedBy?: string;
  requiredScopes: string[];
  /** Touches protected customer data (Shopify Protected Customer Data policy; public apps need approval). */
  protectedCustomerData?: boolean;
  /** Plan gate, when Shopify restricts the feature to a plan. */
  planRequirement?: "plus" | "advanced";
  /** Public-app distribution needs a protected-scope exemption for this. */
  exemptionRequired?: boolean;
  preview?: boolean;
  verified: Verification;
  notes?: string;
}

export const API_CAPABILITIES: readonly ApiCapability[] = [
  { name: "themeFilesUpsert", kind: "mutation", description: "Write theme files (engine B).", minVersion: "2024-10", requiredScopes: ["write_themes"], exemptionRequired: true, verified: "live", notes: "Custom-distribution apps work without exemption (verified); App Store apps need the Online Store protected-scope exemption." },
  { name: "themeFilesDelete", kind: "mutation", description: "Delete theme files.", minVersion: "2024-10", requiredScopes: ["write_themes"], exemptionRequired: true, verified: "live" },
  { name: "themeDuplicate", kind: "mutation", description: "Copy a theme (working theme model).", minVersion: "2024-10", requiredScopes: ["write_themes"], verified: "live", notes: "Async: poll `processing` before reading files." },
  { name: "themePublish", kind: "mutation", description: "Make a theme live.", minVersion: "2024-10", requiredScopes: ["write_themes"], verified: "live" },
  { name: "themeCreate", kind: "mutation", description: "Create a theme from a zip URL.", minVersion: "2024-10", requiredScopes: ["write_themes"], verified: "docs" },
  { name: "productSet", kind: "mutation", description: "Upsert a product with variants/options in one call.", minVersion: "2024-10", requiredScopes: ["write_products"], verified: "docs", notes: "Preferred over productCreate + productVariantsBulkCreate for full-product writes." },
  { name: "productCreate", kind: "mutation", description: "Create a product.", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "productUpdate", kind: "mutation", description: "Update product fields incl. seo.", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "productVariantsBulkUpdate", kind: "mutation", description: "Update variants (price, sku, barcode).", minVersion: "2024-04", requiredScopes: ["write_products"], verified: "live", notes: "productVariantUpdate was removed in 2024-04." },
  { name: "productDelete", kind: "mutation", description: "Delete a product (used by ledger rollback of a create).", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "collectionCreate", kind: "mutation", description: "Create a manual/smart collection.", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "collectionAddProductsV2", kind: "mutation", description: "Add products to a manual collection (async job).", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "pageCreate", kind: "mutation", description: "Create an Online Store page. SEO lives in global.title_tag / description_tag metafields, not a seo field.", minVersion: "2024-07", requiredScopes: ["write_content"], verified: "live" },
  { name: "articleCreate", kind: "mutation", description: "Create a blog article; `author` is required.", minVersion: "2024-07", requiredScopes: ["write_content"], verified: "live" },
  { name: "menuUpdate", kind: "mutation", description: "Replace a menu's item tree; title and handle are required.", minVersion: "2024-01", requiredScopes: ["write_online_store_navigation"], verified: "live" },
  { name: "metafieldsSet", kind: "mutation", description: "Set metafields on any owner.", minVersion: "2024-01", requiredScopes: [], verified: "live", notes: "Needs the OWNER resource's write scope (write_products for product metafields, write_content for pages, …), not a separate metafields scope; verified live with write_products only." },
  { name: "metaobjectUpsert", kind: "mutation", description: "Create or update a metaobject by handle.", minVersion: "2024-01", requiredScopes: ["write_metaobjects"], verified: "live" },
  { name: "urlRedirectCreate", kind: "mutation", description: "Create a URL redirect.", minVersion: "2024-01", requiredScopes: ["write_online_store_navigation"], verified: "live" },
  { name: "fileCreate", kind: "mutation", description: "Upload files/media via staged uploads.", minVersion: "2024-01", requiredScopes: ["write_files"], verified: "live" },
  { name: "bulkOperationRunMutation", kind: "mutation", description: "Run a mutation over a JSONL of inputs (bulk SEO, alt text).", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "webhookSubscriptionCreate", kind: "mutation", description: "Register webhooks (incl. GDPR compliance topics).", minVersion: "2024-01", requiredScopes: [], verified: "live" },
  { name: "translationsRegister", kind: "mutation", description: "Register translations for a resource + locale (Markets/translations layer, Phase 5).", minVersion: "2024-01", requiredScopes: ["write_translations"], verified: "live" },
  { name: "marketCreate", kind: "mutation", description: "Create a Market (Phase 5).", minVersion: "2024-10", requiredScopes: ["write_markets"], verified: "live", notes: "Market limits vary by plan; verify `shop.features` before promising." },
  { name: "inventoryAdjustQuantities", kind: "mutation", description: "Adjust inventory at a location (Phase 5, FINANCIAL_IMPACT).", minVersion: "2024-01", requiredScopes: ["write_inventory"], verified: "live" },
  { name: "discountCodeBasicCreate", kind: "mutation", description: "Create a basic code discount (Phase 5).", minVersion: "2024-01", requiredScopes: ["write_discounts"], verified: "docs" },
  { name: "orders", kind: "query", description: "Read orders (Phase 5). Protected customer data; only the last 60 days without read_all_orders.", minVersion: "2024-01", requiredScopes: ["read_orders"], protectedCustomerData: true, verified: "live" },
  { name: "customers", kind: "query", description: "Read customers (Phase 5). Protected customer data.", minVersion: "2024-01", requiredScopes: ["read_customers"], protectedCustomerData: true, verified: "live" },
  { name: "draftOrderCreate", kind: "mutation", description: "Create a draft order (Phase 5, FINANCIAL_IMPACT).", minVersion: "2024-01", requiredScopes: ["write_draft_orders"], protectedCustomerData: true, verified: "live" },
  { name: "shopifyqlQuery", kind: "query", description: "ShopifyQL analytics queries (Phase 6).", minVersion: "2024-01", requiredScopes: ["read_reports"], verified: "docs", preview: true, notes: "Availability and plan gating must be re-verified against current docs before Phase 6; treat as preview." },
  { name: "webPixelCreate", kind: "mutation", description: "Register an app web pixel (Phase 6).", minVersion: "2024-01", requiredScopes: ["write_pixels"], verified: "live" },
  { name: "checkoutBranding", kind: "feature", description: "Checkout branding/customisation API (Phase 6).", minVersion: "2024-01", requiredScopes: ["write_checkout_branding_settings"], planRequirement: "plus", verified: "docs" },
  { name: "checkoutUiExtensions", kind: "feature", description: "Checkout UI extensions (Phase 6). Information/shipping/payment targets require Shopify Plus; Thank-you/Order-status targets do not.", minVersion: "2024-01", requiredScopes: [], planRequirement: "plus", verified: "docs" },
  { name: "shopifyFunctions", kind: "feature", description: "Shopify Functions (discounts, delivery/payment customisation, cart transform, validation). Deployed with Shopify CLI, not the Admin API.", minVersion: "2024-01", requiredScopes: [], verified: "docs", notes: "Deployment needs CLI + Partners auth; the MCP can scaffold/validate/test locally." },
  { name: "themeAppExtensions", kind: "feature", description: "Theme app extensions (app blocks/embeds) for App Store distribution.", minVersion: "2024-01", requiredScopes: [], verified: "docs", notes: "Deployed with Shopify CLI." },
  { name: "storefrontMcp", kind: "feature", description: "Buyer-facing Storefront MCP / agentic storefront (Hydrogen, Phase 3).", minVersion: "2025-07", requiredScopes: [], preview: true, verified: "docs", notes: "Separate from this merchant MCP; never exposes admin capabilities." },
  // ---- Phase 5 commerce ops (researched 2026-09-10 against 2026-07 docs) ----
  { name: "inventorySetQuantities", kind: "mutation", description: "Absolute inventory quantities.", minVersion: "2024-07", requiredScopes: ["write_inventory"], verified: "live", notes: "2026-07: no ignoreCompareQuantity / compareQuantity fields (verified live 2026-09-12); @idempotent(key:) directive attached." },
  { name: "inventoryAdjustQuantities", kind: "mutation", description: "Relative inventory adjustments with audit reason.", minVersion: "2024-01", requiredScopes: ["write_inventory"], verified: "docs", notes: "@idempotent required since 2026-04." },
  { name: "inventoryItemUpdate", kind: "mutation", description: "Tracked flag, SKU, cost, HS code.", minVersion: "2024-01", requiredScopes: ["write_inventory"], verified: "docs" },
  { name: "locations", kind: "query", description: "Locations for inventory writes.", minVersion: "2024-01", requiredScopes: ["read_locations"], verified: "docs" },
  { name: "marketCreate", kind: "mutation", description: "Region markets with conditions.regionsCondition, currencySettings.", minVersion: "2025-01", requiredScopes: ["write_markets"], verified: "docs", notes: "Unified Markets API (2025+): status ACTIVE/DRAFT, conditions instead of marketRegionsCreate; B2B/POS market types in developer preview." },
  { name: "markets", kind: "query", description: "Markets with regions, currency, web presences, catalogs.", minVersion: "2025-01", requiredScopes: ["read_markets"], verified: "live" },
  { name: "shopLocaleEnable", kind: "mutation", description: "Enable a locale (starts unpublished, max 20).", minVersion: "2024-01", requiredScopes: ["write_locales"], verified: "live" },
  { name: "shopLocales", kind: "query", description: "Enabled locales.", minVersion: "2024-01", requiredScopes: ["read_locales"], verified: "live" },
  { name: "translationsRegister", kind: "mutation", description: "Register translations; needs translatableContentDigest per key, optional marketId.", minVersion: "2024-01", requiredScopes: ["write_translations"], verified: "docs" },
  { name: "translatableResources", kind: "query", description: "Translatable content + digests per resource type.", minVersion: "2024-01", requiredScopes: ["read_translations"], verified: "live" },
  { name: "catalogs", kind: "query", description: "Catalogs by type (market / company location / app).", minVersion: "2024-01", requiredScopes: ["read_products", "read_markets"], verified: "live" },
  { name: "catalogCreate", kind: "mutation", description: "Market / company-location catalogs with price list + publication.", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live", notes: "Docs list write_products plus catalog permission; market catalogs also need read/write_markets for the market context." },
  { name: "priceListCreate", kind: "mutation", description: "Price list with parent adjustment; fixed prices via priceListFixedPricesAdd.", minVersion: "2024-01", requiredScopes: ["write_products"], verified: "live" },
  { name: "discountCodeBasicCreate", kind: "mutation", description: "Amount-off code discount.", minVersion: "2024-01", requiredScopes: ["write_discounts"], verified: "live", notes: "codeDiscountNode.codeDiscount is the DiscountCode union: only DiscountCode* fragments may be spread (verified live 2026-09-12)." },
  { name: "discountAutomaticBasicCreate", kind: "mutation", description: "Amount-off automatic discount.", minVersion: "2024-01", requiredScopes: ["write_discounts"], verified: "live" },
  { name: "discountNodes", kind: "query", description: "All discounts (codeDiscountNodes is deprecated).", minVersion: "2024-01", requiredScopes: ["read_discounts"], verified: "live" },
  { name: "orders", kind: "query", description: "Orders (60-day window without read_all_orders).", minVersion: "2024-01", requiredScopes: ["read_orders"], protectedCustomerData: true, verified: "docs", notes: "read_all_orders needs Partner Dashboard approval." },
  { name: "orderUpdate", kind: "mutation", description: "Note/tags/email on an order.", minVersion: "2024-01", requiredScopes: ["write_orders"], protectedCustomerData: true, verified: "live" },
  { name: "orderCancel", kind: "mutation", description: "Cancel with reason/refund/restock; async job.", minVersion: "2024-04", requiredScopes: ["write_orders"], protectedCustomerData: true, verified: "live" },
  { name: "draftOrderCreate", kind: "mutation", description: "Draft orders; complete with draftOrderComplete.", minVersion: "2024-01", requiredScopes: ["write_draft_orders"], protectedCustomerData: true, verified: "docs" },
  { name: "fulfillmentCreate", kind: "mutation", description: "Fulfil fulfillment-order line items with tracking.", minVersion: "2024-07", requiredScopes: ["write_merchant_managed_fulfillment_orders"], protectedCustomerData: true, verified: "live", notes: "fulfillmentCreateV2 removed; fulfillmentCreate(fulfillment:, message:) is current." },
  { name: "returnCreate", kind: "mutation", description: "Open a return (assumes request approved).", minVersion: "2024-01", requiredScopes: ["write_returns"], protectedCustomerData: true, verified: "docs" },
  { name: "customers", kind: "query", description: "Customers with defaultEmailAddress/defaultPhoneNumber (email/phone fields deprecated).", minVersion: "2024-01", requiredScopes: ["read_customers"], protectedCustomerData: true, verified: "docs" },
  { name: "customerUpdate", kind: "mutation", description: "Tags/note/name on a customer.", minVersion: "2024-01", requiredScopes: ["write_customers"], protectedCustomerData: true, verified: "live" },

  // ---- Phase 6 advanced (researched 2026-09-11 against 2026-07 docs) ----
  { name: "webhookSubscriptionCreate", kind: "mutation", description: "Subscribe to a topic at an HTTPS/PubSub/EventBridge uri (input uses uri, not callbackUrl).", minVersion: "2024-01", requiredScopes: [], verified: "live", notes: "Topic scope follows the resource (orders/* needs read_orders); delivery API version follows the app config." },
  { name: "webhookSubscriptions", kind: "query", description: "Subscriptions created by this app.", minVersion: "2024-01", requiredScopes: [], verified: "live" },
  { name: "webPixelCreate", kind: "mutation", description: "Activate this app's web pixel extension with settings JSON.", minVersion: "2024-01", requiredScopes: ["write_pixels", "read_customer_events"], verified: "docs", notes: "One pixel per app; settings validated against the extension toml (INVALID_SETTINGS)." },
  { name: "scriptTags", kind: "query", description: "Legacy ScriptTags (deprecated; stop loading 2027-03-01).", minVersion: "2024-01", requiredScopes: ["read_script_tags"], deprecatedIn: "2025-01", replacedBy: "web pixels / app embeds", verified: "live" },
  { name: "shopifyqlQuery", kind: "query", description: "ShopifyQL analytics (FROM sales|products SHOW ...).", minVersion: "2024-01", requiredScopes: ["read_reports"], protectedCustomerData: true, verified: "live", notes: "Response { tableData { columns rowData } parseErrors: [String] } (verified live 2026-09-12); returns fields renamed to sales_reversals_* in 2026-04." },
  { name: "shopifyFunctions", kind: "query", description: "Functions deployed by this app.", minVersion: "2024-01", requiredScopes: [], verified: "live" },
  { name: "discountAutomaticAppCreate", kind: "mutation", description: "Attach a discount Function (functionId + function-configuration metafield).", minVersion: "2024-01", requiredScopes: ["write_discounts"], verified: "docs" },
  { name: "cartTransformCreate", kind: "mutation", description: "Attach a cart transform Function.", minVersion: "2024-01", requiredScopes: [], verified: "docs", notes: "update operations need Plus or a dev store." },
  { name: "validationCreate", kind: "mutation", description: "Attach a cart/checkout validation Function.", minVersion: "2024-01", requiredScopes: [], verified: "docs" },
  { name: "checkoutProfiles", kind: "query", description: "Checkout profiles (published/draft).", minVersion: "2024-01", requiredScopes: ["read_checkout_branding_settings"], deprecatedIn: "2026-01", replacedBy: "checkoutAndAccountsConfigurations", verified: "live", notes: "checkout.liquid removed for information/shipping/payment 2024-08-13 and thank-you/order-status 2025-08-28." },
  { name: "flowTriggerReceive", kind: "mutation", description: "Fire a deployed flow_trigger of this app.", minVersion: "2024-01", requiredScopes: [], verified: "docs", notes: "Payload < 50000 bytes; reference keys customer_id/order_id/product_id/company_id." },
  { name: "currentAppInstallation", kind: "query", description: "Granted scopes + subscriptions for diagnostics.", minVersion: "2024-01", requiredScopes: [], verified: "live" },

];

export interface CapabilityCheck {
  capability: ApiCapability;
  available: boolean;
  reasons: string[];
  missingScopes: string[];
}

export interface StoreFacts {
  /** Shopify plan display name or handle, when known (e.g. "Shopify Plus", "basic"). */
  plan?: string;
  /** Granted access scopes. */
  scopesGranted?: Iterable<string>;
  /** Whether the app is approved for protected customer data (public apps) or is custom/private (implicitly allowed). */
  protectedCustomerDataApproved?: boolean;
  /** Public App Store distribution vs custom/private install. */
  distribution?: "custom" | "public";
}

export function isPlusPlan(plan?: string): boolean {
  return !!plan && /plus/i.test(plan);
}

export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Extends the version service with the capability table. */
export class ShopifyApiVersionManager extends ShopifyApiVersionService {
  capability(name: string): ApiCapability | undefined {
    return API_CAPABILITIES.find((c) => c.name === name);
  }

  list(): readonly ApiCapability[] {
    return API_CAPABILITIES;
  }

  /** Capabilities deprecated at or before the configured version. */
  deprecations(version = this.current()): ApiCapability[] {
    return API_CAPABILITIES.filter((c) => c.deprecatedIn && compareVersions(c.deprecatedIn, version) <= 0);
  }

  /** Checks a capability against the configured version and the store's facts. */
  check(name: string, facts: StoreFacts = {}): CapabilityCheck {
    const capability = this.capability(name);
    if (!capability) return { capability: { name, kind: "feature", description: "unknown", minVersion: "0000-01", requiredScopes: [], verified: "docs" }, available: false, reasons: [`Unknown capability "${name}".`], missingScopes: [] };
    const reasons: string[] = [];
    const version = this.current();
    if (compareVersions(version, capability.minVersion) < 0) reasons.push(`Requires Shopify API version ${capability.minVersion} or later; the server is configured for ${version}. Set SHOPIFY_API_VERSION.`);
    if (capability.deprecatedIn && compareVersions(version, capability.deprecatedIn) >= 0) reasons.push(`Deprecated in ${capability.deprecatedIn}${capability.replacedBy ? `; use ${capability.replacedBy}` : ""}.`);
    const granted = new Set(facts.scopesGranted ?? []);
    const missingScopes = capability.requiredScopes.filter((s) => !granted.has(s) && !(s.startsWith("read_") && granted.has(`write_${s.slice(5)}`)));
    if (facts.scopesGranted && missingScopes.length) reasons.push(`Missing access scope(s): ${missingScopes.join(", ")}.`);
    if (capability.planRequirement === "plus" && facts.plan !== undefined && !isPlusPlan(facts.plan)) reasons.push(`Requires Shopify Plus; the connected store is on "${facts.plan}".`);
    if (capability.protectedCustomerData && facts.distribution === "public" && facts.protectedCustomerDataApproved === false) reasons.push("Touches protected customer data; this public app is not yet approved for it.");
    if (capability.exemptionRequired && facts.distribution === "public") reasons.push("Public (App Store) distribution needs the Online Store protected-scope exemption for theme writes.");
    return { capability, available: reasons.length === 0, reasons, missingScopes };
  }
}
