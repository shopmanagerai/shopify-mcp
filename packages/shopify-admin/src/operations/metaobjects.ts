/**
 * Metaobjects (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Metaobjects" row).
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export const METAOBJECT_DEFINITIONS_QUERY = /* GraphQL */ `
  query MetaobjectDefinitions($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          type
          name
          fieldDefinitions {
            key
            name
            type {
              name
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

export interface MetaobjectFieldDefinition {
  key: string;
  name: string;
  type: string;
}
export interface MetaobjectDefinition {
  id: string;
  cursor: string;
  type: string;
  name: string;
  fieldDefinitions: MetaobjectFieldDefinition[];
}

export async function listMetaobjectDefinitions(client: AdminClient, opts: { first?: number; after?: string } = {}): Promise<{ items: MetaobjectDefinition[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    metaobjectDefinitions: {
      edges: Array<{ cursor: string; node: { id: string; type: string; name: string; fieldDefinitions: Array<{ key: string; name: string; type: { name: string } }> } }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(METAOBJECT_DEFINITIONS_QUERY, { first: opts.first ?? 20, after: opts.after }, { cost: 10 });
  return {
    items: result.data.metaobjectDefinitions.edges.map((e) => ({
      id: e.node.id,
      cursor: e.cursor,
      type: e.node.type,
      name: e.node.name,
      fieldDefinitions: e.node.fieldDefinitions.map((f) => ({ key: f.key, name: f.name, type: f.type.name })),
    })),
    hasNextPage: result.data.metaobjectDefinitions.pageInfo.hasNextPage,
    endCursor: result.data.metaobjectDefinitions.pageInfo.endCursor,
  };
}

export const METAOBJECTS_BY_TYPE_QUERY = /* GraphQL */ `
  query MetaobjectsByType($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          handle
          type
          fields {
            key
            value
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

export interface MetaobjectFieldValue {
  key: string;
  value: string | null;
}
export interface MetaobjectEntry {
  id: string;
  cursor: string;
  handle: string;
  type: string;
  fields: MetaobjectFieldValue[];
}

export async function listMetaobjects(client: AdminClient, type: string, opts: { first?: number; after?: string } = {}): Promise<{ items: MetaobjectEntry[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    metaobjects: { edges: Array<{ cursor: string; node: Omit<MetaobjectEntry, "cursor"> }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
  }>(METAOBJECTS_BY_TYPE_QUERY, { type, first: opts.first ?? 50, after: opts.after }, { cost: 10 });
  return {
    items: result.data.metaobjects.edges.map((e) => ({ ...e.node, cursor: e.cursor })),
    hasNextPage: result.data.metaobjects.pageInfo.hasNextPage,
    endCursor: result.data.metaobjects.pageInfo.endCursor,
  };
}

export const METAOBJECT_CREATE_MUTATION = /* GraphQL */ `
  mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
        fields {
          key
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface MetaobjectCreateInput {
  type: string;
  handle?: string;
  fields: MetaobjectFieldValue[];
}

export async function createMetaobject(client: AdminClient, input: MetaobjectCreateInput): Promise<{ metaobject?: Omit<MetaobjectEntry, "cursor">; userErrors: UserError[] }> {
  const result = await client.mutate<{ metaobjectCreate: { metaobject?: Omit<MetaobjectEntry, "cursor"> | null; userErrors: UserError[] } }>(
    METAOBJECT_CREATE_MUTATION,
    { metaobject: input },
    { cost: 10 },
  );
  return { metaobject: result.data.metaobjectCreate.metaobject ?? undefined, userErrors: result.data.metaobjectCreate.userErrors };
}

export const METAOBJECT_UPDATE_MUTATION = /* GraphQL */ `
  mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
        fields {
          key
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function updateMetaobject(client: AdminClient, id: string, fields: MetaobjectFieldValue[]): Promise<{ metaobject?: Omit<MetaobjectEntry, "cursor">; userErrors: UserError[] }> {
  const result = await client.mutate<{ metaobjectUpdate: { metaobject?: Omit<MetaobjectEntry, "cursor"> | null; userErrors: UserError[] } }>(
    METAOBJECT_UPDATE_MUTATION,
    { id, metaobject: { fields } },
    { cost: 10 },
  );
  return { metaobject: result.data.metaobjectUpdate.metaobject ?? undefined, userErrors: result.data.metaobjectUpdate.userErrors };
}

/** UNVERIFIED: `metaobjectUpsert` takes a `handle: MetaobjectHandleInput` (type+handle) plus `metaobject: MetaobjectUpsertInput`; confirm exact input name against the live schema. */
export const METAOBJECT_UPSERT_MUTATION = /* GraphQL */ `
  mutation MetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
        fields {
          key
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function upsertMetaobject(
  client: AdminClient,
  handle: { type: string; handle: string },
  fields: MetaobjectFieldValue[],
): Promise<{ metaobject?: Omit<MetaobjectEntry, "cursor">; userErrors: UserError[] }> {
  const result = await client.mutate<{ metaobjectUpsert: { metaobject?: Omit<MetaobjectEntry, "cursor"> | null; userErrors: UserError[] } }>(
    METAOBJECT_UPSERT_MUTATION,
    { handle, metaobject: { fields } },
    { cost: 10 },
  );
  return { metaobject: result.data.metaobjectUpsert.metaobject ?? undefined, userErrors: result.data.metaobjectUpsert.userErrors };
}
