/**
 * URL redirects (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Redirects" row).
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export const URL_REDIRECTS_LIST_QUERY = /* GraphQL */ `
  query UrlRedirectsList($first: Int!, $after: String, $query: String) {
    urlRedirects(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          path
          target
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface UrlRedirectItem {
  id: string;
  cursor: string;
  path: string;
  target: string;
}

export async function listUrlRedirects(client: AdminClient, opts: { first?: number; after?: string; query?: string } = {}): Promise<{ items: UrlRedirectItem[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    urlRedirects: { edges: Array<{ cursor: string; node: Omit<UrlRedirectItem, "cursor"> }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
  }>(URL_REDIRECTS_LIST_QUERY, { first: opts.first ?? 50, after: opts.after, query: opts.query }, { cost: 10 });
  return {
    items: result.data.urlRedirects.edges.map((e) => ({ ...e.node, cursor: e.cursor })),
    hasNextPage: result.data.urlRedirects.pageInfo.hasNextPage,
    endCursor: result.data.urlRedirects.pageInfo.endCursor,
  };
}

export const URL_REDIRECT_CREATE_MUTATION = /* GraphQL */ `
  mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function createUrlRedirect(client: AdminClient, path: string, target: string): Promise<{ redirect?: UrlRedirectItem; userErrors: UserError[] }> {
  const result = await client.mutate<{ urlRedirectCreate: { urlRedirect?: Omit<UrlRedirectItem, "cursor"> | null; userErrors: UserError[] } }>(
    URL_REDIRECT_CREATE_MUTATION,
    { urlRedirect: { path, target } },
    { cost: 10 },
  );
  const r = result.data.urlRedirectCreate.urlRedirect;
  return { redirect: r ? { ...r, cursor: "" } : undefined, userErrors: result.data.urlRedirectCreate.userErrors };
}

export const URL_REDIRECT_UPDATE_MUTATION = /* GraphQL */ `
  mutation UrlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function updateUrlRedirect(client: AdminClient, id: string, input: { path?: string; target?: string }): Promise<{ redirect?: UrlRedirectItem; userErrors: UserError[] }> {
  const result = await client.mutate<{ urlRedirectUpdate: { urlRedirect?: Omit<UrlRedirectItem, "cursor"> | null; userErrors: UserError[] } }>(
    URL_REDIRECT_UPDATE_MUTATION,
    { id, urlRedirect: input },
    { cost: 10 },
  );
  const r = result.data.urlRedirectUpdate.urlRedirect;
  return { redirect: r ? { ...r, cursor: "" } : undefined, userErrors: result.data.urlRedirectUpdate.userErrors };
}

export const URL_REDIRECT_DELETE_MUTATION = /* GraphQL */ `
  mutation UrlRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors {
        field
        message
      }
    }
  }
`;

export async function deleteUrlRedirect(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const result = await client.mutate<{ urlRedirectDelete: { deletedUrlRedirectId?: string | null; userErrors: UserError[] } }>(URL_REDIRECT_DELETE_MUTATION, { id }, { cost: 10 });
  return { deletedId: result.data.urlRedirectDelete.deletedUrlRedirectId ?? undefined, userErrors: result.data.urlRedirectDelete.userErrors };
}
