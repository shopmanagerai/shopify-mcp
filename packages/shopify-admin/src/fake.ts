/**
 * FakeAdminClient: an in-memory stand-in for `AdminClient` used by demo mode
 * and by @shopmanagerai/tools tests. It dispatches by detecting the GraphQL
 * operation name in the document text (never parses the document), and
 * returns response shapes matching the wrapper functions in `operations/*`.
 * Deterministic: no randomness, ids are sequential per collection.
 */
import type { AdminClient, GraphqlResult } from "@shopmanagerai/shared";
import { dispatchCatalogExtra } from "./fake-catalog-extra.js";
import { dispatchCommerceOps, emptyCommerceStore, seedDemoCommerce, type FakeCommerceStore } from "./fake-commerce-ops.js";
import { dispatchAdvanced, emptyAdvancedStore, seedDemoAdvanced, type FakeAdvancedStore } from "./fake-advanced.js";

// ---------------------------------------------------------------------------
// Store record shapes
// ---------------------------------------------------------------------------
export interface FakeVariant {
  id: string;
  productId: string;
  title: string;
  sku?: string;
  price?: string;
  compareAtPrice?: string;
  barcode?: string;
  inventoryQuantity?: number;
  selectedOptions?: Array<{ name: string; value: string }>;
}
export interface FakeProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor?: string;
  productType?: string;
  descriptionHtml?: string;
  tags: string[];
  templateSuffix?: string;
  seo: { title?: string; description?: string };
  variantIds: string[];
  mediaIds: string[];
  collectionIds: string[];
  publicationIds: Set<string>;
  updatedAt: string;
  totalInventory: number;
}
export interface FakeCollectionRule {
  column: string;
  relation: string;
  condition: string;
}
export interface FakeCollection {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string;
  updatedAt: string;
  seo: { title?: string; description?: string };
  image?: { id: string; url: string; altText?: string };
  ruleSet?: { appliedDisjunctively: boolean; rules: FakeCollectionRule[] };
  productIds: string[];
  metafieldIds: string[];
}
export interface FakePage {
  id: string;
  title: string;
  handle: string;
  body?: string;
  isPublished: boolean;
  templateSuffix?: string;
  seo: { title?: string; description?: string };
  updatedAt: string;
}
export interface FakeBlog {
  id: string;
  title: string;
  handle: string;
}
export interface FakeArticle {
  id: string;
  blogId: string;
  title: string;
  handle: string;
  body?: string;
  isPublished: boolean;
  seo: { title?: string; description?: string };
  updatedAt: string;
}
export interface FakeMenuItem {
  id: string;
  title: string;
  type: string;
  url?: string;
  resourceId?: string;
  tags?: string[];
  items: FakeMenuItem[];
}
export interface FakeMenu {
  id: string;
  handle: string;
  title: string;
  items: FakeMenuItem[];
}
export interface FakeMetafieldDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  type: string;
  ownerType: string;
}
export interface FakeMetafield {
  id: string;
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}
export interface FakeMetaobjectDefinition {
  id: string;
  type: string;
  name: string;
  fieldDefinitions: Array<{ key: string; name: string; type: string }>;
}
export interface FakeMetaobject {
  id: string;
  type: string;
  handle: string;
  fields: Array<{ key: string; value: string | null }>;
}
export interface FakeRedirect {
  id: string;
  path: string;
  target: string;
}
export interface FakeFile {
  id: string;
  alt?: string;
  url?: string;
  width?: number;
  height?: number;
}
export interface FakePublication {
  id: string;
  name: string;
}

export interface FakeAdminStore {
  products: Map<string, FakeProduct>;
  variants: Map<string, FakeVariant>;
  collections: Map<string, FakeCollection>;
  pages: Map<string, FakePage>;
  blogs: Map<string, FakeBlog>;
  articles: Map<string, FakeArticle>;
  menus: Map<string, FakeMenu>;
  metafieldDefinitions: FakeMetafieldDefinition[];
  metafields: Map<string, FakeMetafield[]>; // ownerId -> list
  metaobjectDefinitions: FakeMetaobjectDefinition[];
  metaobjects: Map<string, FakeMetaobject[]>; // type -> list
  redirects: Map<string, FakeRedirect>;
  files: Map<string, FakeFile>;
  publications: FakePublication[];
  counters: Record<string, number>;
  /** Content ingested for a staged upload, keyed by the upload's `key` parameter. Used by BulkRunner's bulk-operation path. */
  bulkUploads: Map<string, string>;
  /** The most recently started/completed bulk operation, if any. */
  bulkOperation: (BulkOperationRecord & { url?: string }) | null;
  /** Result JSONL text keyed by its (fake) result URL. */
  bulkResults: Map<string, string>;
  /** Phase 5 commerce state (inventory, markets, locales, translations, catalogs, discounts, orders, customers). */
  commerce: FakeCommerceStore;
  /** Phase 6 state (webhooks, pixel, script tags, functions, checkout profiles, flow). */
  advanced: FakeAdvancedStore;
}

export interface BulkOperationRecord {
  id: string;
  status: "COMPLETED" | "FAILED";
  objectCount?: number;
  errorCode?: string | null;
}

function nextId(store: FakeAdminStore, kind: string): string {
  const n = (store.counters[kind] ?? 0) + 1;
  store.counters[kind] = n;
  return String(n);
}
function gid(type: string, id: string): string {
  return `gid://shopify/${type}/${id}`;
}
function idFromGid(value: string): string {
  const parts = value.split("/");
  return parts[parts.length - 1] ?? value;
}

export function emptyStore(): FakeAdminStore {
  return {
    products: new Map(),
    variants: new Map(),
    collections: new Map(),
    pages: new Map(),
    blogs: new Map(),
    articles: new Map(),
    menus: new Map(),
    metafieldDefinitions: [],
    metafields: new Map(),
    metaobjectDefinitions: [],
    metaobjects: new Map(),
    redirects: new Map(),
    files: new Map(),
    publications: [],
    counters: {},
    bulkUploads: new Map(),
    bulkOperation: null,
    bulkResults: new Map(),
    commerce: emptyCommerceStore(),
    advanced: emptyAdvancedStore(),
  };
}

// ---------------------------------------------------------------------------
// Demo catalog seed: 12 products, 4 collections (2 smart/2 manual), 3 pages,
// 1 blog with 3 articles, main-menu + footer menus, metafield definitions,
// 1 metaobject definition + 2 entries, 5 redirects, Online Store publication.
// ---------------------------------------------------------------------------
export function seedDemoCatalog(): FakeAdminStore {
  const store = emptyStore();
  const now = "2026-01-01T00:00:00.000Z";

  const onlineStorePublication: FakePublication = { id: gid("Publication", "1"), name: "Online Store" };
  store.publications.push(onlineStorePublication);

  const productNames = [
    ["Classic Tee", "apparel"],
    ["Denim Jacket", "apparel"],
    ["Canvas Tote", "accessories"],
    ["Ceramic Mug", "home"],
    ["Wool Beanie", "apparel"],
    ["Leather Wallet", "accessories"],
    ["Linen Throw Pillow", "home"],
    ["Running Shorts", "apparel"],
    ["Enamel Water Bottle", "accessories"],
    ["Bamboo Cutting Board", "home"],
    ["Graphic Hoodie", "apparel"],
    ["Woven Belt", "accessories"],
  ] as const;

  const productIds: string[] = [];
  for (const [title, productType] of productNames) {
    const id = nextId(store, "product");
    const productGid = gid("Product", id);
    const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const variantId = gid("ProductVariant", nextId(store, "variant"));
    const variant: FakeVariant = {
      id: variantId,
      productId: productGid,
      title: "Default Title",
      sku: `SKU-${id}`,
      price: "29.99",
      compareAtPrice: undefined,
      barcode: `0${id}00000000`,
      inventoryQuantity: 100,
    };
    store.variants.set(variantId, variant);

    const mediaId = gid("MediaImage", nextId(store, "media"));
    store.files.set(mediaId, { id: mediaId, alt: `${title} product photo`, url: `https://cdn.example.com/${handle}.jpg`, width: 1024, height: 1024 });

    const product: FakeProduct = {
      id: productGid,
      title,
      handle,
      status: "ACTIVE",
      vendor: "ShopManager AI Demo",
      productType,
      descriptionHtml: `<p>${title} - demo catalog seed data.</p>`,
      tags: [productType, "demo"],
      templateSuffix: undefined,
      seo: { title, description: `Shop the ${title.toLowerCase()}.` },
      variantIds: [variantId],
      mediaIds: [mediaId],
      collectionIds: [],
      publicationIds: new Set([onlineStorePublication.id]),
      updatedAt: now,
      totalInventory: 100,
    };
    store.products.set(productGid, product);
    productIds.push(productGid);

    store.metafields.set(productGid, [
      { id: gid("Metafield", nextId(store, "metafield")), ownerId: productGid, namespace: "custom", key: "material", type: "single_line_text_field", value: "cotton" },
    ]);
  }

  // Collections: 2 manual, 2 smart.
  function makeCollection(title: string, opts: { manualProductIds?: string[]; ruleSet?: FakeCollection["ruleSet"] }): string {
    const id = nextId(store, "collection");
    const collectionGid = gid("Collection", id);
    const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const collection: FakeCollection = {
      id: collectionGid,
      title,
      handle,
      descriptionHtml: `<p>${title}</p>`,
      updatedAt: now,
      seo: { title, description: `${title} collection.` },
      productIds: opts.manualProductIds ?? [],
      ruleSet: opts.ruleSet,
      metafieldIds: [],
    };
    store.collections.set(collectionGid, collection);
    for (const pid of collection.productIds) {
      store.products.get(pid)?.collectionIds.push(collectionGid);
    }
    return collectionGid;
  }

  makeCollection("Best Sellers", { manualProductIds: productIds.slice(0, 4) });
  makeCollection("New Arrivals", { manualProductIds: productIds.slice(4, 7) });
  makeCollection("All Apparel", { ruleSet: { appliedDisjunctively: false, rules: [{ column: "TYPE", relation: "EQUALS", condition: "apparel" }] } });
  makeCollection("Home Goods", { ruleSet: { appliedDisjunctively: false, rules: [{ column: "TYPE", relation: "EQUALS", condition: "home" }] } });

  // Pages.
  const pageTitles = ["About Us", "Shipping & Returns", "Contact"];
  for (const title of pageTitles) {
    const id = nextId(store, "page");
    const pageGid = gid("Page", id);
    store.pages.set(pageGid, {
      id: pageGid,
      title,
      handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      body: `<p>${title} content.</p>`,
      isPublished: true,
      seo: { title, description: title },
      updatedAt: now,
    });
  }

  // Blog + 3 articles.
  const blogId = gid("Blog", nextId(store, "blog"));
  store.blogs.set(blogId, { id: blogId, title: "News", handle: "news" });
  const articleTitles = ["Welcome to our store", "Summer collection preview", "How we source materials"];
  for (const title of articleTitles) {
    const id = nextId(store, "article");
    const articleGid = gid("Article", id);
    store.articles.set(articleGid, {
      id: articleGid,
      blogId,
      title,
      handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      body: `<p>${title}</p>`,
      isPublished: true,
      seo: { title, description: title },
      updatedAt: now,
    });
  }

  // Menus: main-menu + footer.
  const mainMenuId = gid("Menu", nextId(store, "menu"));
  store.menus.set(mainMenuId, {
    id: mainMenuId,
    handle: "main-menu",
    title: "Main menu",
    items: [
      { id: gid("MenuItem", nextId(store, "menuitem")), title: "Home", type: "FRONTPAGE", items: [] },
      { id: gid("MenuItem", nextId(store, "menuitem")), title: "Catalog", type: "CATALOG", items: [] },
    ],
  });
  const footerMenuId = gid("Menu", nextId(store, "menu"));
  store.menus.set(footerMenuId, {
    id: footerMenuId,
    handle: "footer",
    title: "Footer",
    items: [{ id: gid("MenuItem", nextId(store, "menuitem")), title: "About Us", type: "PAGE", items: [] }],
  });

  // Metafield definitions.
  store.metafieldDefinitions.push(
    { id: gid("MetafieldDefinition", nextId(store, "metafielddef")), namespace: "custom", key: "material", name: "Material", type: "single_line_text_field", ownerType: "PRODUCT" },
    { id: gid("MetafieldDefinition", nextId(store, "metafielddef")), namespace: "custom", key: "care_instructions", name: "Care instructions", type: "multi_line_text_field", ownerType: "PRODUCT" },
  );

  // Metaobject definition + 2 entries.
  store.metaobjectDefinitions.push({
    id: gid("MetaobjectDefinition", nextId(store, "metaobjectdef")),
    type: "size_guide",
    name: "Size Guide",
    fieldDefinitions: [
      { key: "title", name: "Title", type: "single_line_text_field" },
      { key: "body", name: "Body", type: "multi_line_text_field" },
    ],
  });
  store.metaobjects.set("size_guide", [
    { id: gid("Metaobject", nextId(store, "metaobject")), type: "size_guide", handle: "apparel-size-guide", fields: [{ key: "title", value: "Apparel Size Guide" }, { key: "body", value: "S/M/L chart." }] },
    { id: gid("Metaobject", nextId(store, "metaobject")), type: "size_guide", handle: "footwear-size-guide", fields: [{ key: "title", value: "Footwear Size Guide" }, { key: "body", value: "US sizing." }] },
  ]);

  // Redirects.
  for (let i = 1; i <= 5; i++) {
    const id = gid("UrlRedirect", nextId(store, "redirect"));
    store.redirects.set(id, { id, path: `/old-path-${i}`, target: `/products/${productNames[i - 1]![0].toLowerCase().replace(/[^a-z0-9]+/g, "-")}` });
  }

  seedDemoCommerce(store);
  seedDemoAdvanced(store);
  return store;
}

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------
function connection<T>(items: T[], first: number, after?: string, cursorOf: (item: T) => string = (i) => String((i as any).id)) {
  const startIdx = after ? items.findIndex((i) => cursorOf(i) === after) + 1 : 0;
  const page = items.slice(startIdx, startIdx + first);
  const hasNextPage = startIdx + first < items.length;
  return {
    edges: page.map((node) => ({ cursor: cursorOf(node), node })),
    pageInfo: { hasNextPage, endCursor: page.length > 0 ? cursorOf(page[page.length - 1]!) : undefined },
  };
}

function userErrors(): Array<{ field: string[] | null; message: string }> {
  return [];
}

function throttleExtensions() {
  return { cost: { requestedQueryCost: 10, actualQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } };
}

/**
 * FakeAdminClient implements AdminClient by pattern-matching the operation
 * name embedded in the document text (`query Foo(...)` / `mutation Foo(...)`)
 * rather than parsing GraphQL. This keeps it dependency-free and fast, at the
 * cost of requiring the regex list below to be kept in sync with the
 * operation names used in `operations/*`.
 */
export class FakeAdminClient implements AdminClient {
  readonly apiVersion = "2026-07";
  readonly store: FakeAdminStore;

  constructor(store: FakeAdminStore = seedDemoCatalog()) {
    this.store = store;
  }

  async query<T = any>(document: string, variables?: Record<string, unknown>): Promise<GraphqlResult<T>> {
    return this.dispatch(document, variables ?? {}) as GraphqlResult<T>;
  }
  async mutate<T = any>(document: string, variables?: Record<string, unknown>): Promise<GraphqlResult<T>> {
    return this.dispatch(document, variables ?? {}) as GraphqlResult<T>;
  }

  /**
   * BulkRunner's above-threshold path skips the real HTTP PUT for
   * `https://fake-cdn.` staged-upload URLs and calls this instead, so tests
   * can exercise the Shopify Bulk Operations path without a network.
   */
  ingestStagedUpload(pathKey: string, content: string): void {
    this.store.bulkUploads.set(pathKey, content);
  }

  /** Mirror of downloading a bulk operation's result JSONL, for BulkRunner. */
  downloadBulkResult(url: string): string | undefined {
    return this.store.bulkResults.get(url);
  }

  private opName(document: string): string | null {
    const m = document.match(/\b(query|mutation)\s+(\w+)/);
    return m ? m[2]! : null;
  }

  private dispatch(document: string, vars: Record<string, unknown>): GraphqlResult<any> {
    const name = this.opName(document) ?? "";
    const s = this.store;
    const extra = dispatchCatalogExtra(s, name, vars as Record<string, any>);
    if (extra !== undefined) return this.result(extra);
    const commerce = dispatchCommerceOps(s, name, vars as Record<string, any>);
    if (commerce !== undefined) return this.result(commerce);
    const advanced = dispatchAdvanced(s, name, vars as Record<string, any>);
    if (advanced !== undefined) return this.result(advanced);

    // ---- Shop ----
    if (name === "ShopSummary") {
      return this.result({ shop: { name: "Demo Store", myshopifyDomain: "demo.myshopify.com", primaryDomain: { url: "https://demo.myshopify.com" }, plan: { displayName: "Demo" }, currencyCode: "USD" } });
    }

    // ---- Products ----
    if (name === "ProductsList") {
      const items = Array.from(s.products.values());
      const first = (vars.first as number) ?? 50;
      const conn = connection(items, first, vars.after as string | undefined);
      return this.result({
        products: {
          edges: conn.edges.map((e) => ({
            cursor: e.cursor,
            node: { id: e.node.id, title: e.node.title, handle: e.node.handle, status: e.node.status, vendor: e.node.vendor, productType: e.node.productType, totalInventory: e.node.totalInventory, updatedAt: e.node.updatedAt, createdAt: e.node.updatedAt, tags: e.node.tags, featuredMedia: e.node.mediaIds.length ? { preview: { image: { url: s.files.get(e.node.mediaIds[0]!)?.url ?? "https://cdn.shopify.com/demo.jpg" } } } : null, priceRangeV2: { minVariantPrice: { amount: s.variants.get(e.node.variantIds[0]!)?.price ?? "0.00", currencyCode: "USD" } } },
          })),
          pageInfo: conn.pageInfo,
        },
      });
    }
    if (name === "ProductById") {
      const p = s.products.get(vars.id as string);
      if (!p) return this.result({ product: null });
      return this.result({ product: this.productDetailShape(p) });
    }
    if (name === "ProductCreate") {
      const input = vars.input as any;
      const id = nextId(s, "product");
      const productGid = gid("Product", id);
      const product: FakeProduct = {
        id: productGid,
        title: input.title,
        handle: String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        status: input.status ?? "DRAFT",
        vendor: input.vendor,
        productType: input.productType,
        descriptionHtml: input.descriptionHtml,
        tags: input.tags ?? [],
        templateSuffix: input.templateSuffix,
        seo: {},
        variantIds: [],
        mediaIds: [],
        collectionIds: [],
        publicationIds: new Set(),
        updatedAt: new Date().toISOString(),
        totalInventory: 0,
      };
      s.products.set(productGid, product);
      return this.result({ productCreate: { product: { id: product.id, title: product.title, handle: product.handle, status: product.status }, userErrors: userErrors() } });
    }
    if (name === "ProductDelete") {
      const id = vars.id as string;
      const existed = s.products.delete(id);
      return this.result({ productDelete: { deletedProductId: existed ? id : null, userErrors: existed ? [] : [{ field: ["id"], message: "Product does not exist" }] } });
    }
    if (name === "ProductUpdate") {
      const input = vars.input as any;
      const p = s.products.get(input.id);
      if (!p) return this.result({ productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product not found." }] } });
      if (input.title !== undefined) p.title = input.title;
      if (input.descriptionHtml !== undefined) p.descriptionHtml = input.descriptionHtml;
      if (input.vendor !== undefined) p.vendor = input.vendor;
      if (input.productType !== undefined) p.productType = input.productType;
      if (input.tags !== undefined) p.tags = input.tags;
      if (input.status !== undefined) p.status = input.status;
      if (input.templateSuffix !== undefined) p.templateSuffix = input.templateSuffix ?? undefined;
      if (input.seo !== undefined) p.seo = { ...p.seo, ...input.seo };
      p.updatedAt = new Date().toISOString();
      return this.result({
        productUpdate: {
          product: { id: p.id, title: p.title, handle: p.handle, status: p.status, vendor: p.vendor, productType: p.productType, descriptionHtml: p.descriptionHtml, tags: p.tags, templateSuffix: p.templateSuffix, seo: p.seo },
          userErrors: userErrors(),
        },
      });
    }
    if (name === "ProductVariantsBulkUpdate") {
      const variantsInput = vars.variants as any[];
      const updated: any[] = [];
      for (const vi of variantsInput) {
        const v = s.variants.get(vi.id);
        if (!v) continue;
        if (vi.price !== undefined) v.price = vi.price;
        if (vi.compareAtPrice !== undefined) v.compareAtPrice = vi.compareAtPrice ?? undefined;
        if (vi.barcode !== undefined) v.barcode = vi.barcode;
        if (vi.inventoryItem?.sku !== undefined) v.sku = vi.inventoryItem.sku;
        updated.push({ id: v.id, title: v.title, sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode });
      }
      return this.result({ productVariantsBulkUpdate: { productVariants: updated, userErrors: userErrors() } });
    }
    if (name === "ProductVariantById") {
      const v = s.variants.get(vars.id as string);
      if (!v) return this.result({ productVariant: null });
      const p = s.products.get(v.productId);
      return this.result({ productVariant: { id: v.id, title: v.title, sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode, inventoryQuantity: v.inventoryQuantity, selectedOptions: v.selectedOptions ?? [{ name: "Title", value: v.title }], product: { id: p?.id, title: p?.title } } });
    }
    if (name === "ProductVariantsList") {
      const p = s.products.get(vars.productId as string);
      const items = (p?.variantIds ?? []).map((id) => s.variants.get(id)!).filter(Boolean);
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      return this.result({ product: p ? { variants: { edges: conn.edges, pageInfo: conn.pageInfo } } : null });
    }
    if (name === "ProductResourcePublications") {
      const p = s.products.get(vars.id as string);
      const edges = s.publications.map((pub) => ({ node: { publication: pub, isPublished: !!p?.publicationIds.has(pub.id) } }));
      return this.result({ product: p ? { resourcePublications: { edges } } : null });
    }

    // ---- Collections ----
    if (name === "CollectionsList") {
      const items = Array.from(s.collections.values());
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      return this.result({
        collections: {
          edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, title: e.node.title, handle: e.node.handle, updatedAt: e.node.updatedAt, productsCount: { count: e.node.productIds.length }, ruleSet: e.node.ruleSet ?? null } })),
          pageInfo: conn.pageInfo,
        },
      });
    }
    if (name === "CollectionById") {
      const c = s.collections.get(vars.id as string);
      if (!c) return this.result({ collection: null });
      const productsFirst = (vars.productsFirst as number) ?? 50;
      return this.result({
        collection: {
          id: c.id,
          title: c.title,
          handle: c.handle,
          descriptionHtml: c.descriptionHtml,
          updatedAt: c.updatedAt,
          seo: c.seo,
          image: c.image ?? null,
          ruleSet: c.ruleSet ?? null,
          metafields: { edges: c.metafieldIds.map((id) => ({ node: this.findMetafield(id) })).filter((e) => e.node) },
          products: { edges: c.productIds.slice(0, productsFirst).map((id) => ({ node: { id, title: s.products.get(id)?.title, handle: s.products.get(id)?.handle } })) },
        },
      });
    }
    if (name === "CollectionCreate") {
      const input = vars.input as any;
      const id = nextId(s, "collection");
      const collectionGid = gid("Collection", id);
      const collection: FakeCollection = {
        id: collectionGid,
        title: input.title,
        handle: String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        descriptionHtml: input.descriptionHtml,
        updatedAt: new Date().toISOString(),
        seo: {},
        ruleSet: input.ruleSet,
        productIds: [],
        metafieldIds: [],
      };
      s.collections.set(collectionGid, collection);
      return this.result({ collectionCreate: { collection: { id: collection.id, title: collection.title, handle: collection.handle }, userErrors: userErrors() } });
    }
    if (name === "CollectionDelete") {
      const id = vars.id as string;
      const existed = s.collections.delete(id);
      return this.result({ collectionDelete: { deletedCollectionId: existed ? id : null, userErrors: existed ? [] : [{ field: ["id"], message: "Collection does not exist" }] } });
    }
    if (name === "CollectionUpdate") {
      const input = vars.input as any;
      const c = s.collections.get(input.id);
      if (!c) return this.result({ collectionUpdate: { collection: null, userErrors: [{ field: ["id"], message: "Collection not found." }] } });
      if (input.title !== undefined) c.title = input.title;
      if (input.descriptionHtml !== undefined) c.descriptionHtml = input.descriptionHtml;
      if (input.seo !== undefined) c.seo = { ...c.seo, ...input.seo };
      if (input.templateSuffix !== undefined) (c as any).templateSuffix = input.templateSuffix ?? undefined;
      if (input.ruleSet !== undefined) c.ruleSet = input.ruleSet;
      c.updatedAt = new Date().toISOString();
      return this.result({ collectionUpdate: { collection: { id: c.id, title: c.title, handle: c.handle, descriptionHtml: c.descriptionHtml, seo: c.seo, templateSuffix: (c as any).templateSuffix ?? null }, userErrors: userErrors() } });
    }
    if (name === "CollectionAddProducts") {
      const c = s.collections.get(vars.id as string);
      if (!c) return this.result({ collectionAddProducts: { collection: null, userErrors: [{ field: ["id"], message: "Collection not found." }] } });
      const productIds = vars.productIds as string[];
      for (const pid of productIds) {
        if (!c.productIds.includes(pid)) c.productIds.push(pid);
        s.products.get(pid)?.collectionIds.push(c.id);
      }
      return this.result({ collectionAddProducts: { collection: { id: c.id }, userErrors: userErrors() } });
    }
    if (name === "CollectionReorderProducts") {
      const c = s.collections.get(vars.id as string);
      if (!c) return this.result({ collectionReorderProducts: { job: null, userErrors: [{ field: ["id"], message: "Collection not found." }] } });
      const moves = vars.moves as Array<{ id: string; newPosition: string }>;
      for (const move of moves) {
        const idx = c.productIds.indexOf(move.id);
        if (idx >= 0) {
          c.productIds.splice(idx, 1);
          c.productIds.splice(Number(move.newPosition), 0, move.id);
        }
      }
      return this.result({ collectionReorderProducts: { job: { id: gid("Job", nextId(s, "job")) }, userErrors: userErrors() } });
    }

    if (name === "ShopNameForAuthor") return this.result({ shop: { name: "Demo Store" } });

    // ---- Pages ----
    if (name === "PagesList") {
      const items = Array.from(s.pages.values());
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      return this.result({ pages: { edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, title: e.node.title, handle: e.node.handle, isPublished: e.node.isPublished, updatedAt: e.node.updatedAt } })), pageInfo: conn.pageInfo } });
    }
    if (name === "PageById") {
      const p = s.pages.get(vars.id as string);
      return this.result({ page: p ? { ...p, ...seoAliases(p.seo) } : null });
    }
    if (name === "PageCreate") {
      const input = vars.page as any;
      const id = nextId(s, "page");
      const pageGid = gid("Page", id);
      const page: FakePage = { id: pageGid, title: input.title, handle: String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"), body: input.body, isPublished: input.isPublished ?? true, seo: seoFromMetafields(input.metafields), updatedAt: new Date().toISOString() };
      s.pages.set(pageGid, page);
      return this.result({ pageCreate: { page: { id: page.id, title: page.title, handle: page.handle }, userErrors: userErrors() } });
    }
    if (name === "PageDelete") {
      const id = vars.id as string;
      const existed = s.pages.delete(id);
      return this.result({ pageDelete: { deletedPageId: existed ? id : null, userErrors: existed ? [] : [{ field: ["id"], message: "Page does not exist" }] } });
    }
    if (name === "PageUpdate") {
      const p = s.pages.get(vars.id as string);
      const input = vars.page as any;
      if (!p) return this.result({ pageUpdate: { page: null, userErrors: [{ field: ["id"], message: "Page not found." }] } });
      if (input.title !== undefined) p.title = input.title;
      if (input.body !== undefined) p.body = input.body;
      if (input.isPublished !== undefined) p.isPublished = input.isPublished;
      if (input.metafields !== undefined) p.seo = { ...p.seo, ...seoFromMetafields(input.metafields) };
      p.updatedAt = new Date().toISOString();
      return this.result({ pageUpdate: { page: { id: p.id, title: p.title, handle: p.handle, body: p.body, isPublished: p.isPublished, ...seoAliases(p.seo) }, userErrors: userErrors() } });
    }

    // ---- Blogs ----
    if (name === "BlogsList") {
      const items = Array.from(s.blogs.values());
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      return this.result({ blogs: { edges: conn.edges, pageInfo: conn.pageInfo } });
    }
    if (name === "BlogById") {
      const b = s.blogs.get(vars.id as string);
      return this.result({ blog: b ?? null });
    }

    // ---- Articles ----
    if (name === "ArticlesList" || name === "BlogArticlesList") {
      let items = Array.from(s.articles.values());
      if (vars.blogId) items = items.filter((a) => a.blogId === vars.blogId);
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      const articles = { edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, title: e.node.title, handle: e.node.handle, isPublished: e.node.isPublished, blog: { id: e.node.blogId }, updatedAt: e.node.updatedAt } })), pageInfo: conn.pageInfo };
      if (name === "BlogArticlesList") return this.result({ blog: s.blogs.has(vars.blogId as string) ? { articles } : null });
      return this.result({ articles });
    }
    if (name === "ArticleById") {
      const a = s.articles.get(vars.id as string);
      if (!a) return this.result({ article: null });
      return this.result({ article: { ...a, blog: { id: a.blogId }, ...seoAliases(a.seo) } });
    }
    if (name === "ArticleCreate") {
      const input = vars.article as any;
      const id = nextId(s, "article");
      const articleGid = gid("Article", id);
      const article: FakeArticle = { id: articleGid, blogId: input.blogId, title: input.title, handle: String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"), body: input.body, isPublished: input.isPublished ?? false, seo: {}, updatedAt: new Date().toISOString() };
      s.articles.set(articleGid, article);
      return this.result({ articleCreate: { article: { id: article.id, title: article.title, handle: article.handle, isPublished: article.isPublished }, userErrors: userErrors() } });
    }
    if (name === "ArticleDelete") {
      const id = vars.id as string;
      const existed = s.articles.delete(id);
      return this.result({ articleDelete: { deletedArticleId: existed ? id : null, userErrors: existed ? [] : [{ field: ["id"], message: "Article does not exist" }] } });
    }
    if (name === "ArticleUpdate") {
      const a = s.articles.get(vars.id as string);
      const input = vars.article as any;
      if (!a) return this.result({ articleUpdate: { article: null, userErrors: [{ field: ["id"], message: "Article not found." }] } });
      if (input.title !== undefined) a.title = input.title;
      if (input.body !== undefined) a.body = input.body;
      if (input.isPublished !== undefined) a.isPublished = input.isPublished;
      if (input.metafields !== undefined) a.seo = { ...a.seo, ...seoFromMetafields(input.metafields) };
      a.updatedAt = new Date().toISOString();
      return this.result({ articleUpdate: { article: { id: a.id, title: a.title, handle: a.handle, body: a.body, isPublished: a.isPublished, ...seoAliases(a.seo) }, userErrors: userErrors() } });
    }

    // ---- Navigation ----
    if (name === "MenusList") {
      const items = Array.from(s.menus.values());
      const conn = connection(items, (vars.first as number) ?? 20, vars.after as string | undefined);
      return this.result({ menus: { edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, handle: e.node.handle, title: e.node.title, items: e.node.items.map((i) => ({ id: i.id })) } })), pageInfo: conn.pageInfo } });
    }
    if (name === "MenuById") {
      const m = s.menus.get(vars.id as string);
      return this.result({ menu: m ?? null });
    }
    if (name === "MenuUpdate") {
      const m = s.menus.get(vars.id as string);
      if (!m) return this.result({ menuUpdate: { menu: null, userErrors: [{ field: ["id"], message: "Menu not found." }] } });
      if (vars.title) m.title = vars.title as string;
      if (vars.handle) m.handle = vars.handle as string;
      m.items = vars.items as FakeMenuItem[];
      return this.result({ menuUpdate: { menu: { id: m.id, handle: m.handle, title: m.title }, userErrors: userErrors() } });
    }

    // ---- Metafields ----
    if (name === "MetafieldDefinitions") {
      const items = s.metafieldDefinitions.filter((d) => d.ownerType === vars.ownerType);
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined, (i) => i.id);
      return this.result({ metafieldDefinitions: { edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, namespace: e.node.namespace, key: e.node.key, name: e.node.name, type: { name: e.node.type }, ownerType: e.node.ownerType } })), pageInfo: conn.pageInfo } });
    }
    if (name === "MetafieldsOnOwner") {
      const list = s.metafields.get(vars.ownerId as string) ?? [];
      const conn = connection(list, (vars.first as number) ?? 50, vars.after as string | undefined, (i) => i.id);
      return this.result({ node: { metafields: { edges: conn.edges, pageInfo: conn.pageInfo } } });
    }
    if (name === "MetafieldsSet") {
      const inputs = vars.metafields as any[];
      const results: FakeMetafield[] = [];
      for (const mi of inputs) {
        const list = s.metafields.get(mi.ownerId) ?? [];
        let existing = list.find((m) => m.namespace === mi.namespace && m.key === mi.key);
        if (!existing) {
          existing = { id: gid("Metafield", nextId(s, "metafield")), ownerId: mi.ownerId, namespace: mi.namespace, key: mi.key, type: mi.type, value: mi.value };
          list.push(existing);
          s.metafields.set(mi.ownerId, list);
        } else {
          existing.type = mi.type;
          existing.value = mi.value;
        }
        results.push(existing);
      }
      return this.result({ metafieldsSet: { metafields: results, userErrors: userErrors() } });
    }
    if (name === "MetafieldsDelete") {
      const inputs = vars.metafields as any[];
      const deleted: any[] = [];
      for (const mi of inputs) {
        const list = s.metafields.get(mi.ownerId) ?? [];
        const idx = list.findIndex((m) => m.namespace === mi.namespace && m.key === mi.key);
        if (idx >= 0) {
          list.splice(idx, 1);
          deleted.push(mi);
        }
      }
      return this.result({ metafieldsDelete: { deletedMetafields: deleted, userErrors: userErrors() } });
    }

    // ---- Metaobjects ----
    if (name === "MetaobjectDefinitions") {
      const conn = connection(s.metaobjectDefinitions, (vars.first as number) ?? 20, vars.after as string | undefined, (i) => i.id);
      return this.result({ metaobjectDefinitions: { edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, type: e.node.type, name: e.node.name, fieldDefinitions: e.node.fieldDefinitions.map((f) => ({ key: f.key, name: f.name, type: { name: f.type } })) } })), pageInfo: conn.pageInfo } });
    }
    if (name === "MetaobjectsByType") {
      const list = s.metaobjects.get(vars.type as string) ?? [];
      const conn = connection(list, (vars.first as number) ?? 50, vars.after as string | undefined, (i) => i.id);
      return this.result({ metaobjects: { edges: conn.edges, pageInfo: conn.pageInfo } });
    }
    if (name === "MetaobjectCreate") {
      const input = vars.metaobject as any;
      const id = nextId(s, "metaobject");
      const metaobjectGid = gid("Metaobject", id);
      const handle = input.handle ?? `metaobject-${id}`;
      const metaobject: FakeMetaobject = { id: metaobjectGid, type: input.type, handle, fields: input.fields ?? [] };
      const list = s.metaobjects.get(input.type) ?? [];
      list.push(metaobject);
      s.metaobjects.set(input.type, list);
      return this.result({ metaobjectCreate: { metaobject, userErrors: userErrors() } });
    }
    if (name === "MetaobjectUpdate") {
      const id = vars.id as string;
      let found: FakeMetaobject | undefined;
      for (const list of s.metaobjects.values()) {
        found = list.find((m) => m.id === id);
        if (found) break;
      }
      if (!found) return this.result({ metaobjectUpdate: { metaobject: null, userErrors: [{ field: ["id"], message: "Metaobject not found." }] } });
      const input = vars.metaobject as any;
      if (input.fields) found.fields = input.fields;
      return this.result({ metaobjectUpdate: { metaobject: found, userErrors: userErrors() } });
    }
    if (name === "MetaobjectUpsert") {
      const handle = vars.handle as { type: string; handle: string };
      const input = vars.metaobject as any;
      const list = s.metaobjects.get(handle.type) ?? [];
      let found = list.find((m) => m.handle === handle.handle);
      if (!found) {
        found = { id: gid("Metaobject", nextId(s, "metaobject")), type: handle.type, handle: handle.handle, fields: input.fields ?? [] };
        list.push(found);
        s.metaobjects.set(handle.type, list);
      } else if (input.fields) {
        found.fields = input.fields;
      }
      return this.result({ metaobjectUpsert: { metaobject: found, userErrors: userErrors() } });
    }

    // ---- Media ----
    if (name === "FilesList") {
      const items = Array.from(s.files.values());
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      return this.result({ files: { edges: conn.edges.map((e) => ({ cursor: e.cursor, node: { id: e.node.id, alt: e.node.alt, url: e.node.url, image: { url: e.node.url, width: e.node.width, height: e.node.height } } })), pageInfo: conn.pageInfo } });
    }
    if (name === "ProductMedia") {
      const p = s.products.get(vars.id as string);
      const items = (p?.mediaIds ?? []).map((id) => s.files.get(id)!).filter(Boolean);
      return this.result({ product: p ? { id: p.id, media: { edges: items.map((f) => ({ node: { id: f.id, alt: f.alt, mediaContentType: "IMAGE", preview: { image: { url: f.url } } } })) } } : null });
    }
    if (name === "FileUpdate") {
      const files = vars.files as Array<{ id: string; alt?: string }>;
      const updated: FakeFile[] = [];
      for (const fi of files) {
        const f = s.files.get(fi.id);
        if (f) {
          if (fi.alt !== undefined) f.alt = fi.alt;
          updated.push(f);
        }
      }
      return this.result({ fileUpdate: { files: updated, userErrors: userErrors() } });
    }
    if (name === "ProductUpdateMedia") {
      const media = vars.media as Array<{ id: string; alt?: string }>;
      const updated: FakeFile[] = [];
      for (const mi of media) {
        const f = s.files.get(mi.id);
        if (f) {
          if (mi.alt !== undefined) f.alt = mi.alt;
          updated.push(f);
        }
      }
      return this.result({ productUpdateMedia: { media: updated, mediaUserErrors: userErrors() } });
    }
    if (name === "StagedUploadsCreate") {
      const input = (vars.input as any[])[0] ?? {};
      const uploadId = nextId(s, "stagedupload");
      const resourceUrl = `https://fake-cdn.shopmanagerai.test/staged/${uploadId}/${input.filename ?? "file"}`;
      return this.result({
        stagedUploadsCreate: {
          stagedTargets: [{ url: resourceUrl, resourceUrl, parameters: [{ name: "key", value: `staged/${uploadId}` }] }],
          userErrors: userErrors(),
        },
      });
    }
    if (name === "FileCreate") {
      const files = vars.files as Array<{ originalSource: string; alt?: string; contentType?: string }>;
      const created: FakeFile[] = [];
      for (const fi of files) {
        const id = gid("MediaImage", nextId(s, "media"));
        const file: FakeFile = { id, alt: fi.alt, url: fi.originalSource };
        s.files.set(id, file);
        created.push(file);
      }
      return this.result({ fileCreate: { files: created.map((f) => ({ id: f.id, alt: f.alt, image: { url: f.url }, url: f.url })), userErrors: userErrors() } });
    }
    if (name === "ProductCreateMedia") {
      const productId = vars.productId as string;
      const media = vars.media as Array<{ originalSource: string; alt?: string; mediaContentType?: string }>;
      const p = s.products.get(productId);
      const created: FakeFile[] = [];
      for (const mi of media) {
        const id = gid("MediaImage", nextId(s, "media"));
        const file: FakeFile = { id, alt: mi.alt, url: mi.originalSource };
        s.files.set(id, file);
        created.push(file);
        p?.mediaIds.push(id);
      }
      return this.result({
        productCreateMedia: {
          media: created.map((f) => ({ id: f.id, alt: f.alt, mediaContentType: "IMAGE", image: { url: f.url } })),
          mediaUserErrors: p ? userErrors() : [{ field: ["productId"], message: "Product not found." }],
        },
      });
    }

    // ---- Redirects ----
    if (name === "UrlRedirectsList") {
      const items = Array.from(s.redirects.values());
      const conn = connection(items, (vars.first as number) ?? 50, vars.after as string | undefined);
      return this.result({ urlRedirects: { edges: conn.edges, pageInfo: conn.pageInfo } });
    }
    if (name === "UrlRedirectCreate") {
      const input = vars.urlRedirect as { path: string; target: string };
      const id = gid("UrlRedirect", nextId(s, "redirect"));
      const redirect: FakeRedirect = { id, path: input.path, target: input.target };
      s.redirects.set(id, redirect);
      return this.result({ urlRedirectCreate: { urlRedirect: redirect, userErrors: userErrors() } });
    }
    if (name === "UrlRedirectUpdate") {
      const r = s.redirects.get(vars.id as string);
      const input = vars.urlRedirect as { path?: string; target?: string };
      if (!r) return this.result({ urlRedirectUpdate: { urlRedirect: null, userErrors: [{ field: ["id"], message: "Redirect not found." }] } });
      if (input.path !== undefined) r.path = input.path;
      if (input.target !== undefined) r.target = input.target;
      return this.result({ urlRedirectUpdate: { urlRedirect: r, userErrors: userErrors() } });
    }
    if (name === "UrlRedirectDelete") {
      const id = vars.id as string;
      const existed = s.redirects.delete(id);
      return this.result({ urlRedirectDelete: { deletedUrlRedirectId: existed ? id : null, userErrors: existed ? [] : [{ field: ["id"], message: "Redirect not found." }] } });
    }

    // ---- Publications ----
    if (name === "Publications") {
      return this.result({ publications: { edges: s.publications.map((p) => ({ node: p })) } });
    }
    if (name === "PublishablePublish") {
      const id = vars.id as string;
      const input = vars.input as Array<{ publicationId: string }>;
      const p = s.products.get(id);
      if (p) for (const i of input) p.publicationIds.add(i.publicationId);
      return this.result({ publishablePublish: { publishable: {}, userErrors: userErrors() } });
    }
    if (name === "PublishableUnpublish") {
      const id = vars.id as string;
      const input = vars.input as Array<{ publicationId: string }>;
      const p = s.products.get(id);
      if (p) for (const i of input) p.publicationIds.delete(i.publicationId);
      return this.result({ publishableUnpublish: { publishable: {}, userErrors: userErrors() } });
    }

    // ---- Bulk operations ----
    if (name === "BulkOperationRunMutation") {
      const mutationDoc = vars.mutation as string;
      const pathKey = vars.stagedUploadPath as string;
      const content = s.bulkUploads.get(pathKey) ?? "";
      const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const resultLines: string[] = [];
      for (const line of lines) {
        let lineVars: Record<string, unknown> = {};
        try {
          lineVars = JSON.parse(line);
        } catch {
          resultLines.push(JSON.stringify({ userErrors: [{ field: null, message: "Malformed JSONL input line." }] }));
          continue;
        }
        const lineResult = this.dispatch(mutationDoc, lineVars);
        resultLines.push(JSON.stringify(lineResult.data ?? {}));
      }
      const id = gid("BulkOperation", nextId(s, "bulkoperation"));
      const resultUrl = `https://fake-cdn.shopmanagerai.test/bulk-results/${idFromGid(id)}.jsonl`;
      s.bulkResults.set(resultUrl, resultLines.join("\n"));
      s.bulkOperation = { id, status: "COMPLETED", objectCount: lines.length, errorCode: null, url: resultUrl };
      return this.result({ bulkOperationRunMutation: { bulkOperation: { id, status: "COMPLETED" }, userErrors: userErrors() } });
    }
    if (name === "CurrentBulkOperation") {
      const op = s.bulkOperation;
      return this.result({
        currentBulkOperation: op
          ? { id: op.id, status: op.status, errorCode: op.errorCode ?? null, objectCount: op.objectCount, fileSize: 0, url: op.url, partialDataUrl: null, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }
          : null,
      });
    }

    // ---- Unknown operation ----
    return { data: {}, deprecations: [`fake: unhandled operation ${name || "<unnamed>"}`], extensions: throttleExtensions() as any };
  }

  private result(data: any): GraphqlResult<any> {
    return { data, extensions: throttleExtensions() as any };
  }

  private findMetafield(id: string): FakeMetafield | undefined {
    for (const list of this.store.metafields.values()) {
      const found = list.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private productDetailShape(p: FakeProduct) {
    const s = this.store;
    return {
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      vendor: p.vendor,
      productType: p.productType,
      descriptionHtml: p.descriptionHtml,
      seo: p.seo,
      variants: { edges: p.variantIds.map((id) => ({ node: s.variants.get(id) })) },
      media: { edges: p.mediaIds.map((id) => ({ node: { id } })) },
      collections: { edges: p.collectionIds.map((id) => ({ node: { id, title: s.collections.get(id)?.title } })) },
      resourcePublicationsCount: { count: p.publicationIds.size },
    };
  }
}

export { gid as fakeGid, idFromGid };

/** Pages/articles keep SEO in `global.title_tag` / `global.description_tag` metafields (see operations/content.ts). */
function seoFromMetafields(metafields: Array<{ namespace: string; key: string; value: string }> | undefined): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {};
  for (const m of metafields ?? []) {
    if (m.namespace !== "global") continue;
    if (m.key === "title_tag") out.title = m.value;
    if (m.key === "description_tag") out.description = m.value;
  }
  return out;
}
function seoAliases(seo: { title?: string; description?: string }): { seoTitle: { value: string | null }; seoDescription: { value: string | null } } {
  return { seoTitle: { value: seo.title ?? null }, seoDescription: { value: seo.description ?? null } };
}
