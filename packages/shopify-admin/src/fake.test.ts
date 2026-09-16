import { describe, expect, it } from "vitest";
import { FakeAdminClient, seedDemoCatalog } from "./fake.js";
import { listProducts, getProduct, updateProduct, updateProductVariants } from "./operations/products.js";
import { listCollections, updateCollection } from "./operations/collections.js";
import { createPage } from "./operations/content.js";
import { setMetafields } from "./operations/metafields.js";

describe("FakeAdminClient", () => {
  it("seeds 12 products, 4 collections, 3 pages, 1 blog with 3 articles, 2 menus, 5 redirects", async () => {
    const store = seedDemoCatalog();
    expect(store.products.size).toBe(12);
    expect(store.collections.size).toBe(4);
    expect(store.pages.size).toBe(3);
    expect(store.blogs.size).toBe(1);
    expect(store.articles.size).toBe(3);
    expect(store.menus.size).toBe(2);
    expect(store.redirects.size).toBe(5);
  });

  it("lists products via the ProductsList operation", async () => {
    const client = new FakeAdminClient();
    const page = await listProducts(client, { first: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.hasNextPage).toBe(true);
  });

  it("updates a product's basic fields deterministically", async () => {
    const client = new FakeAdminClient();
    const page = await listProducts(client, { first: 1 });
    const id = page.items[0]!.id;
    const { product, userErrors } = await updateProduct(client, { id, title: "New Title" });
    expect(userErrors).toHaveLength(0);
    expect(product?.title).toBe("New Title");
    const fetched = await getProduct(client, id);
    expect(fetched?.title).toBe("New Title");
  });

  it("updates variant price via productVariantsBulkUpdate", async () => {
    const client = new FakeAdminClient();
    const page = await listProducts(client, { first: 1 });
    const detail = await getProduct(client, page.items[0]!.id);
    const variantId = detail!.variants[0]!.id;
    const { variants, userErrors } = await updateProductVariants(client, page.items[0]!.id, [{ id: variantId, price: "49.99" }]);
    expect(userErrors).toHaveLength(0);
    expect(variants[0]!.price).toBe("49.99");
  });

  it("returns unhandled-operation shape with a deprecations note for unknown operations", async () => {
    const client = new FakeAdminClient();
    const result = await client.query(`query TotallyUnknownThing { shop { name } }`);
    expect(result.data).toEqual({});
    expect(result.deprecations?.[0]).toMatch(/unhandled operation/);
  });

  it("lists and updates collections including seo", async () => {
    const client = new FakeAdminClient();
    const page = await listCollections(client, { first: 10 });
    expect(page.items.length).toBe(4);
    const smart = page.items.find((c) => c.isSmart);
    expect(smart).toBeTruthy();
    const { collection } = await updateCollection(client, { id: page.items[0]!.id, seo: { title: "SEO Title" } });
    expect(collection?.seo?.title).toBe("SEO Title");
  });

  it("creates a draft page and sets a metafield", async () => {
    const client = new FakeAdminClient();
    const { page } = await createPage(client, { title: "Warranty", isPublished: false });
    expect(page?.title).toBe("Warranty");
    const { metafields, userErrors } = await setMetafields(client, [{ ownerId: page!.id, namespace: "custom", key: "note", type: "single_line_text_field", value: "hi" }]);
    expect(userErrors).toHaveLength(0);
    expect(metafields[0]!.value).toBe("hi");
  });

  it("exposes extensions.cost.throttleStatus on every response", async () => {
    const client = new FakeAdminClient();
    const result = await client.query(`query ShopSummary { shop { name } }`);
    expect(result.extensions?.cost?.throttleStatus).toBeDefined();
  });
});
