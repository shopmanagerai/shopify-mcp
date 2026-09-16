/**
 * Sales-channel publications (docs/CURRENT_SHOPIFY_RESEARCH.md §5
 * "Publications" row). Used to publish/unpublish a product to the Online
 * Store channel.
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export const PUBLICATIONS_QUERY = /* GraphQL */ `
  query Publications($first: Int!) {
    publications(first: $first) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export interface PublicationItem {
  id: string;
  name: string;
}

export async function listPublications(client: AdminClient, opts: { first?: number } = {}): Promise<PublicationItem[]> {
  const result = await client.query<{ publications: { edges: Array<{ node: PublicationItem }> } }>(PUBLICATIONS_QUERY, { first: opts.first ?? 20 }, { cost: 5 });
  return result.data.publications.edges.map((e) => e.node);
}

export const PUBLISHABLE_PUBLISH_MUTATION = /* GraphQL */ `
  mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!, $publicationId: ID!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        publishedOnPublication(publicationId: $publicationId)
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function publishToPublication(client: AdminClient, resourceId: string, publicationId: string): Promise<{ userErrors: UserError[] }> {
  const result = await client.mutate<{ publishablePublish: { publishable?: unknown; userErrors: UserError[] } }>(
    PUBLISHABLE_PUBLISH_MUTATION,
    { id: resourceId, input: [{ publicationId }], publicationId },
    { cost: 10 },
  );
  return { userErrors: result.data.publishablePublish.userErrors };
}

export const PUBLISHABLE_UNPUBLISH_MUTATION = /* GraphQL */ `
  mutation PublishableUnpublish($id: ID!, $input: [PublicationInput!]!, $publicationId: ID!) {
    publishableUnpublish(id: $id, input: $input) {
      publishable {
        publishedOnPublication(publicationId: $publicationId)
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function unpublishFromPublication(client: AdminClient, resourceId: string, publicationId: string): Promise<{ userErrors: UserError[] }> {
  const result = await client.mutate<{ publishableUnpublish: { publishable?: unknown; userErrors: UserError[] } }>(
    PUBLISHABLE_UNPUBLISH_MUTATION,
    { id: resourceId, input: [{ publicationId }], publicationId },
    { cost: 10 },
  );
  return { userErrors: result.data.publishableUnpublish.userErrors };
}
