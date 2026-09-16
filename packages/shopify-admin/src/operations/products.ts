/**
 * Product catalog queries (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Products" row).
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export const PRODUCTS_LIST_QUERY = /* GraphQL */ `
  query ProductsList($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          title
          handle
          status
          vendor
          productType
          totalInventory
          updatedAt
          createdAt
          tags
          featuredMedia {
            preview {
              image {
                url
              }
            }
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCT_BY_ID_QUERY = /* GraphQL */ `
  query ProductById($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      descriptionHtml
      seo {
        title
        description
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            price
            inventoryQuantity
          }
        }
      }
      media(first: 50) {
        edges {
          node {
            id
            mediaContentType
            alt
          }
        }
      }
      collections(first: 50) {
        edges {
          node {
            id
            title
          }
        }
      }
      resourcePublicationsCount {
        count
      }
    }
  }
`;

export interface ProductListItem {
  id: string;
  cursor: string;
  title: string;
  handle: string;
  status: string;
  vendor?: string;
  productType?: string;
  totalInventory?: number;
  updatedAt?: string;
  createdAt?: string;
  tags?: string[];
  featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null;
  priceRangeV2?: { minVariantPrice?: { amount?: string; currencyCode?: string } };
}

export interface ProductsPage {
  items: ProductListItem[];
  hasNextPage: boolean;
  endCursor?: string;
}

export async function listProducts(client: AdminClient, opts: { first?: number; after?: string; query?: string } = {}): Promise<ProductsPage> {
  const result = await client.query<{
    products: {
      edges: Array<{ cursor: string; node: Omit<ProductListItem, "cursor"> }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(PRODUCTS_LIST_QUERY, { first: opts.first ?? 50, after: opts.after, query: opts.query }, { cost: Math.max(10, (opts.first ?? 50) * 2) });

  return {
    items: result.data.products.edges.map((e) => ({ ...e.node, cursor: e.cursor })),
    hasNextPage: result.data.products.pageInfo.hasNextPage,
    endCursor: result.data.products.pageInfo.endCursor,
  };
}

export interface ProductVariant {
  id: string;
  title: string;
  sku?: string;
  price?: string;
  inventoryQuantity?: number;
}

export interface ProductDetail {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor?: string;
  productType?: string;
  descriptionHtml?: string;
  seo?: { title?: string; description?: string };
  variants: ProductVariant[];
  mediaCount: number;
  collections: Array<{ id: string; title: string }>;
  publicationsCount?: number;
}

export async function getProduct(client: AdminClient, id: string): Promise<ProductDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
  const result = await client.query<{
    product: null | {
      id: string;
      title: string;
      handle: string;
      status: string;
      vendor?: string;
      productType?: string;
      descriptionHtml?: string;
      seo?: { title?: string | null; description?: string | null } | null;
      variants: { edges: Array<{ node: ProductVariant }> };
      media: { edges: Array<{ node: { id: string } }> };
      collections: { edges: Array<{ node: { id: string; title: string } }> };
      resourcePublicationsCount?: { count?: number } | null;
    };
  }>(PRODUCT_BY_ID_QUERY, { id: gid }, { cost: 25 });

  const p = result.data.product;
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    vendor: p.vendor ?? undefined,
    productType: p.productType ?? undefined,
    descriptionHtml: p.descriptionHtml ?? undefined,
    seo: p.seo ? { title: p.seo.title ?? undefined, description: p.seo.description ?? undefined } : undefined,
    variants: p.variants.edges.map((e) => e.node),
    mediaCount: p.media.edges.length,
    collections: p.collections.edges.map((e) => e.node),
    publicationsCount: p.resourcePublicationsCount?.count ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  mutation ProductCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface ProductCreateInput {
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  templateSuffix?: string;
}

export async function createProduct(client: AdminClient, input: ProductCreateInput): Promise<{ product?: { id: string; title: string; handle: string; status: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ productCreate: { product?: { id: string; title: string; handle: string; status: string } | null; userErrors: UserError[] } }>(
    PRODUCT_CREATE_MUTATION,
    { input },
    { cost: 10 },
  );
  return { product: result.data.productCreate.product ?? undefined, userErrors: result.data.productCreate.userErrors };
}

/**
 * Covers title/descriptionHtml/tags/vendor/productType/status/seo/templateSuffix.
 * Price lives on variants (productVariantsBulkUpdate), never here -- see
 * docs/ARCHITECTURE_REVIEW.md C2 on keeping "basic" product edits out of the
 * commerce_sensitive risk class.
 */
export const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        handle
        status
        vendor
        productType
        descriptionHtml
        tags
        templateSuffix
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface ProductUpdateInput {
  id: string;
  title?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  templateSuffix?: string | null;
  seo?: { title?: string; description?: string };
}

export interface ProductWriteResult {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor?: string;
  productType?: string;
  descriptionHtml?: string;
  tags?: string[];
  templateSuffix?: string;
  seo?: { title?: string; description?: string };
}

export async function updateProduct(client: AdminClient, input: ProductUpdateInput): Promise<{ product?: ProductWriteResult; userErrors: UserError[] }> {
  const result = await client.mutate<{
    productUpdate: {
      product?:
        | {
            id: string;
            title: string;
            handle: string;
            status: string;
            vendor?: string | null;
            productType?: string | null;
            descriptionHtml?: string | null;
            tags?: string[];
            templateSuffix?: string | null;
            seo?: { title?: string | null; description?: string | null } | null;
          }
        | null;
      userErrors: UserError[];
    };
  }>(PRODUCT_UPDATE_MUTATION, { input }, { cost: 10 });
  const p = result.data.productUpdate.product;
  return {
    product: p
      ? {
          id: p.id,
          title: p.title,
          handle: p.handle,
          status: p.status,
          vendor: p.vendor ?? undefined,
          productType: p.productType ?? undefined,
          descriptionHtml: p.descriptionHtml ?? undefined,
          tags: p.tags ?? undefined,
          templateSuffix: p.templateSuffix ?? undefined,
          seo: p.seo ? { title: p.seo.title ?? undefined, description: p.seo.description ?? undefined } : undefined,
        }
      : undefined,
    userErrors: result.data.productUpdate.userErrors,
  };
}

/**
 * Variant price/compareAtPrice/sku/barcode. This is the commerce_sensitive
 * write path (docs/ARCHITECTURE_REVIEW.md C2): callers must classify tools
 * touching this mutation with riskClass "commerce_sensitive" and an
 * escalation policyKey of "product.price.write".
 */
export const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = /* GraphQL */ `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        sku
        price
        compareAtPrice
        barcode
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface ProductVariantBulkInput {
  id: string;
  price?: string;
  compareAtPrice?: string | null;
  barcode?: string;
  inventoryItem?: { sku?: string };
}

export interface ProductVariantWriteResult {
  id: string;
  title: string;
  sku?: string;
  price?: string;
  compareAtPrice?: string;
  barcode?: string;
}

export async function updateProductVariants(
  client: AdminClient,
  productId: string,
  variants: ProductVariantBulkInput[],
): Promise<{ variants: ProductVariantWriteResult[]; userErrors: UserError[] }> {
  const result = await client.mutate<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; title: string; sku?: string | null; price?: string | null; compareAtPrice?: string | null; barcode?: string | null }>;
      userErrors: UserError[];
    };
  }>(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, { productId, variants }, { cost: 10 * variants.length });
  return {
    variants: result.data.productVariantsBulkUpdate.productVariants.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku ?? undefined,
      price: v.price ?? undefined,
      compareAtPrice: v.compareAtPrice ?? undefined,
      barcode: v.barcode ?? undefined,
    })),
    userErrors: result.data.productVariantsBulkUpdate.userErrors,
  };
}

export const PRODUCT_VARIANT_BY_ID_QUERY = /* GraphQL */ `
  query ProductVariantById($id: ID!) {
    productVariant(id: $id) {
      id
      title
      sku
      price
      compareAtPrice
      barcode
      inventoryQuantity
      selectedOptions {
        name
        value
      }
      product {
        id
        title
      }
    }
  }
`;

export interface ProductVariantDetail {
  id: string;
  title: string;
  /** Option name/value pairs; needed to recreate a variant (rollback of a delete). */
  selectedOptions?: Array<{ name: string; value: string }>;
  sku?: string;
  price?: string;
  compareAtPrice?: string;
  barcode?: string;
  inventoryQuantity?: number;
  productId: string;
  productTitle: string;
}

export async function getProductVariant(client: AdminClient, id: string): Promise<ProductVariantDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
  const result = await client.query<{
    productVariant: null | {
      id: string;
      title: string;
      sku?: string | null;
      price?: string | null;
      compareAtPrice?: string | null;
      barcode?: string | null;
      inventoryQuantity?: number | null;
      product: { id: string; title: string };
      selectedOptions?: Array<{ name: string; value: string }> | null;
    };
  }>(PRODUCT_VARIANT_BY_ID_QUERY, { id: gid }, { cost: 10 });
  const v = result.data.productVariant;
  if (!v) return null;
  return {
    id: v.id,
    title: v.title,
    sku: v.sku ?? undefined,
    price: v.price ?? undefined,
    compareAtPrice: v.compareAtPrice ?? undefined,
    barcode: v.barcode ?? undefined,
    inventoryQuantity: v.inventoryQuantity ?? undefined,
    selectedOptions: v.selectedOptions ?? undefined,
    productId: v.product.id,
    productTitle: v.product.title,
  };
}

export const PRODUCT_VARIANTS_LIST_QUERY = /* GraphQL */ `
  query ProductVariantsList($productId: ID!, $first: Int!, $after: String) {
    product(id: $productId) {
      variants(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            title
            sku
            price
            compareAtPrice
            inventoryQuantity
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export async function listProductVariants(
  client: AdminClient,
  productId: string,
  opts: { first?: number; after?: string } = {},
): Promise<{ items: Array<ProductVariant & { cursor: string }>; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    product: null | { variants: { edges: Array<{ cursor: string; node: ProductVariant }>; pageInfo: { hasNextPage: boolean; endCursor?: string } } };
  }>(PRODUCT_VARIANTS_LIST_QUERY, { productId, first: opts.first ?? 50, after: opts.after }, { cost: 10 });
  const conn = result.data.product?.variants;
  if (!conn) return { items: [], hasNextPage: false };
  return { items: conn.edges.map((e) => ({ ...e.node, cursor: e.cursor })), hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor };
}

export const PRODUCT_RESOURCE_PUBLICATIONS_QUERY = /* GraphQL */ `
  query ProductResourcePublications($id: ID!) {
    product(id: $id) {
      resourcePublications(first: 10) {
        edges {
          node {
            publication {
              id
              name
            }
            isPublished
          }
        }
      }
    }
  }
`;

export interface ResourcePublicationItem {
  publicationId: string;
  publicationName: string;
  isPublished: boolean;
}

export async function getProductPublications(client: AdminClient, id: string): Promise<ResourcePublicationItem[]> {
  const result = await client.query<{
    product: null | { resourcePublications: { edges: Array<{ node: { publication: { id: string; name: string }; isPublished: boolean } }> } };
  }>(PRODUCT_RESOURCE_PUBLICATIONS_QUERY, { id }, { cost: 10 });
  const edges = result.data.product?.resourcePublications.edges ?? [];
  return edges.map((e) => ({ publicationId: e.node.publication.id, publicationName: e.node.publication.name, isPublished: e.node.isPublished }));
}

export const PRODUCTDELETE_MUTATION = /* GraphQL */ `
  mutation ProductDelete($id: ID!) {
    productDelete(input: { id: $id }) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;
/** Used by ledger rollback to undo a `create` (create → delete). */
export async function deleteProduct(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
  const result = await client.mutate<{ productDelete: { deletedProductId?: string | null; userErrors: UserError[] } }>(PRODUCTDELETE_MUTATION, { id: gid }, { cost: 10 });
  return { deletedId: result.data.productDelete.deletedProductId ?? undefined, userErrors: result.data.productDelete.userErrors };
}
