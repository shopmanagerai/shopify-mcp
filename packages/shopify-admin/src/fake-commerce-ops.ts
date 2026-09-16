/**
 * Fake handlers for operations/commerce-ops.ts (Phase 5). Dispatched from
 * FakeAdminClient.dispatch before the main switch. State lives in
 * `store.commerce` so the catalog fakes stay untouched.
 */
import type { FakeAdminStore } from "./fake.js";

export interface FakeCommerceStore {
  locations: Array<{ id: string; name: string; isActive: boolean }>;
  /** key `${inventoryItemId}|${locationId}` → quantities by name */
  inventory: Map<string, Record<string, number>>;
  /** variantId → inventoryItemId */
  inventoryItems: Map<string, { id: string; variantId: string; tracked: boolean; sku?: string; cost?: string }>;
  markets: Map<string, { id: string; name: string; handle: string; status: string; primary: boolean; regions: string[]; baseCurrency: string; localCurrencies: boolean; webPresences: Array<{ id: string; host?: string; defaultLocale: string; alternateLocales: string[] }>; catalogIds: string[] }>;
  locales: Array<{ locale: string; name: string; primary: boolean; published: boolean }>;
  /** resourceId → locale → key → value */
  translations: Map<string, Map<string, Map<string, string>>>;
  catalogs: Map<string, { id: string; title: string; status: string; marketIds: string[]; priceListId?: string; publicationId?: string }>;
  priceLists: Map<string, { id: string; name: string; currency: string; catalogId?: string; adjustment: { type: string; value: number }; fixed: Map<string, { amount: string; currencyCode: string; compareAt?: { amount: string; currencyCode: string } }> }>;
  discounts: Map<string, { id: string; kind: string; title: string; status: string; startsAt: string; endsAt?: string | null; usageLimit?: number | null; codes: string[]; summary?: string }>;
  orders: Map<string, { id: string; name: string; createdAt: string; financialStatus: string; fulfillmentStatus: string; total: string; currency: string; customerId?: string; email?: string; tags: string[]; note?: string; closed: boolean; cancelledAt?: string | null; lineItems: Array<{ id: string; title: string; sku?: string; quantity: number; variantId?: string; price: string }>; fulfillmentOrders: Array<{ id: string; status: string; locationId: string; lineItems: Array<{ id: string; lineItemId: string; remaining: number; total: number }> }>; fulfillments: Array<{ id: string; status: string; createdAt: string; tracking?: { number?: string; company?: string } }>; returns: Array<{ id: string; status: string; name: string; totalQuantity: number }> }>;
  draftOrders: Map<string, { id: string; name: string; status: string; createdAt: string; email?: string; customerId?: string; note?: string; tags: string[]; total: string; currency: string; orderId?: string; lineItems: Array<{ title: string; quantity: number; variantId?: string; sku?: string; price: string }> }>;
  customers: Map<string, { id: string; firstName?: string; lastName?: string; email?: string; phone?: string; tags: string[]; note?: string; state: string; createdAt: string; orderIds: string[] }>;
}

export function emptyCommerceStore(): FakeCommerceStore {
  return { locations: [], inventory: new Map(), inventoryItems: new Map(), markets: new Map(), locales: [], translations: new Map(), catalogs: new Map(), priceLists: new Map(), discounts: new Map(), orders: new Map(), draftOrders: new Map(), customers: new Map() };
}

const gid = (type: string, id: string) => `gid://shopify/${type}/${id}`;
function nextId(store: FakeAdminStore, kind: string): string {
  const n = (store.counters[kind] ?? 0) + 1;
  store.counters[kind] = n;
  return String(n);
}
const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (amount: string | number, currencyCode = "USD") => ({ amount: typeof amount === "number" ? amount.toFixed(2) : amount, currencyCode });
const page = <T>(all: T[], vars: { first?: number; after?: string }) => {
  const start = vars.after ? Number(vars.after) : 0;
  const first = vars.first ?? 50;
  const items = all.slice(start, start + first);
  const end = start + items.length;
  return { nodes: items, pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null } };
};

/** Seeds locations, inventory for every variant, locales, a market, customers, orders and a discount on top of the demo catalog. */
export function seedDemoCommerce(store: FakeAdminStore): void {
  const c = store.commerce;
  const loc = gid("Location", nextId(store, "location"));
  c.locations.push({ id: loc, name: "Main warehouse", isActive: true });
  const loc2 = gid("Location", nextId(store, "location"));
  c.locations.push({ id: loc2, name: "Retail store", isActive: true });
  for (const v of store.variants.values()) {
    const itemId = gid("InventoryItem", nextId(store, "inventoryItem"));
    c.inventoryItems.set(v.id, { id: itemId, variantId: v.id, tracked: true, sku: v.sku });
    c.inventory.set(`${itemId}|${loc}`, { available: v.inventoryQuantity ?? 10, on_hand: v.inventoryQuantity ?? 10, committed: 0 });
  }
  c.locales = [{ locale: "en", name: "English", primary: true, published: true }, { locale: "fr", name: "French", primary: false, published: false }];
  const m = gid("Market", nextId(store, "market"));
  c.markets.set(m, { id: m, name: "United States", handle: "us", status: "ACTIVE", primary: true, regions: ["US"], baseCurrency: "USD", localCurrencies: false, webPresences: [{ id: gid("MarketWebPresence", "1"), host: "demo.myshopify.com", defaultLocale: "en", alternateLocales: [] }], catalogIds: [] });
  const cust = gid("Customer", nextId(store, "customer"));
  c.customers.set(cust, { id: cust, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", tags: ["vip"], state: "ENABLED", createdAt: "2026-01-02T00:00:00.000Z", orderIds: [] });
  const [v1, v2] = [...store.variants.values()];
  if (v1) {
    const oid = gid("Order", nextId(store, "order"));
    const li = gid("LineItem", nextId(store, "lineItem"));
    const fo = gid("FulfillmentOrder", nextId(store, "fulfillmentOrder"));
    c.orders.set(oid, { id: oid, name: "#1001", createdAt: "2026-02-01T00:00:00.000Z", financialStatus: "PAID", fulfillmentStatus: "UNFULFILLED", total: v1.price ?? "10.00", currency: "USD", customerId: cust, email: "ada@example.com", tags: [], closed: false, lineItems: [{ id: li, title: v1.title, sku: v1.sku, quantity: 1, variantId: v1.id, price: v1.price ?? "10.00" }], fulfillmentOrders: [{ id: fo, status: "OPEN", locationId: loc, lineItems: [{ id: gid("FulfillmentOrderLineItem", nextId(store, "foli")), lineItemId: li, remaining: 1, total: 1 }] }], fulfillments: [], returns: [] });
    c.customers.get(cust)!.orderIds.push(oid);
  }
  if (v2) {
    const oid = gid("Order", nextId(store, "order"));
    c.orders.set(oid, { id: oid, name: "#1002", createdAt: "2026-02-03T00:00:00.000Z", financialStatus: "PAID", fulfillmentStatus: "FULFILLED", total: v2.price ?? "20.00", currency: "USD", customerId: cust, email: "ada@example.com", tags: ["wholesale"], closed: false, lineItems: [{ id: gid("LineItem", nextId(store, "lineItem")), title: v2.title, sku: v2.sku, quantity: 2, variantId: v2.id, price: v2.price ?? "20.00" }], fulfillmentOrders: [], fulfillments: [{ id: gid("Fulfillment", nextId(store, "fulfillment")), status: "SUCCESS", createdAt: "2026-02-04T00:00:00.000Z", tracking: { number: "TRACK1", company: "UPS" } }], returns: [] });
    c.customers.get(cust)!.orderIds.push(oid);
  }
  const d = gid("DiscountCodeNode", nextId(store, "discount"));
  c.discounts.set(d, { id: d, kind: "DiscountCodeBasic", title: "WELCOME10", status: "ACTIVE", startsAt: "2026-01-01T00:00:00.000Z", endsAt: null, usageLimit: null, codes: ["WELCOME10"], summary: "10% off entire order" });
}

const marketOut = (m: NonNullable<ReturnType<FakeCommerceStore["markets"]["get"]>>) => ({ id: m.id, name: m.name, handle: m.handle, status: m.status, primary: m.primary, type: "REGION", conditions: { regionsCondition: { regions: { nodes: m.regions.map((code) => ({ code })) } } }, currencySettings: { baseCurrency: { currencyCode: m.baseCurrency }, localCurrencies: m.localCurrencies }, webPresences: { nodes: m.webPresences.map((w) => ({ id: w.id, domain: w.host ? { host: w.host } : null, defaultLocale: { locale: w.defaultLocale }, alternateLocales: w.alternateLocales.map((l) => ({ locale: l })), rootUrls: [{ locale: w.defaultLocale, url: `https://${w.host ?? "demo.myshopify.com"}/` }] })) }, catalogs: { nodes: m.catalogIds.map((id) => ({ id })) } });
const catalogOut = (c: NonNullable<ReturnType<FakeCommerceStore["catalogs"]["get"]>>) => ({ __typename: "MarketCatalog", id: c.id, title: c.title, status: c.status, priceList: c.priceListId ? { id: c.priceListId } : null, publication: c.publicationId ? { id: c.publicationId } : null, markets: { nodes: c.marketIds.map((id) => ({ id })) } });
const priceListOut = (p: NonNullable<ReturnType<FakeCommerceStore["priceLists"]["get"]>>) => ({ id: p.id, name: p.name, currency: p.currency, catalog: p.catalogId ? { id: p.catalogId } : null, parent: { adjustment: p.adjustment }, fixedPricesCount: p.fixed.size });
const discountOut = (d: NonNullable<ReturnType<FakeCommerceStore["discounts"]["get"]>>) => ({ __typename: d.kind, title: d.title, status: d.status, summary: d.summary, startsAt: d.startsAt, endsAt: d.endsAt ?? null, usageLimit: d.usageLimit ?? null, asyncUsageCount: 0, combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, codes: { nodes: d.codes.map((code) => ({ code })) } });
function customerOut(c: NonNullable<ReturnType<FakeCommerceStore["customers"]["get"]>>, s: FakeAdminStore) {
  const orders = c.orderIds.map((id) => s.commerce.orders.get(id)!).filter(Boolean);
  const spent = orders.reduce((sum, o) => sum + Number(o.total), 0);
  return { id: c.id, displayName: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Customer", defaultEmailAddress: c.email ? { emailAddress: c.email } : null, defaultPhoneNumber: c.phone ? { phoneNumber: c.phone } : null, numberOfOrders: String(orders.length), amountSpent: money(spent), tags: c.tags, state: c.state, createdAt: c.createdAt, note: c.note ?? null, defaultAddress: null };
}
function orderSummaryOut(o: NonNullable<ReturnType<FakeCommerceStore["orders"]["get"]>>, s: FakeAdminStore) {
  const cust = o.customerId ? s.commerce.customers.get(o.customerId) : undefined;
  return { id: o.id, name: o.name, createdAt: o.createdAt, displayFinancialStatus: o.financialStatus, displayFulfillmentStatus: o.fulfillmentStatus, tags: o.tags, note: o.note ?? null, email: o.email ?? null, totalPriceSet: { shopMoney: money(o.total, o.currency) }, customer: cust ? { id: cust.id, displayName: [cust.firstName, cust.lastName].filter(Boolean).join(" "), email: cust.email ?? null } : null, lineItemsProbe: { pageInfo: { hasNextPage: o.lineItems.length > 1 } } };
}
function draftOut(d: NonNullable<ReturnType<FakeCommerceStore["draftOrders"]["get"]>>, s: FakeAdminStore) {
  const cust = d.customerId ? s.commerce.customers.get(d.customerId) : undefined;
  return { id: d.id, name: d.name, status: d.status, createdAt: d.createdAt, email: d.email ?? null, invoiceUrl: `https://demo.myshopify.com/invoices/${d.id.split("/").pop()}`, tags: d.tags, totalPriceSet: { shopMoney: money(d.total, d.currency) }, customer: cust ? { id: cust.id, displayName: [cust.firstName, cust.lastName].filter(Boolean).join(" ") } : null, order: d.orderId ? { id: d.orderId } : null, lineItems: { nodes: d.lineItems.map((l) => ({ title: l.title, quantity: l.quantity, sku: l.sku ?? null, variant: l.variantId ? { id: l.variantId } : null })) } };
}
const matchQuery = (q: string | undefined, hay: string) => !q || q.split(/\s+/).every((term) => /:[<>]/.test(term) || hay.toLowerCase().includes(term.replace(/^[a-z_]+:/, "").replace(/^['"]|['"]$/g, "").toLowerCase()));

export function dispatchCommerceOps(s: FakeAdminStore, name: string, vars: Record<string, any>): unknown | undefined {
  const c = s.commerce;
  switch (name) {
    // ---- locations / inventory ----
    case "LocationsList":
      return { locations: page(c.locations.filter((l) => vars.includeInactive || l.isActive).map((l) => ({ ...l, fulfillsOnlineOrders: true, shipsInventory: true, address: { city: "Demo", country: "United States", countryCode: "US" } })), vars) };
    case "ProductInventory": {
      const p = s.products.get(vars.id);
      if (!p) return { product: null };
      return { product: { id: p.id, title: p.title, variants: { nodes: p.variantIds.map((vid) => { const v = s.variants.get(vid)!; const item = c.inventoryItems.get(vid); const levels = item ? [...c.inventory.entries()].filter(([k]) => k.startsWith(item.id + "|")).map(([k, q]) => { const locId = k.split("|")[1]!; return { location: { id: locId, name: c.locations.find((l) => l.id === locId)?.name ?? "?" }, quantities: (vars.names as string[]).map((n) => ({ name: n, quantity: q[n] ?? 0 })) }; }) : []; return { id: v.id, title: v.title, sku: v.sku ?? null, inventoryItem: item ? { id: item.id, tracked: item.tracked, inventoryLevels: { nodes: levels } } : null }; }) } } };
    }
    case "InventorySetQuantities":
    case "InventoryAdjustQuantities": {
      const input = vars.input;
      const nm = input.name ?? "available";
      const changes: unknown[] = [];
      const errs: Array<{ field: string[]; message: string }> = [];
      const rows = (input.quantities ?? input.changes) as any[];
      for (const q of rows) {
        const key = `${q.inventoryItemId}|${q.locationId}`;
        const cur = c.inventory.get(key);
        if (!cur) { errs.push({ field: ["quantities"], message: `Inventory item ${q.inventoryItemId} is not stocked at ${q.locationId}.` }); continue; }
        const before = cur[nm] ?? 0;
        if (q.changeFromQuantity !== undefined && q.changeFromQuantity !== before) { errs.push({ field: ["changeFromQuantity"], message: `changeFromQuantity ${q.changeFromQuantity} does not match current ${before}.` }); continue; }
        const after = name === "InventorySetQuantities" ? q.quantity : before + q.delta;
        cur[nm] = after;
        if (nm === "available") cur.on_hand = (cur.on_hand ?? 0) + (after - before);
        const v = [...c.inventoryItems.values()].find((i) => i.id === q.inventoryItemId);
        if (v) { const fv = s.variants.get(v.variantId); if (fv) fv.inventoryQuantity = after; const fp = fv && s.products.get(fv.productId); if (fp) fp.totalInventory = fp.variantIds.reduce((sum, id) => sum + (s.variants.get(id)?.inventoryQuantity ?? 0), 0); }
        changes.push({ name: nm, delta: after - before, quantityAfterChange: after, item: { id: q.inventoryItemId }, location: { id: q.locationId } });
      }
      const payload = errs.length ? { inventoryAdjustmentGroup: null, userErrors: errs } : { inventoryAdjustmentGroup: { id: gid("InventoryAdjustmentGroup", nextId(s, "iag")), changes }, userErrors: [] };
      return name === "InventorySetQuantities" ? { inventorySetQuantities: payload } : { inventoryAdjustQuantities: payload };
    }
    case "InventoryItemUpdate": {
      const item = [...c.inventoryItems.values()].find((i) => i.id === vars.id);
      if (!item) return { inventoryItemUpdate: { inventoryItem: null, userErrors: [{ field: ["id"], message: "Inventory item not found." }] } };
      Object.assign(item, { tracked: vars.input.tracked ?? item.tracked, sku: vars.input.sku ?? item.sku, cost: vars.input.cost ?? item.cost });
      return { inventoryItemUpdate: { inventoryItem: { id: item.id, tracked: item.tracked, sku: item.sku ?? null, unitCost: item.cost ? { amount: item.cost } : null }, userErrors: [] } };
    }
    case "InventoryActivate": {
      const key = `${vars.inventoryItemId}|${vars.locationId}`;
      if (!c.inventory.has(key)) c.inventory.set(key, { available: vars.available ?? 0, on_hand: vars.available ?? 0, committed: 0 });
      return { inventoryActivate: { inventoryLevel: { id: gid("InventoryLevel", nextId(s, "invLevel")) }, userErrors: [] } };
    }
    // ---- markets ----
    case "MarketsList":
      return { markets: page([...c.markets.values()].filter((m) => matchQuery(vars.query, m.name + " " + m.handle)).map(marketOut), vars) };
    case "MarketGet": {
      const m = c.markets.get(vars.id);
      return { market: m ? marketOut(m) : null };
    }
    case "MarketCreate": {
      const i = vars.input;
      if ([...c.markets.values()].some((m) => m.handle === (i.handle ?? slug(i.name)))) return { marketCreate: { market: null, userErrors: [{ field: ["handle"], message: "Handle has already been taken." }] } };
      const id = gid("Market", nextId(s, "market"));
      const m = { id, name: i.name, handle: i.handle ?? slug(i.name), status: i.status ?? "DRAFT", primary: false, regions: (i.conditions?.regionsCondition?.regions ?? []).map((r: any) => r.countryCode), baseCurrency: i.currencySettings?.baseCurrency ?? "USD", localCurrencies: !!i.currencySettings?.localCurrencies, webPresences: [], catalogIds: [] };
      c.markets.set(id, m);
      return { marketCreate: { market: marketOut(m), userErrors: [] } };
    }
    case "MarketUpdate": {
      const m = c.markets.get(vars.id);
      if (!m) return { marketUpdate: { market: null, userErrors: [{ field: ["id"], message: "Market not found." }] } };
      const i = vars.input;
      if (i.name) m.name = i.name;
      if (i.handle) m.handle = i.handle;
      if (i.status) m.status = i.status;
      for (const r of i.conditions?.regionsCondition?.regionsToAdd ?? []) if (!m.regions.includes(r.countryCode)) m.regions.push(r.countryCode);
      return { marketUpdate: { market: marketOut(m), userErrors: [] } };
    }
    case "MarketDelete": {
      const m = c.markets.get(vars.id);
      if (!m) return { marketDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "Market not found." }] } };
      if (m.primary) return { marketDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "The primary market cannot be deleted." }] } };
      c.markets.delete(vars.id);
      return { marketDelete: { deletedId: vars.id, userErrors: [] } };
    }
    // ---- locales / translations ----
    case "ShopLocales":
      return { shopLocales: c.locales };
    case "ShopLocaleEnable": {
      if (c.locales.some((l) => l.locale === vars.locale)) return { shopLocaleEnable: { shopLocale: null, userErrors: [{ field: ["locale"], message: "Locale is already enabled." }] } };
      const l = { locale: vars.locale, name: vars.locale.toUpperCase(), primary: false, published: false };
      c.locales.push(l);
      return { shopLocaleEnable: { shopLocale: l, userErrors: [] } };
    }
    case "ShopLocaleUpdate": {
      const l = c.locales.find((x) => x.locale === vars.locale);
      if (!l) return { shopLocaleUpdate: { shopLocale: null, userErrors: [{ field: ["locale"], message: "Locale is not enabled." }] } };
      if (vars.shopLocale.published !== undefined) l.published = vars.shopLocale.published;
      return { shopLocaleUpdate: { shopLocale: l, userErrors: [] } };
    }
    case "ShopLocaleDisable": {
      const l = c.locales.find((x) => x.locale === vars.locale);
      if (!l) return { shopLocaleDisable: { locale: null, userErrors: [{ field: ["locale"], message: "Locale is not enabled." }] } };
      if (l.primary) return { shopLocaleDisable: { locale: null, userErrors: [{ field: ["locale"], message: "The primary locale cannot be disabled." }] } };
      c.locales = c.locales.filter((x) => x.locale !== vars.locale);
      return { shopLocaleDisable: { locale: vars.locale, userErrors: [] } };
    }
    case "TranslatableResourceGet":
    case "TranslatableResourcesList": {
      const build = (resourceId: string) => {
        const content = translatableContent(s, resourceId);
        const tr = vars.withTranslations ? [...(c.translations.get(resourceId)?.get(vars.locale)?.entries() ?? [])].map(([key, value]) => ({ key, value, locale: vars.locale, outdated: false, market: null })) : [];
        return { resourceId, translatableContent: content, translations: tr };
      };
      if (name === "TranslatableResourceGet") return { translatableResource: translatableContent(s, vars.id).length ? build(vars.id) : null };
      const ids = resourceIdsForType(s, vars.type);
      return { translatableResources: page(ids.map(build), vars) };
    }
    case "TranslationsRegister": {
      const content = translatableContent(s, vars.resourceId);
      if (!content.length) return { translationsRegister: { translations: [], userErrors: [{ field: ["resourceId"], message: "Resource not found or not translatable." }] } };
      const errs: Array<{ field: string[]; message: string }> = [];
      const out: unknown[] = [];
      for (const t of vars.translations as any[]) {
        const src = content.find((x) => x.key === t.key);
        if (!src) { errs.push({ field: ["translations", "key"], message: `Unknown translatable key "${t.key}".` }); continue; }
        if (src.digest !== t.translatableContentDigest) { errs.push({ field: ["translations", "translatableContentDigest"], message: `Digest for "${t.key}" is stale; re-read the resource.` }); continue; }
        if (!c.translations.has(vars.resourceId)) c.translations.set(vars.resourceId, new Map());
        const byLocale = c.translations.get(vars.resourceId)!;
        if (!byLocale.has(t.locale)) byLocale.set(t.locale, new Map());
        byLocale.get(t.locale)!.set(t.key, t.value);
        out.push({ key: t.key, value: t.value, locale: t.locale, outdated: false });
      }
      return { translationsRegister: { translations: out, userErrors: errs } };
    }
    case "TranslationsRemove": {
      const byLocale = c.translations.get(vars.resourceId);
      const removed: unknown[] = [];
      for (const loc of vars.locales as string[]) for (const key of vars.translationKeys as string[]) { const v = byLocale?.get(loc)?.get(key); if (v !== undefined) { byLocale!.get(loc)!.delete(key); removed.push({ key, value: v, locale: loc }); } }
      return { translationsRemove: { translations: removed, userErrors: [] } };
    }
    // ---- catalogs / price lists ----
    case "CatalogsList":
      return { catalogs: page([...c.catalogs.values()].map(catalogOut), vars) };
    case "CatalogCreate": {
      const id = gid("MarketCatalog", nextId(s, "catalog"));
      const cat = { id, title: vars.input.title, status: vars.input.status ?? "DRAFT", marketIds: vars.input.context?.marketIds ?? [], priceListId: vars.input.priceListId, publicationId: vars.input.publicationId };
      c.catalogs.set(id, cat);
      for (const m of cat.marketIds) c.markets.get(m)?.catalogIds.push(id);
      return { catalogCreate: { catalog: catalogOut(cat), userErrors: [] } };
    }
    case "CatalogUpdate": {
      const cat = c.catalogs.get(vars.id);
      if (!cat) return { catalogUpdate: { catalog: null, userErrors: [{ field: ["id"], message: "Catalog not found." }] } };
      Object.assign(cat, { title: vars.input.title ?? cat.title, status: vars.input.status ?? cat.status, priceListId: vars.input.priceListId ?? cat.priceListId, publicationId: vars.input.publicationId ?? cat.publicationId, marketIds: vars.input.context?.marketIds ?? cat.marketIds });
      return { catalogUpdate: { catalog: catalogOut(cat), userErrors: [] } };
    }
    case "CatalogDelete": {
      if (!c.catalogs.delete(vars.id)) return { catalogDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "Catalog not found." }] } };
      return { catalogDelete: { deletedId: vars.id, userErrors: [] } };
    }
    case "PriceListsList":
      return { priceLists: page([...c.priceLists.values()].map(priceListOut), vars) };
    case "PriceListPrices": {
      const p = c.priceLists.get(vars.id);
      if (!p) return { priceList: null };
      return { priceList: { prices: page([...p.fixed.entries()].map(([variantId, f]) => ({ variant: { id: variantId }, price: { amount: f.amount, currencyCode: f.currencyCode }, compareAtPrice: f.compareAt ?? null, originType: "FIXED" })), vars) } };
    }
    case "PriceListCreate": {
      const id = gid("PriceList", nextId(s, "priceList"));
      const p = { id, name: vars.input.name, currency: vars.input.currency, catalogId: vars.input.catalogId, adjustment: vars.input.parent.adjustment, fixed: new Map() };
      c.priceLists.set(id, p);
      if (p.catalogId) { const cat = c.catalogs.get(p.catalogId); if (cat) cat.priceListId = id; }
      return { priceListCreate: { priceList: priceListOut(p), userErrors: [] } };
    }
    case "PriceListDelete": {
      if (!c.priceLists.delete(vars.id)) return { priceListDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "Price list not found." }] } };
      return { priceListDelete: { deletedId: vars.id, userErrors: [] } };
    }
    case "PriceListFixedPricesAdd": {
      const p = c.priceLists.get(vars.priceListId);
      if (!p) return { priceListFixedPricesAdd: { prices: [], userErrors: [{ field: ["priceListId"], message: "Price list not found." }] } };
      const out: unknown[] = [];
      for (const pr of vars.prices as any[]) {
        if (!s.variants.has(pr.variantId)) return { priceListFixedPricesAdd: { prices: [], userErrors: [{ field: ["prices", "variantId"], message: `Variant ${pr.variantId} not found.` }] } };
        if (pr.price.currencyCode !== p.currency) return { priceListFixedPricesAdd: { prices: [], userErrors: [{ field: ["prices", "price"], message: `Currency must be ${p.currency}.` }] } };
        p.fixed.set(pr.variantId, { amount: pr.price.amount, currencyCode: pr.price.currencyCode, compareAt: pr.compareAtPrice });
        out.push({ variant: { id: pr.variantId }, price: pr.price });
      }
      return { priceListFixedPricesAdd: { prices: out, userErrors: [] } };
    }
    case "PriceListFixedPricesDelete": {
      const p = c.priceLists.get(vars.priceListId);
      if (!p) return { priceListFixedPricesDelete: { deletedFixedPriceVariantIds: [], userErrors: [{ field: ["priceListId"], message: "Price list not found." }] } };
      const deleted = (vars.variantIds as string[]).filter((v) => p.fixed.delete(v));
      return { priceListFixedPricesDelete: { deletedFixedPriceVariantIds: deleted, userErrors: [] } };
    }
    // ---- discounts ----
    case "DiscountsList":
      return { discountNodes: page([...c.discounts.values()].filter((d) => matchQuery(vars.query, d.title + " " + d.status + " " + d.codes.join(" "))).map((d) => ({ id: d.id, discount: discountOut(d) })), vars) };
    case "DiscountGet": {
      const d = c.discounts.get(vars.id);
      return { discountNode: d ? { id: d.id, discount: discountOut(d) } : null };
    }
    case "DiscountCodeBasicCreate":
    case "DiscountCodeFreeShippingCreate":
    case "DiscountAutomaticBasicCreate": {
      const i = vars.basicCodeDiscount ?? vars.freeShippingCodeDiscount ?? vars.automaticBasicDiscount;
      const isCode = name !== "DiscountAutomaticBasicCreate";
      const errKey = name === "DiscountCodeBasicCreate" ? "discountCodeBasicCreate" : name === "DiscountCodeFreeShippingCreate" ? "discountCodeFreeShippingCreate" : "discountAutomaticBasicCreate";
      if (isCode && [...c.discounts.values()].some((d) => d.codes.includes(i.code))) return { [errKey]: { codeDiscountNode: null, automaticDiscountNode: null, userErrors: [{ field: ["code"], message: "Code has already been taken.", code: "TAKEN" }] } };
      if (name === "DiscountCodeBasicCreate" && !i.customerGets?.value) return { [errKey]: { codeDiscountNode: null, userErrors: [{ field: ["customerGets", "value"], message: "Value can't be blank.", code: "BLANK" }] } };
      const kind = name === "DiscountCodeBasicCreate" ? "DiscountCodeBasic" : name === "DiscountCodeFreeShippingCreate" ? "DiscountCodeFreeShipping" : "DiscountAutomaticBasic";
      const id = gid(isCode ? "DiscountCodeNode" : "DiscountAutomaticNode", nextId(s, "discount"));
      const pct = i.customerGets?.value?.percentage;
      const amt = i.customerGets?.value?.discountAmount?.amount;
      const d = { id, kind, title: i.title, status: "ACTIVE", startsAt: i.startsAt, endsAt: i.endsAt ?? null, usageLimit: i.usageLimit ?? null, codes: isCode ? [i.code] : [], summary: kind === "DiscountCodeFreeShipping" ? "Free shipping" : pct !== undefined ? `${Math.round(pct * 100)}% off` : amt ? `${amt} off` : undefined };
      c.discounts.set(id, d);
      const node = { id, codeDiscount: discountOut(d), automaticDiscount: discountOut(d) };
      return { [errKey]: { codeDiscountNode: isCode ? node : null, automaticDiscountNode: isCode ? null : node, userErrors: [] } };
    }
    case "DiscountCodeActivate":
    case "DiscountCodeDeactivate":
    case "DiscountAutomaticActivate":
    case "DiscountAutomaticDeactivate": {
      const key = name[0]!.toLowerCase() + name.slice(1);
      const d = c.discounts.get(vars.id);
      if (!d) return { [key]: { codeDiscountNode: null, automaticDiscountNode: null, userErrors: [{ field: ["id"], message: "Discount not found." }] } };
      d.status = /Activate$/.test(name) ? "ACTIVE" : "EXPIRED";
      const node = { id: d.id, codeDiscount: { status: d.status }, automaticDiscount: { status: d.status } };
      return { [key]: { codeDiscountNode: name.startsWith("DiscountCode") ? node : null, automaticDiscountNode: name.startsWith("DiscountCode") ? null : node, userErrors: [] } };
    }
    case "DiscountCodeDelete":
    case "DiscountAutomaticDelete": {
      const key = name[0]!.toLowerCase() + name.slice(1);
      if (!c.discounts.delete(vars.id)) return { [key]: { deletedCodeDiscountId: null, userErrors: [{ field: ["id"], message: "Discount not found." }] } };
      return { [key]: { deletedCodeDiscountId: vars.id, userErrors: [] } };
    }
    // ---- orders ----
    case "OrdersList": {
      const all = [...c.orders.values()].filter((o) => matchQuery(vars.query, `${o.name} ${o.financialStatus} ${o.fulfillmentStatus} ${o.tags.join(" ")} ${o.email ?? ""}`)).sort((a, b) => (vars.reverse === false ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
      return { orders: page(all.map((o) => orderSummaryOut(o, s)), vars) };
    }
    case "OrderGet": {
      const o = c.orders.get(vars.id);
      if (!o) return { order: null };
      const total = Number(o.total);
      return { order: { ...orderSummaryOut(o, s), cancelledAt: o.cancelledAt ?? null, closed: o.closed, subtotalPriceSet: { shopMoney: money(total, o.currency) }, totalShippingPriceSet: { shopMoney: money(0, o.currency) }, totalTaxSet: { shopMoney: money(0, o.currency) }, discountCodes: [], shippingAddress: { city: "Demo", province: "CA", country: "United States", zip: "90001" }, lineItems: { nodes: o.lineItems.map((l) => ({ id: l.id, title: l.title, sku: l.sku ?? null, quantity: l.quantity, variant: l.variantId ? { id: l.variantId } : null, originalUnitPriceSet: { shopMoney: money(l.price, o.currency) } })) }, fulfillmentOrders: { nodes: o.fulfillmentOrders.map((fo) => ({ id: fo.id, status: fo.status, requestStatus: "UNSUBMITTED", assignedLocation: { name: c.locations.find((l) => l.id === fo.locationId)?.name, location: { id: fo.locationId } }, lineItems: { nodes: fo.lineItems.map((l) => { const li = o.lineItems.find((x) => x.id === l.lineItemId); return { id: l.id, remainingQuantity: l.remaining, totalQuantity: l.total, lineItem: { id: l.lineItemId, title: li?.title, sku: li?.sku ?? null } }; }) } })) }, fulfillments: o.fulfillments.map((f) => ({ id: f.id, status: f.status, createdAt: f.createdAt, trackingInfo: f.tracking ? [f.tracking] : [] })) } };
    }
    case "OrderUpdate": {
      const o = c.orders.get(vars.input.id);
      if (!o) return { orderUpdate: { order: null, userErrors: [{ field: ["id"], message: "Order not found." }] } };
      if (vars.input.note !== undefined) o.note = vars.input.note;
      if (vars.input.tags !== undefined) o.tags = vars.input.tags;
      if (vars.input.email !== undefined) o.email = vars.input.email;
      return { orderUpdate: { order: orderSummaryOut(o, s), userErrors: [] } };
    }
    case "OrderClose": {
      const o = c.orders.get(vars.input.id);
      if (!o) return { orderClose: { order: null, userErrors: [{ field: ["id"], message: "Order not found." }] } };
      o.closed = true;
      return { orderClose: { order: { id: o.id, closed: true }, userErrors: [] } };
    }
    case "OrderCancel": {
      const o = c.orders.get(vars.orderId);
      if (!o) return { orderCancel: { job: null, orderCancelUserErrors: [{ field: ["orderId"], message: "Order not found.", code: "NOT_FOUND" }] } };
      if (o.fulfillmentStatus === "FULFILLED") return { orderCancel: { job: null, orderCancelUserErrors: [{ field: ["orderId"], message: "Fulfilled orders cannot be cancelled.", code: "INVALID" }] } };
      o.cancelledAt = new Date().toISOString();
      o.financialStatus = vars.refund ? "REFUNDED" : o.financialStatus;
      return { orderCancel: { job: { id: gid("Job", nextId(s, "job")) }, orderCancelUserErrors: [] } };
    }
    case "DraftOrdersList":
      return { draftOrders: page([...c.draftOrders.values()].filter((d) => matchQuery(vars.query, `${d.name} ${d.status} ${d.email ?? ""}`)).map((d) => draftOut(d, s)), vars) };
    case "DraftOrderCreate":
    case "DraftOrderUpdate": {
      const i = vars.input;
      const existing = name === "DraftOrderUpdate" ? c.draftOrders.get(vars.id) : undefined;
      if (name === "DraftOrderUpdate" && !existing) return { draftOrderUpdate: { draftOrder: null, userErrors: [{ field: ["id"], message: "Draft order not found." }] } };
      const lineItems = i.lineItems ? (i.lineItems as any[]).map((l) => { const v = l.variantId ? s.variants.get(l.variantId) : undefined; if (l.variantId && !v) return null; return { title: l.title ?? v?.title ?? "Custom item", quantity: l.quantity, variantId: l.variantId, sku: v?.sku, price: l.originalUnitPrice ?? v?.price ?? "0.00" }; }) : existing?.lineItems ?? [];
      if (lineItems.some((l) => l === null)) return { [name === "DraftOrderCreate" ? "draftOrderCreate" : "draftOrderUpdate"]: { draftOrder: null, userErrors: [{ field: ["lineItems", "variantId"], message: "Variant not found." }] } };
      if (i.customerId && !c.customers.has(i.customerId)) return { [name === "DraftOrderCreate" ? "draftOrderCreate" : "draftOrderUpdate"]: { draftOrder: null, userErrors: [{ field: ["customerId"], message: "Customer not found." }] } };
      const items = lineItems as Array<{ title: string; quantity: number; variantId?: string; sku?: string; price: string }>;
      let total = items.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0);
      if (i.appliedDiscount) total = i.appliedDiscount.valueType === "PERCENTAGE" ? total * (1 - i.appliedDiscount.value / 100) : Math.max(0, total - i.appliedDiscount.value);
      const d = existing ?? { id: gid("DraftOrder", nextId(s, "draftOrder")), name: `#D${nextId(s, "draftName")}`, status: "OPEN", createdAt: new Date().toISOString(), tags: [], total: "0", currency: "USD", lineItems: [] };
      Object.assign(d, { email: i.email ?? d.email, customerId: i.customerId ?? d.customerId, note: i.note ?? d.note, tags: i.tags ?? d.tags, lineItems: items, total: total.toFixed(2) });
      c.draftOrders.set(d.id, d);
      return { [name === "DraftOrderCreate" ? "draftOrderCreate" : "draftOrderUpdate"]: { draftOrder: draftOut(d, s), userErrors: [] } };
    }
    case "DraftOrderComplete": {
      const d = c.draftOrders.get(vars.id);
      if (!d) return { draftOrderComplete: { draftOrder: null, userErrors: [{ field: ["id"], message: "Draft order not found." }] } };
      if (d.status === "COMPLETED") return { draftOrderComplete: { draftOrder: null, userErrors: [{ field: ["id"], message: "Draft order is already completed." }] } };
      const oid = gid("Order", nextId(s, "order"));
      const lineItems = d.lineItems.map((l) => ({ id: gid("LineItem", nextId(s, "lineItem")), title: l.title, sku: l.sku, quantity: l.quantity, variantId: l.variantId, price: l.price }));
      const loc = c.locations[0]?.id ?? gid("Location", "1");
      c.orders.set(oid, { id: oid, name: `#${1000 + Number(oid.split("/").pop())}`, createdAt: new Date().toISOString(), financialStatus: vars.paymentPending ? "PENDING" : "PAID", fulfillmentStatus: "UNFULFILLED", total: d.total, currency: d.currency, customerId: d.customerId, email: d.email, tags: d.tags, closed: false, lineItems, fulfillmentOrders: [{ id: gid("FulfillmentOrder", nextId(s, "fulfillmentOrder")), status: "OPEN", locationId: loc, lineItems: lineItems.map((l) => ({ id: gid("FulfillmentOrderLineItem", nextId(s, "foli")), lineItemId: l.id, remaining: l.quantity, total: l.quantity })) }], fulfillments: [], returns: [] });
      if (d.customerId) c.customers.get(d.customerId)?.orderIds.push(oid);
      d.status = "COMPLETED";
      d.orderId = oid;
      return { draftOrderComplete: { draftOrder: { id: d.id, order: { id: oid } }, userErrors: [] } };
    }
    case "DraftOrderDelete": {
      if (!c.draftOrders.delete(vars.input.id)) return { draftOrderDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "Draft order not found." }] } };
      return { draftOrderDelete: { deletedId: vars.input.id, userErrors: [] } };
    }
    case "DraftOrderInvoiceSend": {
      const d = c.draftOrders.get(vars.id);
      if (!d) return { draftOrderInvoiceSend: { draftOrder: null, userErrors: [{ field: ["id"], message: "Draft order not found." }] } };
      return { draftOrderInvoiceSend: { draftOrder: { invoiceUrl: draftOut(d, s).invoiceUrl }, userErrors: [] } };
    }
    case "FulfillmentCreate": {
      const foId = vars.fulfillment.lineItemsByFulfillmentOrder[0].fulfillmentOrderId;
      const o = [...c.orders.values()].find((x) => x.fulfillmentOrders.some((fo) => fo.id === foId));
      const fo = o?.fulfillmentOrders.find((x) => x.id === foId);
      if (!o || !fo) return { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: ["fulfillmentOrderId"], message: "Fulfillment order not found." }] } };
      if (fo.status === "CLOSED") return { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: ["fulfillmentOrderId"], message: "Fulfillment order is already closed." }] } };
      const requested = vars.fulfillment.lineItemsByFulfillmentOrder[0].fulfillmentOrderLineItems as Array<{ id: string; quantity: number }> | undefined;
      for (const l of fo.lineItems) { const q = requested ? requested.find((r) => r.id === l.id)?.quantity ?? 0 : l.remaining; l.remaining = Math.max(0, l.remaining - q); }
      if (fo.lineItems.every((l) => l.remaining === 0)) fo.status = "CLOSED";
      o.fulfillmentStatus = o.fulfillmentOrders.every((x) => x.status === "CLOSED") ? "FULFILLED" : "PARTIALLY_FULFILLED";
      const f = { id: gid("Fulfillment", nextId(s, "fulfillment")), status: "SUCCESS", createdAt: new Date().toISOString(), tracking: vars.fulfillment.trackingInfo };
      o.fulfillments.push(f);
      return { fulfillmentCreate: { fulfillment: { id: f.id, status: f.status }, userErrors: [] } };
    }
    case "ReturnableFulfillments": {
      const o = c.orders.get(vars.orderId);
      if (!o) return { returnableFulfillments: { nodes: [] } };
      return { returnableFulfillments: { nodes: o.fulfillments.map((f) => ({ id: gid("ReturnableFulfillment", f.id.split("/").pop()!), fulfillment: { id: f.id }, returnableFulfillmentLineItems: { nodes: o.lineItems.map((l) => ({ quantity: l.quantity, fulfillmentLineItem: { id: gid("FulfillmentLineItem", l.id.split("/").pop()!), lineItem: { title: l.title, sku: l.sku ?? null } } })) } })) } };
    }
    case "ReturnCreate": {
      const o = c.orders.get(vars.returnInput.orderId);
      if (!o) return { returnCreate: { return: null, userErrors: [{ field: ["orderId"], message: "Order not found." }] } };
      if (!o.fulfillments.length) return { returnCreate: { return: null, userErrors: [{ field: ["orderId"], message: "Order has no fulfilled items to return." }] } };
      const r = { id: gid("Return", nextId(s, "return")), status: "OPEN", name: `${o.name}-R${o.returns.length + 1}`, totalQuantity: (vars.returnInput.returnLineItems as any[]).reduce((sum, l) => sum + l.quantity, 0) };
      o.returns.push(r);
      return { returnCreate: { return: r, userErrors: [] } };
    }
    case "OrderReturns": {
      const o = c.orders.get(vars.id);
      return { order: o ? { returns: { nodes: o.returns } } : null };
    }
    // ---- customers ----
    case "CustomersList":
      return { customers: page([...c.customers.values()].filter((x) => matchQuery(vars.query, `${x.firstName ?? ""} ${x.lastName ?? ""} ${x.email ?? ""} ${x.tags.join(" ")}`)).map((x) => customerOut(x, s)), vars) };
    case "CustomerGet": {
      const x = c.customers.get(vars.id);
      if (!x) return { customer: null };
      return { customer: { ...customerOut(x, s), orders: { nodes: x.orderIds.map((id) => c.orders.get(id)!).filter(Boolean).map((o) => orderSummaryOut(o, s)) } } };
    }
    case "CustomerUpdate": {
      const x = c.customers.get(vars.input.id);
      if (!x) return { customerUpdate: { customer: null, userErrors: [{ field: ["id"], message: "Customer not found." }] } };
      Object.assign(x, { tags: vars.input.tags ?? x.tags, note: vars.input.note ?? x.note, firstName: vars.input.firstName ?? x.firstName, lastName: vars.input.lastName ?? x.lastName });
      return { customerUpdate: { customer: customerOut(x, s), userErrors: [] } };
    }
    case "CustomerCreate": {
      if (vars.input.email && [...c.customers.values()].some((x) => x.email === vars.input.email)) return { customerCreate: { customer: null, userErrors: [{ field: ["email"], message: "Email has already been taken." }] } };
      const id = gid("Customer", nextId(s, "customer"));
      const x = { id, firstName: vars.input.firstName, lastName: vars.input.lastName, email: vars.input.email, phone: vars.input.phone, tags: vars.input.tags ?? [], note: vars.input.note, state: "DISABLED", createdAt: new Date().toISOString(), orderIds: [] };
      c.customers.set(id, x);
      return { customerCreate: { customer: customerOut(x, s), userErrors: [] } };
    }
    default:
      return undefined;
  }
}

function digest(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}
function translatableContent(s: FakeAdminStore, resourceId: string): Array<{ key: string; value: string; digest: string; locale: string }> {
  const mk = (pairs: Array<[string, string | undefined]>) => pairs.filter((p): p is [string, string] => !!p[1]).map(([key, value]) => ({ key, value, digest: digest(value), locale: "en" }));
  const p = s.products.get(resourceId);
  if (p) return mk([["title", p.title], ["body_html", p.descriptionHtml], ["handle", p.handle], ["meta_title", p.seo.title], ["meta_description", p.seo.description]]);
  const c = s.collections.get(resourceId);
  if (c) return mk([["title", c.title], ["body_html", c.descriptionHtml], ["handle", c.handle]]);
  const pg = s.pages.get(resourceId);
  if (pg) return mk([["title", pg.title], ["body_html", pg.body], ["handle", pg.handle]]);
  const a = s.articles.get(resourceId);
  if (a) return mk([["title", a.title], ["body_html", a.body], ["handle", a.handle]]);
  const m = s.menus.get(resourceId);
  if (m) return mk([["title", m.title]]);
  return [];
}
function resourceIdsForType(s: FakeAdminStore, type: string): string[] {
  switch (type) {
    case "PRODUCT": return [...s.products.keys()];
    case "COLLECTION": return [...s.collections.keys()];
    case "PAGE": return [...s.pages.keys()];
    case "ARTICLE": return [...s.articles.keys()];
    case "BLOG": return [...s.blogs.keys()];
    case "MENU": return [...s.menus.keys()];
    default: return [];
  }
}
