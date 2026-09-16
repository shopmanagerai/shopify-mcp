/**
 * Metafields (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Metafields" row).
 * `metafieldsSet` accepts at most 25 metafields per call; app-owned
 * namespaces (`$app:...`) must never be written by these tools.
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export const METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          namespace
          key
          name
          type {
            name
          }
          ownerType
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface MetafieldDefinition {
  id: string;
  cursor: string;
  namespace: string;
  key: string;
  name: string;
  type: string;
  ownerType: string;
}

export async function listMetafieldDefinitions(
  client: AdminClient,
  ownerType: string,
  opts: { first?: number; after?: string } = {},
): Promise<{ items: MetafieldDefinition[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    metafieldDefinitions: {
      edges: Array<{ cursor: string; node: { id: string; namespace: string; key: string; name: string; type: { name: string }; ownerType: string } }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(METAFIELD_DEFINITIONS_QUERY, { ownerType, first: opts.first ?? 50, after: opts.after }, { cost: 10 });
  return {
    items: result.data.metafieldDefinitions.edges.map((e) => ({
      id: e.node.id,
      cursor: e.cursor,
      namespace: e.node.namespace,
      key: e.node.key,
      name: e.node.name,
      type: e.node.type.name,
      ownerType: e.node.ownerType,
    })),
    hasNextPage: result.data.metafieldDefinitions.pageInfo.hasNextPage,
    endCursor: result.data.metafieldDefinitions.pageInfo.endCursor,
  };
}

export const METAFIELDS_ON_OWNER_QUERY = /* GraphQL */ `
  query MetafieldsOnOwner($ownerId: ID!, $first: Int!, $after: String) {
    node(id: $ownerId) {
      ... on HasMetafields {
        metafields(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              namespace
              key
              type
              value
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export interface MetafieldValue {
  id: string;
  cursor: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export async function listMetafieldsOnOwner(
  client: AdminClient,
  ownerId: string,
  opts: { first?: number; after?: string } = {},
): Promise<{ items: MetafieldValue[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    node: null | { metafields?: { edges: Array<{ cursor: string; node: Omit<MetafieldValue, "cursor"> }>; pageInfo: { hasNextPage: boolean; endCursor?: string } } };
  }>(METAFIELDS_ON_OWNER_QUERY, { ownerId, first: opts.first ?? 50, after: opts.after }, { cost: 10 });
  const conn = result.data.node?.metafields;
  if (!conn) return { items: [], hasNextPage: false };
  return { items: conn.edges.map((e) => ({ ...e.node, cursor: e.cursor })), hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor };
}

export const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        type
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface MetafieldsSetInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

const METAFIELDS_SET_MAX = 25;

export async function setMetafields(client: AdminClient, metafields: MetafieldsSetInput[]): Promise<{ metafields: MetafieldValue[]; userErrors: UserError[] }> {
  if (metafields.length > METAFIELDS_SET_MAX) {
    throw new Error(`metafieldsSet accepts at most ${METAFIELDS_SET_MAX} metafields per call (got ${metafields.length}).`);
  }
  const result = await client.mutate<{ metafieldsSet: { metafields: Array<Omit<MetafieldValue, "cursor">>; userErrors: UserError[] } }>(
    METAFIELDS_SET_MUTATION,
    { metafields },
    { cost: 10 * metafields.length },
  );
  return { metafields: result.data.metafieldsSet.metafields.map((m) => ({ ...m, cursor: "" })), userErrors: result.data.metafieldsSet.userErrors };
}

export const METAFIELDS_DELETE_MUTATION = /* GraphQL */ `
  mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        ownerId
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface MetafieldIdentifier {
  ownerId: string;
  namespace: string;
  key: string;
}

export async function deleteMetafields(client: AdminClient, metafields: MetafieldIdentifier[]): Promise<{ deleted: MetafieldIdentifier[]; userErrors: UserError[] }> {
  const result = await client.mutate<{ metafieldsDelete: { deletedMetafields: MetafieldIdentifier[]; userErrors: UserError[] } }>(
    METAFIELDS_DELETE_MUTATION,
    { metafields },
    { cost: 10 * metafields.length },
  );
  return { deleted: result.data.metafieldsDelete.deletedMetafields, userErrors: result.data.metafieldsDelete.userErrors };
}
