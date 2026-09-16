/**
 * Collection catalog operations (docs/CURRENT_SHOPIFY_RESEARCH.md §5
 * "Collections" row). Manual collections use `collectionAddProducts` +
 * `collectionReorderProducts`; smart collections carry a `ruleSet`.
 */
import type { AdminClient } from "@shopmanagerai/shared";

export const COLLECTIONS_LIST_QUERY = /* GraphQL */ `
  query CollectionsList($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          title
          handle
          updatedAt
          productsCount {
            count
          }
          ruleSet {
            appliedDisjunctively
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

export interface CollectionListItem {
  id: string;
  cursor: string;
  title: string;
  handle: string;
  updatedAt?: string;
  productsCount?: number;
  isSmart: boolean;
}

export interface CollectionsPage {
  items: CollectionListItem[];
  hasNextPage: boolean;
  endCursor?: string;
}

export async function listCollections(
  client: AdminClient,
  opts: { first?: number; after?: string; query?: string } = {},
): Promise<CollectionsPage> {
  const result = await client.query<{
    collections: {
      edges: Array<{
        cursor: string;
        node: { id: string; title: string; handle: string; updatedAt?: string; productsCount?: { count?: number } | null; ruleSet?: unknown | null };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(COLLECTIONS_LIST_QUERY, { first: opts.first ?? 50, after: opts.after, query: opts.query }, { cost: Math.max(10, (opts.first ?? 50) * 2) });

  return {
    items: result.data.collections.edges.map((e) => ({
      id: e.node.id,
      cursor: e.cursor,
      title: e.node.title,
      handle: e.node.handle,
      updatedAt: e.node.updatedAt,
      productsCount: e.node.productsCount?.count ?? undefined,
      isSmart: !!e.node.ruleSet,
    })),
    hasNextPage: result.data.collections.pageInfo.hasNextPage,
    endCursor: result.data.collections.pageInfo.endCursor,
  };
}

export const COLLECTION_BY_ID_QUERY = /* GraphQL */ `
  query CollectionById($id: ID!, $productsFirst: Int!) {
    collection(id: $id) {
      id
      title
      handle
      descriptionHtml
      updatedAt
      seo {
        title
        description
      }
      image {
        id
        url
        altText
      }
      ruleSet {
        appliedDisjunctively
        rules {
          column
          relation
          condition
        }
      }
      metafields(first: 50) {
        edges {
          node {
            id
            namespace
            key
            type
            value
          }
        }
      }
      products(first: $productsFirst) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  }
`;

export interface CollectionRule {
  column: string;
  relation: string;
  condition: string;
}
export interface CollectionDetail {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string;
  updatedAt?: string;
  seo?: { title?: string; description?: string };
  image?: { id: string; url: string; altText?: string };
  ruleSet?: { appliedDisjunctively: boolean; rules: CollectionRule[] };
  metafields: Array<{ id: string; namespace: string; key: string; type: string; value: string }>;
  products: Array<{ id: string; title: string; handle: string }>;
}

export async function getCollection(client: AdminClient, id: string, opts: { productsFirst?: number } = {}): Promise<CollectionDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`;
  const result = await client.query<{
    collection: null | {
      id: string;
      title: string;
      handle: string;
      descriptionHtml?: string | null;
      updatedAt?: string;
      seo?: { title?: string | null; description?: string | null } | null;
      image?: { id: string; url: string; altText?: string | null } | null;
      ruleSet?: { appliedDisjunctively: boolean; rules: CollectionRule[] } | null;
      metafields: { edges: Array<{ node: { id: string; namespace: string; key: string; type: string; value: string } }> };
      products: { edges: Array<{ node: { id: string; title: string; handle: string } }> };
    };
  }>(COLLECTION_BY_ID_QUERY, { id: gid, productsFirst: opts.productsFirst ?? 50 }, { cost: 25 });

  const c = result.data.collection;
  if (!c) return null;
  return {
    id: c.id,
    title: c.title,
    handle: c.handle,
    descriptionHtml: c.descriptionHtml ?? undefined,
    updatedAt: c.updatedAt,
    seo: c.seo ? { title: c.seo.title ?? undefined, description: c.seo.description ?? undefined } : undefined,
    image: c.image ? { id: c.image.id, url: c.image.url, altText: c.image.altText ?? undefined } : undefined,
    ruleSet: c.ruleSet ?? undefined,
    metafields: c.metafields.edges.map((e) => e.node),
    products: c.products.edges.map((e) => e.node),
  };
}

export const COLLECTION_CREATE_MUTATION = /* GraphQL */ `
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface CollectionCreateInput {
  title: string;
  descriptionHtml?: string;
  ruleSet?: { appliedDisjunctively: boolean; rules: CollectionRule[] };
  templateSuffix?: string;
}
export interface UserError {
  field?: string[] | null;
  message: string;
}

export async function createCollection(client: AdminClient, input: CollectionCreateInput): Promise<{ collection?: { id: string; title: string; handle: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ collectionCreate: { collection?: { id: string; title: string; handle: string } | null; userErrors: UserError[] } }>(
    COLLECTION_CREATE_MUTATION,
    { input },
    { cost: 10 },
  );
  return { collection: result.data.collectionCreate.collection ?? undefined, userErrors: result.data.collectionCreate.userErrors };
}

export const COLLECTION_UPDATE_MUTATION = /* GraphQL */ `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        title
        handle
        descriptionHtml
        seo {
          title
          description
        }
        templateSuffix
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface CollectionUpdateInput {
  id: string;
  title?: string;
  descriptionHtml?: string;
  seo?: { title?: string; description?: string };
  templateSuffix?: string | null;
  ruleSet?: { appliedDisjunctively: boolean; rules: CollectionRule[] };
}

export async function updateCollection(
  client: AdminClient,
  input: CollectionUpdateInput,
): Promise<{ collection?: { id: string; title: string; handle: string; descriptionHtml?: string; seo?: { title?: string; description?: string }; templateSuffix?: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{
    collectionUpdate: {
      collection?: { id: string; title: string; handle: string; descriptionHtml?: string | null; seo?: { title?: string | null; description?: string | null } | null; templateSuffix?: string | null } | null;
      userErrors: UserError[];
    };
  }>(COLLECTION_UPDATE_MUTATION, { input }, { cost: 10 });
  const c = result.data.collectionUpdate.collection;
  return {
    collection: c
      ? { id: c.id, title: c.title, handle: c.handle, descriptionHtml: c.descriptionHtml ?? undefined, seo: c.seo ? { title: c.seo.title ?? undefined, description: c.seo.description ?? undefined } : undefined, templateSuffix: c.templateSuffix ?? undefined }
      : undefined,
    userErrors: result.data.collectionUpdate.userErrors,
  };
}

export const COLLECTION_ADD_PRODUCTS_MUTATION = /* GraphQL */ `
  mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function collectionAddProducts(client: AdminClient, id: string, productIds: string[]): Promise<{ userErrors: UserError[] }> {
  const result = await client.mutate<{ collectionAddProducts: { collection?: { id: string } | null; userErrors: UserError[] } }>(
    COLLECTION_ADD_PRODUCTS_MUTATION,
    { id, productIds },
    { cost: 10 },
  );
  return { userErrors: result.data.collectionAddProducts.userErrors };
}

/**
 * UNVERIFIED: current API names this mutation `collectionReorderProducts`
 * with a `moves: [MoveInput!]!` argument (`{ id, newPosition }`); confirm
 * exact argument shape against the live schema before shipping writes.
 */
export const COLLECTION_REORDER_PRODUCTS_MUTATION = /* GraphQL */ `
  mutation CollectionReorderProducts($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface MoveInput {
  id: string;
  newPosition: string;
}

export async function collectionReorderProducts(client: AdminClient, id: string, moves: MoveInput[]): Promise<{ jobId?: string; userErrors: UserError[] }> {
  const result = await client.mutate<{ collectionReorderProducts: { job?: { id: string } | null; userErrors: UserError[] } }>(
    COLLECTION_REORDER_PRODUCTS_MUTATION,
    { id, moves },
    { cost: 10 },
  );
  return { jobId: result.data.collectionReorderProducts.job?.id, userErrors: result.data.collectionReorderProducts.userErrors };
}

export const COLLECTIONDELETE_MUTATION = /* GraphQL */ `
  mutation CollectionDelete($id: ID!) {
    collectionDelete(input: { id: $id }) {
      deletedCollectionId
      userErrors {
        field
        message
      }
    }
  }
`;
/** Used by ledger rollback to undo a `create` (create → delete). */
export async function deleteCollection(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`;
  const result = await client.mutate<{ collectionDelete: { deletedCollectionId?: string | null; userErrors: UserError[] } }>(COLLECTIONDELETE_MUTATION, { id: gid }, { cost: 10 });
  return { deletedId: result.data.collectionDelete.deletedCollectionId ?? undefined, userErrors: result.data.collectionDelete.userErrors };
}
