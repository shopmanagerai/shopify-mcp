/**
 * Phase 5 commerce operations: inventory/locations, markets, locales +
 * translations, catalogs + price lists, discounts, orders/draft orders,
 * fulfillment, returns, customers. Shapes follow the Admin GraphQL API 2026-07
 * docs (researched 2026-09-10); every entry in API_CAPABILITIES records whether
 * it has been exercised live. Inventory mutations carry the `@idempotent` key
 * required since 2026-04.
 */
import { randomUUID } from "node:crypto";
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export interface Page<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor?: string;
}
type PageOpts = { first?: number; after?: string; query?: string };
const pageArgs = (o: PageOpts) => ({ first: o.first ?? 50, after: o.after, query: o.query });
function unwrap<T>(res: { data?: unknown; errors?: Array<{ message: string }> }, pick: (d: any) => T): T {
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
  return pick(res.data);
}
const conn = <T>(c: { edges?: Array<{ node: T; cursor?: string }>; nodes?: T[]; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } } | null | undefined): Page<T> => ({
  items: c?.nodes ?? c?.edges?.map((e) => e.node) ?? [],
  hasNextPage: c?.pageInfo?.hasNextPage ?? false,
  endCursor: c?.pageInfo?.endCursor ?? undefined,
});
const userErrors = (x: { userErrors?: UserError[] } | null | undefined): UserError[] => x?.userErrors ?? [];

// ---------------------------------------------------------------------------
// Locations + inventory
// ---------------------------------------------------------------------------
export interface Location {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders?: boolean;
  shipsInventory?: boolean;
  address?: { city?: string; country?: string; countryCode?: string };
}
export async function listLocations(client: AdminClient, opts: PageOpts & { includeInactive?: boolean } = {}): Promise<Page<Location>> {
  const res = await client.query(
    /* GraphQL */ `query LocationsList($first: Int!, $after: String, $query: String, $includeInactive: Boolean) {
      locations(first: $first, after: $after, query: $query, includeInactive: $includeInactive) {
        nodes { id name isActive fulfillsOnlineOrders shipsInventory address { city country countryCode } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { ...pageArgs(opts), includeInactive: opts.includeInactive ?? false },
  );
  return unwrap(res, (d) => conn<Location>(d.locations));
}

export interface InventoryLevelRow {
  variantId: string;
  variantTitle: string;
  sku?: string;
  inventoryItemId: string;
  tracked: boolean;
  locationId: string;
  locationName: string;
  quantities: Record<string, number>;
}
export const INVENTORY_QUANTITY_NAMES = ["available", "on_hand", "committed", "incoming", "reserved", "damaged", "safety_stock", "quality_control"] as const;
export class ProductNotFoundError extends Error { constructor(id: string) { super(`Product ${id} not found.`); this.name = "ProductNotFoundError"; } }
export async function getProductInventory(client: AdminClient, productId: string, names: readonly string[] = ["available", "on_hand", "committed"]): Promise<{ productId: string; title: string; rows: InventoryLevelRow[] }> {
  const res = await client.query(
    /* GraphQL */ `query ProductInventory($id: ID!, $names: [String!]!) {
      product(id: $id) {
        id title
        variants(first: 100) {
          nodes {
            id title sku
            inventoryItem { id tracked inventoryLevels(first: 50) { nodes { location { id name } quantities(names: $names) { name quantity } } } }
          }
        }
      }
    }`,
    { id: productId, names },
  );
  return unwrap(res, (d) => {
    const p = d.product;
    if (!p) throw new ProductNotFoundError(productId);
    const rows: InventoryLevelRow[] = [];
    for (const v of p.variants.nodes) for (const lvl of v.inventoryItem?.inventoryLevels?.nodes ?? []) rows.push({ variantId: v.id, variantTitle: v.title, sku: v.sku ?? undefined, inventoryItemId: v.inventoryItem.id, tracked: !!v.inventoryItem.tracked, locationId: lvl.location.id, locationName: lvl.location.name, quantities: Object.fromEntries((lvl.quantities ?? []).map((q: { name: string; quantity: number }) => [q.name, q.quantity])) });
    return { productId: p.id, title: p.title, rows };
  });
}

export interface InventoryQuantityInput {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  /** Required by 2026-07: the quantity you expect to be current; Shopify rejects the change if it differs (compare-and-set). */
  changeFromQuantity: number;
}
export type InventoryReason = "correction" | "cycle_count_available" | "damaged" | "movement_created" | "movement_updated" | "movement_received" | "movement_canceled" | "other" | "promotion" | "quality_control" | "received" | "reservation_created" | "reservation_deleted" | "reservation_updated" | "restock" | "safety_stock" | "shrinkage";
/** Live fact (2026-07, 2026-09-12): InventorySetQuantitiesInput has no ignoreCompareQuantity; InventoryQuantityInput requires changeFromQuantity (compare-and-set) and has no compareQuantity. */
export async function setInventoryQuantities(client: AdminClient, input: { name: "available" | "on_hand"; reason: InventoryReason; quantities: InventoryQuantityInput[]; ignoreCompareQuantity?: boolean; referenceDocumentUri?: string }, idempotencyKey = randomUUID()): Promise<{ groupId?: string; changes: Array<{ name: string; delta: number; quantityAfterChange?: number | null; item: string; location: string }>; userErrors: UserError[] }> {
  const res = await client.mutate(
    /* GraphQL */ `mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) @idempotent(key: "${idempotencyKey}") {
        inventoryAdjustmentGroup { id changes { name delta quantityAfterChange item { id } location { id } } }
        userErrors { field message }
      }
    }`,
    { input: { name: input.name, reason: input.reason, referenceDocumentUri: input.referenceDocumentUri, quantities: input.quantities.map((q) => ({ inventoryItemId: q.inventoryItemId, locationId: q.locationId, quantity: q.quantity, changeFromQuantity: q.changeFromQuantity })) } },
  );
  return unwrap(res, (d) => ({ groupId: d.inventorySetQuantities.inventoryAdjustmentGroup?.id, changes: (d.inventorySetQuantities.inventoryAdjustmentGroup?.changes ?? []).map((c: any) => ({ name: c.name, delta: c.delta, quantityAfterChange: c.quantityAfterChange, item: c.item?.id, location: c.location?.id })), userErrors: userErrors(d.inventorySetQuantities) }));
}
export async function adjustInventoryQuantities(client: AdminClient, input: { name: "available" | "on_hand"; reason: InventoryReason; changes: Array<{ inventoryItemId: string; locationId: string; delta: number; changeFromQuantity: number }>; referenceDocumentUri?: string }, idempotencyKey = randomUUID()): Promise<{ groupId?: string; changes: Array<{ name: string; delta: number; quantityAfterChange?: number | null; item: string; location: string }>; userErrors: UserError[] }> {
  const res = await client.mutate(
    /* GraphQL */ `mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) @idempotent(key: "${idempotencyKey}") {
        inventoryAdjustmentGroup { id changes { name delta quantityAfterChange item { id } location { id } } }
        userErrors { field message }
      }
    }`,
    { input },
  );
  return unwrap(res, (d) => ({ groupId: d.inventoryAdjustQuantities.inventoryAdjustmentGroup?.id, changes: (d.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes ?? []).map((c: any) => ({ name: c.name, delta: c.delta, quantityAfterChange: c.quantityAfterChange, item: c.item?.id, location: c.location?.id })), userErrors: userErrors(d.inventoryAdjustQuantities) }));
}
export async function updateInventoryItem(client: AdminClient, id: string, input: { tracked?: boolean; sku?: string; cost?: string; requiresShipping?: boolean; countryCodeOfOrigin?: string; harmonizedSystemCode?: string }): Promise<{ item?: { id: string; tracked: boolean; sku?: string; unitCost?: { amount: string } }; userErrors: UserError[] }> {
  const res = await client.mutate(
    /* GraphQL */ `mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) { inventoryItem { id tracked sku unitCost { amount } } userErrors { field message } }
    }`,
    { id, input },
  );
  return unwrap(res, (d) => ({ item: d.inventoryItemUpdate.inventoryItem ?? undefined, userErrors: userErrors(d.inventoryItemUpdate) }));
}
export async function activateInventory(client: AdminClient, inventoryItemId: string, locationId: string, available?: number, idempotencyKey = randomUUID()): Promise<{ level?: { id: string }; userErrors: UserError[] }> {
  const res = await client.mutate(
    /* GraphQL */ `mutation InventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: "${idempotencyKey}") { inventoryLevel { id } userErrors { field message } }
    }`,
    { inventoryItemId, locationId, available },
  );
  return unwrap(res, (d) => ({ level: d.inventoryActivate.inventoryLevel ?? undefined, userErrors: userErrors(d.inventoryActivate) }));
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------
export interface Market {
  id: string;
  name: string;
  handle: string;
  status?: string;
  enabled?: boolean;
  primary?: boolean;
  type?: string;
  regions: string[];
  currency?: { baseCurrency?: string; localCurrencies?: boolean };
  webPresences: Array<{ id: string; host?: string; defaultLocale?: string; alternateLocales: string[]; rootUrls: Array<{ locale: string; url: string }> }>;
  catalogIds: string[];
}
const MARKET_FIELDS = /* GraphQL */ `
  id name handle status primary type
  conditions { regionsCondition { regions(first: 250) { nodes { ... on MarketRegionCountry { code } } } } }
  currencySettings { baseCurrency { currencyCode } localCurrencies }
  webPresences(first: 10) { nodes { id domain { host } defaultLocale { locale } alternateLocales { locale } rootUrls { locale url } } }
  catalogs(first: 20) { nodes { id } }
`;
const toMarket = (m: any): Market => ({
  id: m.id,
  name: m.name,
  handle: m.handle,
  status: m.status,
  enabled: m.status ? m.status === "ACTIVE" : m.enabled,
  primary: m.primary,
  type: m.type,
  regions: (m.conditions?.regionsCondition?.regions?.nodes ?? []).map((r: any) => r.code).filter(Boolean),
  currency: m.currencySettings ? { baseCurrency: m.currencySettings.baseCurrency?.currencyCode, localCurrencies: m.currencySettings.localCurrencies } : undefined,
  webPresences: (m.webPresences?.nodes ?? []).map((w: any) => ({ id: w.id, host: w.domain?.host, defaultLocale: w.defaultLocale?.locale, alternateLocales: (w.alternateLocales ?? []).map((l: any) => l.locale), rootUrls: w.rootUrls ?? [] })),
  catalogIds: (m.catalogs?.nodes ?? []).map((c: any) => c.id),
});
export async function listMarkets(client: AdminClient, opts: PageOpts = {}): Promise<Page<Market>> {
  const res = await client.query(/* GraphQL */ `query MarketsList($first: Int!, $after: String, $query: String) { markets(first: $first, after: $after, query: $query) { nodes { ${MARKET_FIELDS} } pageInfo { hasNextPage endCursor } } }`, pageArgs(opts));
  return unwrap(res, (d) => { const p = conn<any>(d.markets); return { ...p, items: p.items.map(toMarket) }; });
}
export async function getMarket(client: AdminClient, id: string): Promise<Market | null> {
  const res = await client.query(/* GraphQL */ `query MarketGet($id: ID!) { market(id: $id) { ${MARKET_FIELDS} } }`, { id });
  return unwrap(res, (d) => (d.market ? toMarket(d.market) : null));
}
export interface MarketCreateInput {
  name: string;
  handle?: string;
  status?: "ACTIVE" | "DRAFT";
  regions?: string[];
  baseCurrency?: string;
  localCurrencies?: boolean;
}
export async function createMarket(client: AdminClient, input: MarketCreateInput): Promise<{ market?: Market; userErrors: UserError[] }> {
  const gql = { name: input.name, handle: input.handle, status: input.status ?? "DRAFT", ...(input.regions?.length ? { conditions: { regionsCondition: { regions: input.regions.map((code) => ({ countryCode: code })) } } } : {}), ...(input.baseCurrency ? { currencySettings: { baseCurrency: input.baseCurrency, localCurrencies: input.localCurrencies ?? false } } : {}) };
  const res = await client.mutate(/* GraphQL */ `mutation MarketCreate($input: MarketCreateInput!) { marketCreate(input: $input) { market { ${MARKET_FIELDS} } userErrors { field message } } }`, { input: gql });
  return unwrap(res, (d) => ({ market: d.marketCreate.market ? toMarket(d.marketCreate.market) : undefined, userErrors: userErrors(d.marketCreate) }));
}
export async function updateMarket(client: AdminClient, id: string, input: { name?: string; handle?: string; status?: "ACTIVE" | "DRAFT"; regions?: string[] }): Promise<{ market?: Market; userErrors: UserError[] }> {
  const gql: Record<string, unknown> = { name: input.name, handle: input.handle, status: input.status };
  if (input.regions) gql.conditions = { regionsCondition: { regionsToAdd: input.regions.map((code) => ({ countryCode: code })) } };
  const res = await client.mutate(/* GraphQL */ `mutation MarketUpdate($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { ${MARKET_FIELDS} } userErrors { field message } } }`, { id, input: gql });
  return unwrap(res, (d) => ({ market: d.marketUpdate.market ? toMarket(d.marketUpdate.market) : undefined, userErrors: userErrors(d.marketUpdate) }));
}
export async function deleteMarket(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation MarketDelete($id: ID!) { marketDelete(id: $id) { deletedId userErrors { field message } } }`, { id });
  return unwrap(res, (d) => ({ deletedId: d.marketDelete.deletedId ?? undefined, userErrors: userErrors(d.marketDelete) }));
}

// ---------------------------------------------------------------------------
// Locales + translations
// ---------------------------------------------------------------------------
export interface ShopLocale {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
}
export async function listShopLocales(client: AdminClient): Promise<ShopLocale[]> {
  const res = await client.query(/* GraphQL */ `query ShopLocales { shopLocales { locale name primary published } }`);
  return unwrap(res, (d) => d.shopLocales ?? []);
}
export async function enableShopLocale(client: AdminClient, locale: string, marketWebPresenceIds?: string[]): Promise<{ locale?: ShopLocale; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation ShopLocaleEnable($locale: String!, $ids: [ID!]) { shopLocaleEnable(locale: $locale, marketWebPresenceIds: $ids) { shopLocale { locale name primary published } userErrors { field message } } }`, { locale, ids: marketWebPresenceIds });
  return unwrap(res, (d) => ({ locale: d.shopLocaleEnable.shopLocale ?? undefined, userErrors: userErrors(d.shopLocaleEnable) }));
}
export async function updateShopLocale(client: AdminClient, locale: string, input: { published?: boolean; marketWebPresenceIds?: string[] }): Promise<{ locale?: ShopLocale; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation ShopLocaleUpdate($locale: String!, $shopLocale: ShopLocaleInput!) { shopLocaleUpdate(locale: $locale, shopLocale: $shopLocale) { shopLocale { locale name primary published } userErrors { field message } } }`, { locale, shopLocale: input });
  return unwrap(res, (d) => ({ locale: d.shopLocaleUpdate.shopLocale ?? undefined, userErrors: userErrors(d.shopLocaleUpdate) }));
}
export async function disableShopLocale(client: AdminClient, locale: string): Promise<{ locale?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation ShopLocaleDisable($locale: String!) { shopLocaleDisable(locale: $locale) { locale userErrors { field message } } }`, { locale });
  return unwrap(res, (d) => ({ locale: d.shopLocaleDisable.locale ?? undefined, userErrors: userErrors(d.shopLocaleDisable) }));
}

/** TranslatableResourceType enum as introspected live on 2026-07 (2026-09-12): pages/articles/blogs/menus are PAGE / ARTICLE / BLOG / MENU (the ONLINE_STORE_* forms are gone). */
export const TRANSLATABLE_RESOURCE_TYPES = ["PRODUCT", "PRODUCT_OPTION", "PRODUCT_OPTION_VALUE", "COLLECTION", "COLLECTION_IMAGE", "PAGE", "ARTICLE", "ARTICLE_IMAGE", "BLOG", "MENU", "LINK", "MEDIA_IMAGE", "ONLINE_STORE_THEME", "ONLINE_STORE_THEME_APP_EMBED", "ONLINE_STORE_THEME_JSON_TEMPLATE", "ONLINE_STORE_THEME_LOCALE_CONTENT", "ONLINE_STORE_THEME_SECTION_GROUP", "ONLINE_STORE_THEME_SETTINGS_CATEGORY", "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS", "METAFIELD", "METAOBJECT", "SHOP", "SHOP_POLICY", "EMAIL_TEMPLATE", "FILTER", "PAYMENT_GATEWAY", "SELLING_PLAN", "SELLING_PLAN_GROUP", "DELIVERY_METHOD_DEFINITION", "PACKING_SLIP_TEMPLATE"] as const;
export interface TranslatableContent {
  key: string;
  value?: string | null;
  digest?: string | null;
  locale: string;
}
export interface Translation {
  key: string;
  value: string;
  locale: string;
  outdated?: boolean;
  marketId?: string | null;
}
export interface TranslatableResource {
  resourceId: string;
  content: TranslatableContent[];
  translations: Translation[];
}
export async function getTranslatableResource(client: AdminClient, resourceId: string, locale?: string, marketId?: string): Promise<TranslatableResource | null> {
  const res = await client.query(
    /* GraphQL */ `query TranslatableResourceGet($id: ID!, $locale: String!, $marketId: ID, $withTranslations: Boolean!) {
      translatableResource(resourceId: $id) {
        resourceId
        translatableContent { key value digest locale }
        translations(locale: $locale, marketId: $marketId) @include(if: $withTranslations) { key value locale outdated market { id } }
      }
    }`,
    { id: resourceId, locale: locale ?? "en", marketId, withTranslations: !!locale },
  );
  return unwrap(res, (d) => {
    const r = d.translatableResource;
    if (!r) return null;
    return { resourceId: r.resourceId, content: r.translatableContent ?? [], translations: (r.translations ?? []).map((t: any) => ({ key: t.key, value: t.value, locale: t.locale, outdated: t.outdated, marketId: t.market?.id ?? null })) };
  });
}
export async function listTranslatableResources(client: AdminClient, resourceType: string, opts: { first?: number; after?: string; locale?: string } = {}): Promise<Page<TranslatableResource>> {
  const res = await client.query(
    /* GraphQL */ `query TranslatableResourcesList($type: TranslatableResourceType!, $first: Int!, $after: String, $locale: String!, $withTranslations: Boolean!) {
      translatableResources(resourceType: $type, first: $first, after: $after) {
        nodes { resourceId translatableContent { key value digest locale } translations(locale: $locale) @include(if: $withTranslations) { key value locale outdated } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { type: resourceType, first: opts.first ?? 50, after: opts.after, locale: opts.locale ?? "en", withTranslations: !!opts.locale },
  );
  return unwrap(res, (d) => { const p = conn<any>(d.translatableResources); return { ...p, items: p.items.map((r: any) => ({ resourceId: r.resourceId, content: r.translatableContent ?? [], translations: r.translations ?? [] })) }; });
}
export interface TranslationInput {
  key: string;
  value: string;
  locale: string;
  translatableContentDigest: string;
  marketId?: string;
}
export async function registerTranslations(client: AdminClient, resourceId: string, translations: TranslationInput[]): Promise<{ translations: Translation[]; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation TranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) { translationsRegister(resourceId: $resourceId, translations: $translations) { translations { key value locale outdated } userErrors { field message } } }`, { resourceId, translations });
  return unwrap(res, (d) => ({ translations: d.translationsRegister.translations ?? [], userErrors: userErrors(d.translationsRegister) }));
}
export async function removeTranslations(client: AdminClient, resourceId: string, translationKeys: string[], locales: string[], marketIds?: string[]): Promise<{ translations: Translation[]; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation TranslationsRemove($resourceId: ID!, $translationKeys: [String!]!, $locales: [String!]!, $marketIds: [ID!]) { translationsRemove(resourceId: $resourceId, translationKeys: $translationKeys, locales: $locales, marketIds: $marketIds) { translations { key value locale } userErrors { field message } } }`, { resourceId, translationKeys, locales, marketIds });
  return unwrap(res, (d) => ({ translations: d.translationsRemove.translations ?? [], userErrors: userErrors(d.translationsRemove) }));
}

// ---------------------------------------------------------------------------
// Catalogs + price lists
// ---------------------------------------------------------------------------
export interface Catalog {
  id: string;
  title: string;
  status: string;
  type?: string;
  priceListId?: string;
  publicationId?: string;
  marketIds: string[];
}
const CATALOG_FIELDS = /* GraphQL */ `id title status priceList { id } publication { id } ... on MarketCatalog { markets(first: 20) { nodes { id } } }`;
const toCatalog = (c: any): Catalog => ({ id: c.id, title: c.title, status: c.status, type: c.__typename, priceListId: c.priceList?.id, publicationId: c.publication?.id, marketIds: (c.markets?.nodes ?? []).map((m: any) => m.id) });
export async function listCatalogs(client: AdminClient, opts: PageOpts & { type?: "MARKET" | "COMPANY_LOCATION" | "APP" } = {}): Promise<Page<Catalog>> {
  const res = await client.query(/* GraphQL */ `query CatalogsList($first: Int!, $after: String, $query: String, $type: CatalogType) { catalogs(first: $first, after: $after, query: $query, type: $type) { nodes { __typename ${CATALOG_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { ...pageArgs(opts), type: opts.type });
  return unwrap(res, (d) => { const p = conn<any>(d.catalogs); return { ...p, items: p.items.map(toCatalog) }; });
}
export async function createCatalog(client: AdminClient, input: { title: string; status?: "ACTIVE" | "DRAFT"; marketIds?: string[]; companyLocationIds?: string[]; priceListId?: string; publicationId?: string }): Promise<{ catalog?: Catalog; userErrors: UserError[] }> {
  const gql = { title: input.title, status: input.status ?? "DRAFT", context: input.companyLocationIds?.length ? { companyLocationIds: input.companyLocationIds } : { marketIds: input.marketIds ?? [] }, priceListId: input.priceListId, publicationId: input.publicationId };
  const res = await client.mutate(/* GraphQL */ `mutation CatalogCreate($input: CatalogCreateInput!) { catalogCreate(input: $input) { catalog { __typename ${CATALOG_FIELDS} } userErrors { field message } } }`, { input: gql });
  return unwrap(res, (d) => ({ catalog: d.catalogCreate.catalog ? toCatalog(d.catalogCreate.catalog) : undefined, userErrors: userErrors(d.catalogCreate) }));
}
export async function updateCatalog(client: AdminClient, id: string, input: { title?: string; status?: "ACTIVE" | "DRAFT"; marketIds?: string[]; priceListId?: string; publicationId?: string }): Promise<{ catalog?: Catalog; userErrors: UserError[] }> {
  const gql: Record<string, unknown> = { title: input.title, status: input.status, priceListId: input.priceListId, publicationId: input.publicationId };
  if (input.marketIds) gql.context = { marketIds: input.marketIds };
  const res = await client.mutate(/* GraphQL */ `mutation CatalogUpdate($id: ID!, $input: CatalogUpdateInput!) { catalogUpdate(id: $id, input: $input) { catalog { __typename ${CATALOG_FIELDS} } userErrors { field message } } }`, { id, input: gql });
  return unwrap(res, (d) => ({ catalog: d.catalogUpdate.catalog ? toCatalog(d.catalogUpdate.catalog) : undefined, userErrors: userErrors(d.catalogUpdate) }));
}
export async function deleteCatalog(client: AdminClient, id: string, deleteDependentResources = false): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation CatalogDelete($id: ID!, $deleteDependentResources: Boolean) { catalogDelete(id: $id, deleteDependentResources: $deleteDependentResources) { deletedId userErrors { field message } } }`, { id, deleteDependentResources });
  return unwrap(res, (d) => ({ deletedId: d.catalogDelete.deletedId ?? undefined, userErrors: userErrors(d.catalogDelete) }));
}

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  catalogId?: string;
  adjustment?: { type: string; value: number };
  fixedPricesCount?: number;
}
const PRICE_LIST_FIELDS = /* GraphQL */ `id name currency catalog { id } parent { adjustment { type value } } fixedPricesCount`;
const toPriceList = (p: any): PriceList => ({ id: p.id, name: p.name, currency: p.currency, catalogId: p.catalog?.id, adjustment: p.parent?.adjustment ?? undefined, fixedPricesCount: p.fixedPricesCount ?? undefined });
export async function listPriceLists(client: AdminClient, opts: PageOpts = {}): Promise<Page<PriceList>> {
  const res = await client.query(/* GraphQL */ `query PriceListsList($first: Int!, $after: String) { priceLists(first: $first, after: $after) { nodes { ${PRICE_LIST_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { first: opts.first ?? 50, after: opts.after });
  return unwrap(res, (d) => { const p = conn<any>(d.priceLists); return { ...p, items: p.items.map(toPriceList) }; });
}
export async function getPriceListPrices(client: AdminClient, id: string, opts: { first?: number; after?: string } = {}): Promise<Page<{ variantId: string; price: { amount: string; currencyCode: string }; compareAtPrice?: { amount: string; currencyCode: string } | null; originType?: string }>> {
  const res = await client.query(/* GraphQL */ `query PriceListPrices($id: ID!, $first: Int!, $after: String) { priceList(id: $id) { prices(first: $first, after: $after) { nodes { variant { id } price { amount currencyCode } compareAtPrice { amount currencyCode } originType } pageInfo { hasNextPage endCursor } } } }`, { id, first: opts.first ?? 50, after: opts.after });
  return unwrap(res, (d) => { const p = conn<any>(d.priceList?.prices); return { ...p, items: p.items.map((x: any) => ({ variantId: x.variant.id, price: x.price, compareAtPrice: x.compareAtPrice, originType: x.originType })) }; });
}
export type PriceListAdjustmentType = "PERCENTAGE_INCREASE" | "PERCENTAGE_DECREASE";
export async function createPriceList(client: AdminClient, input: { name: string; currency: string; adjustmentType: PriceListAdjustmentType; adjustmentValue: number; catalogId?: string; compareAtMode?: "ADJUSTED" | "NULLIFY" }): Promise<{ priceList?: PriceList; userErrors: UserError[] }> {
  const gql = { name: input.name, currency: input.currency, catalogId: input.catalogId, parent: { adjustment: { type: input.adjustmentType, value: input.adjustmentValue }, settings: { compareAtMode: input.compareAtMode ?? "ADJUSTED" } } };
  const res = await client.mutate(/* GraphQL */ `mutation PriceListCreate($input: PriceListCreateInput!) { priceListCreate(input: $input) { priceList { ${PRICE_LIST_FIELDS} } userErrors { field message } } }`, { input: gql });
  return unwrap(res, (d) => ({ priceList: d.priceListCreate.priceList ? toPriceList(d.priceListCreate.priceList) : undefined, userErrors: userErrors(d.priceListCreate) }));
}
export async function deletePriceList(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation PriceListDelete($id: ID!) { priceListDelete(id: $id) { deletedId userErrors { field message } } }`, { id });
  return unwrap(res, (d) => ({ deletedId: d.priceListDelete.deletedId ?? undefined, userErrors: userErrors(d.priceListDelete) }));
}
export interface FixedPriceInput {
  variantId: string;
  price: { amount: string; currencyCode: string };
  compareAtPrice?: { amount: string; currencyCode: string };
}
export async function addPriceListFixedPrices(client: AdminClient, priceListId: string, prices: FixedPriceInput[]): Promise<{ prices: Array<{ variantId: string; price: { amount: string; currencyCode: string } }>; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation PriceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) { priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) { prices { variant { id } price { amount currencyCode } } userErrors { field message } } }`, { priceListId, prices });
  return unwrap(res, (d) => ({ prices: (d.priceListFixedPricesAdd.prices ?? []).map((p: any) => ({ variantId: p.variant.id, price: p.price })), userErrors: userErrors(d.priceListFixedPricesAdd) }));
}
export async function deletePriceListFixedPrices(client: AdminClient, priceListId: string, variantIds: string[]): Promise<{ deletedVariantIds: string[]; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation PriceListFixedPricesDelete($priceListId: ID!, $variantIds: [ID!]!) { priceListFixedPricesDelete(priceListId: $priceListId, variantIds: $variantIds) { deletedFixedPriceVariantIds userErrors { field message } } }`, { priceListId, variantIds });
  return unwrap(res, (d) => ({ deletedVariantIds: d.priceListFixedPricesDelete.deletedFixedPriceVariantIds ?? [], userErrors: userErrors(d.priceListFixedPricesDelete) }));
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------
export interface DiscountSummary {
  id: string;
  kind: string; // DiscountCodeBasic | DiscountAutomaticBasic | ...
  method: "CODE" | "AUTOMATIC";
  title: string;
  status?: string;
  summary?: string;
  startsAt?: string;
  endsAt?: string | null;
  usageLimit?: number | null;
  asyncUsageCount?: number;
  codes: string[];
  combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
}
const CODE_FRAGMENT = /* GraphQL */ `
  __typename
  ... on DiscountCodeBasic { title status summary startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountCodeBxgy { title status summary startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountCodeFreeShipping { title status summary startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountCodeApp { title status startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
`;
const AUTO_FRAGMENT = /* GraphQL */ `
  __typename
  ... on DiscountAutomaticBasic { title status summary startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
  ... on DiscountAutomaticBxgy { title status summary startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
  ... on DiscountAutomaticFreeShipping { title status summary startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
  ... on DiscountAutomaticApp { title status startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
`;
const DISCOUNT_FRAGMENT = /* GraphQL */ `
  __typename
  ... on DiscountCodeBasic { title status summary startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountCodeBxgy { title status summary startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountCodeFreeShipping { title status summary startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountCodeApp { title status startsAt endsAt usageLimit asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes(first: 5) { nodes { code } } }
  ... on DiscountAutomaticBasic { title status summary startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
  ... on DiscountAutomaticBxgy { title status summary startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
  ... on DiscountAutomaticFreeShipping { title status summary startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
  ... on DiscountAutomaticApp { title status startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
`;
const toDiscount = (id: string, d: any): DiscountSummary => ({ id, kind: d.__typename, method: String(d.__typename).startsWith("DiscountCode") ? "CODE" : "AUTOMATIC", title: d.title, status: d.status, summary: d.summary, startsAt: d.startsAt, endsAt: d.endsAt, usageLimit: d.usageLimit, asyncUsageCount: d.asyncUsageCount, codes: (d.codes?.nodes ?? []).map((c: any) => c.code), combinesWith: d.combinesWith });
export async function listDiscounts(client: AdminClient, opts: PageOpts = {}): Promise<Page<DiscountSummary>> {
  const res = await client.query(/* GraphQL */ `query DiscountsList($first: Int!, $after: String, $query: String) { discountNodes(first: $first, after: $after, query: $query) { nodes { id discount { ${DISCOUNT_FRAGMENT} } } pageInfo { hasNextPage endCursor } } }`, pageArgs(opts));
  return unwrap(res, (d) => { const p = conn<any>(d.discountNodes); return { ...p, items: p.items.map((n: any) => toDiscount(n.id, n.discount)) }; });
}
export async function getDiscount(client: AdminClient, id: string): Promise<DiscountSummary | null> {
  const res = await client.query(/* GraphQL */ `query DiscountGet($id: ID!) { discountNode(id: $id) { id discount { ${DISCOUNT_FRAGMENT} } } }`, { id });
  return unwrap(res, (d) => (d.discountNode ? toDiscount(d.discountNode.id, d.discountNode.discount) : null));
}
export interface BasicDiscountInput {
  title: string;
  /** Code discounts only. */
  code?: string;
  percentage?: number; // 0..1
  amount?: { amount: string; currencyCode?: string; appliesOnEachItem?: boolean };
  appliesTo?: { all?: boolean; productIds?: string[]; collectionIds?: string[] };
  minimumSubtotal?: string;
  minimumQuantity?: number;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
  combinesWith?: { orderDiscounts?: boolean; productDiscounts?: boolean; shippingDiscounts?: boolean };
}
function basicInputToGql(input: BasicDiscountInput, method: "CODE" | "AUTOMATIC"): Record<string, unknown> {
  const items = input.appliesTo?.productIds?.length ? { products: { productsToAdd: input.appliesTo.productIds } } : input.appliesTo?.collectionIds?.length ? { collections: { add: input.appliesTo.collectionIds } } : { all: true };
  const value = input.percentage !== undefined ? { percentage: input.percentage } : input.amount ? { discountAmount: { amount: input.amount.amount, appliesOnEachItem: input.amount.appliesOnEachItem ?? false } } : undefined;
  const minimumRequirement = input.minimumSubtotal ? { subtotal: { greaterThanOrEqualToSubtotal: input.minimumSubtotal } } : input.minimumQuantity ? { quantity: { greaterThanOrEqualToQuantity: String(input.minimumQuantity) } } : undefined;
  const base: Record<string, unknown> = { title: input.title, startsAt: input.startsAt ?? new Date().toISOString(), endsAt: input.endsAt, customerGets: { value, items }, minimumRequirement, combinesWith: input.combinesWith };
  if (method === "CODE") Object.assign(base, { code: input.code, usageLimit: input.usageLimit, appliesOncePerCustomer: input.appliesOncePerCustomer ?? false, customerSelection: { all: true } });
  return base;
}
export async function createBasicCodeDiscount(client: AdminClient, input: BasicDiscountInput): Promise<{ discount?: DiscountSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id codeDiscount { ${CODE_FRAGMENT} } } userErrors { field message code } } }`, { basicCodeDiscount: basicInputToGql(input, "CODE") });
  return unwrap(res, (d) => ({ discount: d.discountCodeBasicCreate.codeDiscountNode ? toDiscount(d.discountCodeBasicCreate.codeDiscountNode.id, d.discountCodeBasicCreate.codeDiscountNode.codeDiscount) : undefined, userErrors: userErrors(d.discountCodeBasicCreate) }));
}
export async function createBasicAutomaticDiscount(client: AdminClient, input: BasicDiscountInput): Promise<{ discount?: DiscountSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DiscountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) { discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) { automaticDiscountNode { id automaticDiscount { ${AUTO_FRAGMENT} } } userErrors { field message code } } }`, { automaticBasicDiscount: basicInputToGql(input, "AUTOMATIC") });
  return unwrap(res, (d) => ({ discount: d.discountAutomaticBasicCreate.automaticDiscountNode ? toDiscount(d.discountAutomaticBasicCreate.automaticDiscountNode.id, d.discountAutomaticBasicCreate.automaticDiscountNode.automaticDiscount) : undefined, userErrors: userErrors(d.discountAutomaticBasicCreate) }));
}
export async function createFreeShippingCodeDiscount(client: AdminClient, input: { title: string; code: string; minimumSubtotal?: string; startsAt?: string; endsAt?: string; usageLimit?: number; appliesOncePerCustomer?: boolean; maximumShippingPrice?: string }): Promise<{ discount?: DiscountSummary; userErrors: UserError[] }> {
  const gql = { title: input.title, code: input.code, startsAt: input.startsAt ?? new Date().toISOString(), endsAt: input.endsAt, usageLimit: input.usageLimit, appliesOncePerCustomer: input.appliesOncePerCustomer ?? false, customerSelection: { all: true }, destination: { all: true }, minimumRequirement: input.minimumSubtotal ? { subtotal: { greaterThanOrEqualToSubtotal: input.minimumSubtotal } } : undefined, maximumShippingPrice: input.maximumShippingPrice };
  const res = await client.mutate(/* GraphQL */ `mutation DiscountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) { discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) { codeDiscountNode { id codeDiscount { ${CODE_FRAGMENT} } } userErrors { field message code } } }`, { freeShippingCodeDiscount: gql });
  return unwrap(res, (d) => ({ discount: d.discountCodeFreeShippingCreate.codeDiscountNode ? toDiscount(d.discountCodeFreeShippingCreate.codeDiscountNode.id, d.discountCodeFreeShippingCreate.codeDiscountNode.codeDiscount) : undefined, userErrors: userErrors(d.discountCodeFreeShippingCreate) }));
}
export async function setDiscountActive(client: AdminClient, id: string, method: "CODE" | "AUTOMATIC", active: boolean): Promise<{ id?: string; status?: string; userErrors: UserError[] }> {
  const name = method === "CODE" ? (active ? "discountCodeActivate" : "discountCodeDeactivate") : active ? "discountAutomaticActivate" : "discountAutomaticDeactivate";
  const nodeField = method === "CODE" ? "codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic { status } ... on DiscountCodeBxgy { status } ... on DiscountCodeFreeShipping { status } ... on DiscountCodeApp { status } } }" : "automaticDiscountNode { id automaticDiscount { ... on DiscountAutomaticBasic { status } ... on DiscountAutomaticBxgy { status } ... on DiscountAutomaticFreeShipping { status } ... on DiscountAutomaticApp { status } } }";
  const res = await client.mutate(/* GraphQL */ `mutation ${name[0]!.toUpperCase()}${name.slice(1)}($id: ID!) { ${name}(id: $id) { ${nodeField} userErrors { field message } } }`, { id });
  return unwrap(res, (d) => { const p = d[name]; const node = p.codeDiscountNode ?? p.automaticDiscountNode; return { id: node?.id, status: (node?.codeDiscount ?? node?.automaticDiscount)?.status, userErrors: userErrors(p) }; });
}
export async function deleteDiscount(client: AdminClient, id: string, method: "CODE" | "AUTOMATIC"): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const name = method === "CODE" ? "discountCodeDelete" : "discountAutomaticDelete";
  const res = await client.mutate(/* GraphQL */ `mutation ${name[0]!.toUpperCase()}${name.slice(1)}($id: ID!) { ${name}(id: $id) { deletedCodeDiscountId: ${method === "CODE" ? "deletedCodeDiscountId" : "deletedAutomaticDiscountId"} userErrors { field message } } }`, { id });
  return unwrap(res, (d) => ({ deletedId: d[name].deletedCodeDiscountId ?? undefined, userErrors: userErrors(d[name]) }));
}

// ---------------------------------------------------------------------------
// Orders, draft orders, fulfillment, returns
// ---------------------------------------------------------------------------
export interface OrderSummary {
  id: string;
  name: string;
  createdAt: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  total: { amount: string; currencyCode: string };
  customer?: { id: string; displayName?: string; email?: string | null };
  email?: string | null;
  tags: string[];
  lineItemCount?: number;
  note?: string | null;
}
const ORDER_SUMMARY_FIELDS = /* GraphQL */ `id name createdAt displayFinancialStatus displayFulfillmentStatus tags note email totalPriceSet { shopMoney { amount currencyCode } } customer { id displayName email } lineItemsProbe: lineItems(first: 1) { pageInfo { hasNextPage } }`;
const toOrderSummary = (o: any): OrderSummary => ({ id: o.id, name: o.name, createdAt: o.createdAt, financialStatus: o.displayFinancialStatus, fulfillmentStatus: o.displayFulfillmentStatus, total: o.totalPriceSet?.shopMoney, customer: o.customer ?? undefined, email: o.email, tags: o.tags ?? [], note: o.note });
export async function listOrders(client: AdminClient, opts: PageOpts & { sortKey?: string; reverse?: boolean } = {}): Promise<Page<OrderSummary>> {
  const res = await client.query(/* GraphQL */ `query OrdersList($first: Int!, $after: String, $query: String, $sortKey: OrderSortKeys, $reverse: Boolean) { orders(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) { nodes { ${ORDER_SUMMARY_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { ...pageArgs(opts), sortKey: opts.sortKey ?? "PROCESSED_AT", reverse: opts.reverse ?? true });
  return unwrap(res, (d) => { const p = conn<any>(d.orders); return { ...p, items: p.items.map(toOrderSummary) }; });
}
export interface OrderDetail extends OrderSummary {
  subtotal?: { amount: string; currencyCode: string };
  shippingTotal?: { amount: string; currencyCode: string };
  taxTotal?: { amount: string; currencyCode: string };
  discountCodes: string[];
  lineItems: Array<{ id: string; title: string; sku?: string | null; quantity: number; variantId?: string; unitPrice?: { amount: string; currencyCode: string } }>;
  shippingAddress?: { city?: string; province?: string; country?: string; zip?: string } | null;
  fulfillmentOrders: Array<{ id: string; status: string; requestStatus?: string; locationId?: string; locationName?: string; lineItems: Array<{ id: string; remainingQuantity: number; totalQuantity: number; lineItemId?: string; title?: string; sku?: string | null }> }>;
  fulfillments: Array<{ id: string; status: string; trackingNumbers: string[]; trackingCompany?: string | null; createdAt: string }>;
  cancelledAt?: string | null;
  closed?: boolean;
}
export async function getOrder(client: AdminClient, id: string): Promise<OrderDetail | null> {
  const res = await client.query(
    /* GraphQL */ `query OrderGet($id: ID!) {
      order(id: $id) {
        ${ORDER_SUMMARY_FIELDS}
        cancelledAt closed
        subtotalPriceSet { shopMoney { amount currencyCode } } totalShippingPriceSet { shopMoney { amount currencyCode } } totalTaxSet { shopMoney { amount currencyCode } }
        discountCodes
        shippingAddress { city province country zip }
        lineItems(first: 100) { nodes { id title sku quantity variant { id } originalUnitPriceSet { shopMoney { amount currencyCode } } } }
        fulfillmentOrders(first: 20) { nodes { id status requestStatus assignedLocation { name location { id } } lineItems(first: 100) { nodes { id remainingQuantity totalQuantity lineItem { id title sku } } } } }
        fulfillments(first: 20) { id status createdAt trackingInfo { number company } }
      }
    }`,
    { id },
  );
  return unwrap(res, (d) => {
    const o = d.order;
    if (!o) return null;
    return {
      ...toOrderSummary(o),
      cancelledAt: o.cancelledAt,
      closed: o.closed,
      subtotal: o.subtotalPriceSet?.shopMoney,
      shippingTotal: o.totalShippingPriceSet?.shopMoney,
      taxTotal: o.totalTaxSet?.shopMoney,
      discountCodes: o.discountCodes ?? [],
      lineItems: (o.lineItems?.nodes ?? []).map((li: any) => ({ id: li.id, title: li.title, sku: li.sku, quantity: li.quantity, variantId: li.variant?.id, unitPrice: li.originalUnitPriceSet?.shopMoney })),
      shippingAddress: o.shippingAddress,
      fulfillmentOrders: (o.fulfillmentOrders?.nodes ?? []).map((fo: any) => ({ id: fo.id, status: fo.status, requestStatus: fo.requestStatus, locationId: fo.assignedLocation?.location?.id, locationName: fo.assignedLocation?.name, lineItems: (fo.lineItems?.nodes ?? []).map((l: any) => ({ id: l.id, remainingQuantity: l.remainingQuantity, totalQuantity: l.totalQuantity, lineItemId: l.lineItem?.id, title: l.lineItem?.title, sku: l.lineItem?.sku })) })),
      fulfillments: (o.fulfillments ?? []).map((f: any) => ({ id: f.id, status: f.status, createdAt: f.createdAt, trackingNumbers: (f.trackingInfo ?? []).map((t: any) => t.number).filter(Boolean), trackingCompany: f.trackingInfo?.[0]?.company ?? null })),
    };
  });
}
export async function updateOrder(client: AdminClient, id: string, input: { note?: string; tags?: string[]; email?: string; customAttributes?: Array<{ key: string; value: string }> }): Promise<{ order?: OrderSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation OrderUpdate($input: OrderInput!) { orderUpdate(input: $input) { order { ${ORDER_SUMMARY_FIELDS} } userErrors { field message } } }`, { input: { id, ...input } });
  return unwrap(res, (d) => ({ order: d.orderUpdate.order ? toOrderSummary(d.orderUpdate.order) : undefined, userErrors: userErrors(d.orderUpdate) }));
}
export async function closeOrder(client: AdminClient, id: string): Promise<{ order?: { id: string; closed: boolean }; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation OrderClose($input: OrderCloseInput!) { orderClose(input: $input) { order { id closed } userErrors { field message } } }`, { input: { id } });
  return unwrap(res, (d) => ({ order: d.orderClose.order ?? undefined, userErrors: userErrors(d.orderClose) }));
}
export async function cancelOrder(client: AdminClient, input: { orderId: string; reason: "CUSTOMER" | "DECLINED" | "FRAUD" | "INVENTORY" | "OTHER" | "STAFF"; refund: boolean; restock: boolean; notifyCustomer?: boolean; staffNote?: string }): Promise<{ jobId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String) { orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote) { job { id } orderCancelUserErrors { field message code } } }`, input);
  return unwrap(res, (d) => ({ jobId: d.orderCancel.job?.id, userErrors: d.orderCancel.orderCancelUserErrors ?? [] }));
}

export interface DraftOrderSummary {
  id: string;
  name: string;
  status: string;
  createdAt?: string;
  total?: { amount: string; currencyCode: string };
  email?: string | null;
  customer?: { id: string; displayName?: string } | null;
  invoiceUrl?: string | null;
  orderId?: string | null;
  tags: string[];
  lineItems: Array<{ title: string; quantity: number; variantId?: string; sku?: string | null }>;
}
const DRAFT_FIELDS = /* GraphQL */ `id name status createdAt email invoiceUrl tags totalPriceSet { shopMoney { amount currencyCode } } customer { id displayName } order { id } lineItems(first: 50) { nodes { title quantity sku variant { id } } }`;
const toDraft = (x: any): DraftOrderSummary => ({ id: x.id, name: x.name, status: x.status, createdAt: x.createdAt, total: x.totalPriceSet?.shopMoney, email: x.email, customer: x.customer, invoiceUrl: x.invoiceUrl, orderId: x.order?.id ?? null, tags: x.tags ?? [], lineItems: (x.lineItems?.nodes ?? []).map((l: any) => ({ title: l.title, quantity: l.quantity, sku: l.sku, variantId: l.variant?.id })) });
export async function listDraftOrders(client: AdminClient, opts: PageOpts = {}): Promise<Page<DraftOrderSummary>> {
  const res = await client.query(/* GraphQL */ `query DraftOrdersList($first: Int!, $after: String, $query: String) { draftOrders(first: $first, after: $after, query: $query) { nodes { ${DRAFT_FIELDS} } pageInfo { hasNextPage endCursor } } }`, pageArgs(opts));
  return unwrap(res, (d) => { const p = conn<any>(d.draftOrders); return { ...p, items: p.items.map(toDraft) }; });
}
export interface DraftOrderInput {
  lineItems: Array<{ variantId?: string; quantity: number; title?: string; originalUnitPrice?: string }>;
  email?: string;
  customerId?: string;
  note?: string;
  tags?: string[];
  shippingAddress?: Record<string, unknown>;
  appliedDiscount?: { title?: string; description?: string; value: number; valueType: "PERCENTAGE" | "FIXED_AMOUNT" };
  useCustomerDefaultAddress?: boolean;
  reserveInventoryUntil?: string;
}
export async function createDraftOrder(client: AdminClient, input: DraftOrderInput): Promise<{ draftOrder?: DraftOrderSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DraftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${DRAFT_FIELDS} } userErrors { field message } } }`, { input });
  return unwrap(res, (d) => ({ draftOrder: d.draftOrderCreate.draftOrder ? toDraft(d.draftOrderCreate.draftOrder) : undefined, userErrors: userErrors(d.draftOrderCreate) }));
}
export async function updateDraftOrder(client: AdminClient, id: string, input: Partial<DraftOrderInput>): Promise<{ draftOrder?: DraftOrderSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { draftOrder { ${DRAFT_FIELDS} } userErrors { field message } } }`, { id, input });
  return unwrap(res, (d) => ({ draftOrder: d.draftOrderUpdate.draftOrder ? toDraft(d.draftOrderUpdate.draftOrder) : undefined, userErrors: userErrors(d.draftOrderUpdate) }));
}
export async function completeDraftOrder(client: AdminClient, id: string, paymentPending = false): Promise<{ orderId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean) { draftOrderComplete(id: $id, paymentPending: $paymentPending) { draftOrder { id order { id } } userErrors { field message } } }`, { id, paymentPending });
  return unwrap(res, (d) => ({ orderId: d.draftOrderComplete.draftOrder?.order?.id, userErrors: userErrors(d.draftOrderComplete) }));
}
export async function deleteDraftOrder(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DraftOrderDelete($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { field message } } }`, { input: { id } });
  return unwrap(res, (d) => ({ deletedId: d.draftOrderDelete.deletedId ?? undefined, userErrors: userErrors(d.draftOrderDelete) }));
}
export async function sendDraftOrderInvoice(client: AdminClient, id: string, email?: { to?: string; subject?: string; customMessage?: string }): Promise<{ invoiceUrl?: string | null; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation DraftOrderInvoiceSend($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { invoiceUrl } userErrors { field message } } }`, { id, email });
  return unwrap(res, (d) => ({ invoiceUrl: d.draftOrderInvoiceSend.draftOrder?.invoiceUrl, userErrors: userErrors(d.draftOrderInvoiceSend) }));
}

export async function createFulfillment(client: AdminClient, input: { fulfillmentOrderId: string; lineItems?: Array<{ id: string; quantity: number }>; tracking?: { number?: string; company?: string; url?: string }; notifyCustomer?: boolean }): Promise<{ fulfillment?: { id: string; status: string }; userErrors: UserError[] }> {
  const fulfillment = { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: input.fulfillmentOrderId, ...(input.lineItems?.length ? { fulfillmentOrderLineItems: input.lineItems } : {}) }], trackingInfo: input.tracking, notifyCustomer: input.notifyCustomer ?? false };
  const res = await client.mutate(/* GraphQL */ `mutation FulfillmentCreate($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } } }`, { fulfillment });
  return unwrap(res, (d) => ({ fulfillment: d.fulfillmentCreate.fulfillment ?? undefined, userErrors: userErrors(d.fulfillmentCreate) }));
}
export async function listReturnableFulfillments(client: AdminClient, orderId: string): Promise<Array<{ fulfillmentId: string; lineItems: Array<{ fulfillmentLineItemId: string; quantity: number; title?: string; sku?: string | null }> }>> {
  const res = await client.query(/* GraphQL */ `query ReturnableFulfillments($orderId: ID!) { returnableFulfillments(orderId: $orderId, first: 20) { nodes { id fulfillment { id } returnableFulfillmentLineItems(first: 100) { nodes { quantity fulfillmentLineItem { id lineItem { title sku } } } } } } }`, { orderId });
  return unwrap(res, (d) => (d.returnableFulfillments?.nodes ?? []).map((n: any) => ({ fulfillmentId: n.fulfillment.id, lineItems: (n.returnableFulfillmentLineItems?.nodes ?? []).map((l: any) => ({ fulfillmentLineItemId: l.fulfillmentLineItem.id, quantity: l.quantity, title: l.fulfillmentLineItem.lineItem?.title, sku: l.fulfillmentLineItem.lineItem?.sku })) })));
}
export type ReturnReason = "COLOR" | "DEFECTIVE" | "NOT_AS_DESCRIBED" | "OTHER" | "SIZE_TOO_LARGE" | "SIZE_TOO_SMALL" | "STYLE" | "UNKNOWN" | "UNWANTED" | "WRONG_ITEM";
export async function createReturn(client: AdminClient, input: { orderId: string; lineItems: Array<{ fulfillmentLineItemId: string; quantity: number; returnReason: ReturnReason; returnReasonNote?: string }>; notifyCustomer?: boolean }): Promise<{ return?: { id: string; status: string; name?: string }; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation ReturnCreate($returnInput: ReturnInput!) { returnCreate(returnInput: $returnInput) { return { id status name } userErrors { field message } } }`, { returnInput: { orderId: input.orderId, returnLineItems: input.lineItems, notifyCustomer: input.notifyCustomer ?? false } });
  return unwrap(res, (d) => ({ return: d.returnCreate.return ?? undefined, userErrors: userErrors(d.returnCreate) }));
}
export async function listReturns(client: AdminClient, orderId: string): Promise<Array<{ id: string; status: string; name?: string; totalQuantity?: number }>> {
  const res = await client.query(/* GraphQL */ `query OrderReturns($id: ID!) { order(id: $id) { returns(first: 20) { nodes { id status name totalQuantity } } } }`, { id: orderId });
  return unwrap(res, (d) => d.order?.returns?.nodes ?? []);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export interface CustomerSummary {
  id: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  numberOfOrders?: string | number;
  amountSpent?: { amount: string; currencyCode: string };
  tags: string[];
  state?: string;
  createdAt?: string;
  note?: string | null;
  defaultAddress?: { city?: string; province?: string; country?: string } | null;
}
const CUSTOMER_FIELDS = /* GraphQL */ `id displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } numberOfOrders amountSpent { amount currencyCode } tags state createdAt note defaultAddress { city province country }`;
const toCustomer = (c: any): CustomerSummary => ({ id: c.id, displayName: c.displayName, email: c.defaultEmailAddress?.emailAddress ?? c.email ?? null, phone: c.defaultPhoneNumber?.phoneNumber ?? c.phone ?? null, numberOfOrders: c.numberOfOrders, amountSpent: c.amountSpent, tags: c.tags ?? [], state: c.state, createdAt: c.createdAt, note: c.note, defaultAddress: c.defaultAddress });
export async function listCustomers(client: AdminClient, opts: PageOpts = {}): Promise<Page<CustomerSummary>> {
  const res = await client.query(/* GraphQL */ `query CustomersList($first: Int!, $after: String, $query: String) { customers(first: $first, after: $after, query: $query) { nodes { ${CUSTOMER_FIELDS} } pageInfo { hasNextPage endCursor } } }`, pageArgs(opts));
  return unwrap(res, (d) => { const p = conn<any>(d.customers); return { ...p, items: p.items.map(toCustomer) }; });
}
export async function getCustomer(client: AdminClient, id: string): Promise<(CustomerSummary & { recentOrders: OrderSummary[] }) | null> {
  const res = await client.query(/* GraphQL */ `query CustomerGet($id: ID!) { customer(id: $id) { ${CUSTOMER_FIELDS} orders(first: 10, sortKey: PROCESSED_AT, reverse: true) { nodes { ${ORDER_SUMMARY_FIELDS} } } } }`, { id });
  return unwrap(res, (d) => (d.customer ? { ...toCustomer(d.customer), recentOrders: (d.customer.orders?.nodes ?? []).map(toOrderSummary) } : null));
}
export async function updateCustomer(client: AdminClient, id: string, input: { tags?: string[]; note?: string; firstName?: string; lastName?: string }): Promise<{ customer?: CustomerSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation CustomerUpdate($input: CustomerInput!) { customerUpdate(input: $input) { customer { ${CUSTOMER_FIELDS} } userErrors { field message } } }`, { input: { id, ...input } });
  return unwrap(res, (d) => ({ customer: d.customerUpdate.customer ? toCustomer(d.customerUpdate.customer) : undefined, userErrors: userErrors(d.customerUpdate) }));
}
export async function createCustomer(client: AdminClient, input: { email?: string; phone?: string; firstName?: string; lastName?: string; tags?: string[]; note?: string }): Promise<{ customer?: CustomerSummary; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation CustomerCreate($input: CustomerInput!) { customerCreate(input: $input) { customer { ${CUSTOMER_FIELDS} } userErrors { field message } } }`, { input });
  return unwrap(res, (d) => ({ customer: d.customerCreate.customer ? toCustomer(d.customerCreate.customer) : undefined, userErrors: userErrors(d.customerCreate) }));
}
