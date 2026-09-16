/**
 * Media / Files (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Media" row).
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export const FILES_LIST_QUERY = /* GraphQL */ `
  query FilesList($first: Int!, $after: String, $query: String) {
    files(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          ... on MediaImage {
            id
            alt
            image {
              url
              width
              height
            }
          }
          ... on GenericFile {
            id
            alt
            url
          }
          ... on Video {
            id
            alt
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

export interface FileListItem {
  id: string;
  cursor: string;
  alt?: string;
  url?: string;
  width?: number;
  height?: number;
}

export async function listFiles(client: AdminClient, opts: { first?: number; after?: string; query?: string } = {}): Promise<{ items: FileListItem[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    files: { edges: Array<{ cursor: string; node: { id: string; alt?: string | null; url?: string; image?: { url?: string; width?: number; height?: number } } }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
  }>(FILES_LIST_QUERY, { first: opts.first ?? 50, after: opts.after, query: opts.query }, { cost: 10 });
  return {
    items: result.data.files.edges.map((e) => ({
      id: e.node.id,
      cursor: e.cursor,
      alt: e.node.alt ?? undefined,
      url: e.node.image?.url ?? e.node.url,
      width: e.node.image?.width,
      height: e.node.image?.height,
    })),
    hasNextPage: result.data.files.pageInfo.hasNextPage,
    endCursor: result.data.files.pageInfo.endCursor,
  };
}

export const PRODUCT_MEDIA_QUERY = /* GraphQL */ `
  query ProductMedia($id: ID!, $first: Int!) {
    product(id: $id) {
      id
      media(first: $first) {
        edges {
          node {
            id
            alt
            mediaContentType
            preview {
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export interface ProductMediaItem {
  id: string;
  alt?: string;
  mediaContentType: string;
  previewUrl?: string;
}

export async function listProductMedia(client: AdminClient, productId: string, opts: { first?: number } = {}): Promise<ProductMediaItem[]> {
  const result = await client.query<{
    product: null | { id: string; media: { edges: Array<{ node: { id: string; alt?: string | null; mediaContentType: string; preview?: { image?: { url?: string } } } }> } };
  }>(PRODUCT_MEDIA_QUERY, { id: productId, first: opts.first ?? 50 }, { cost: 10 });
  const media = result.data.product?.media.edges ?? [];
  return media.map((e) => ({ id: e.node.id, alt: e.node.alt ?? undefined, mediaContentType: e.node.mediaContentType, previewUrl: e.node.preview?.image?.url }));
}

export const FILE_UPDATE_MUTATION = /* GraphQL */ `
  mutation FileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
        alt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function updateFileAlt(client: AdminClient, id: string, alt: string): Promise<{ id?: string; alt?: string; userErrors: UserError[] }> {
  const result = await client.mutate<{ fileUpdate: { files: Array<{ id: string; alt?: string | null }>; userErrors: UserError[] } }>(
    FILE_UPDATE_MUTATION,
    { files: [{ id, alt }] },
    { cost: 10 },
  );
  const f = result.data.fileUpdate.files[0];
  return { id: f?.id, alt: f?.alt ?? undefined, userErrors: result.data.fileUpdate.userErrors };
}

export const PRODUCT_UPDATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation ProductUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export interface UpdateMediaInput {
  id: string;
  alt?: string;
}

export async function updateProductMediaAlt(client: AdminClient, productId: string, media: UpdateMediaInput[]): Promise<{ updated: Array<{ id: string; alt?: string }>; userErrors: UserError[] }> {
  const result = await client.mutate<{ productUpdateMedia: { media: Array<{ id: string; alt?: string | null }>; mediaUserErrors: UserError[] } }>(
    PRODUCT_UPDATE_MEDIA_MUTATION,
    { productId, media },
    { cost: 10 },
  );
  return { updated: result.data.productUpdateMedia.media.map((m) => ({ id: m.id, alt: m.alt ?? undefined })), userErrors: result.data.productUpdateMedia.mediaUserErrors };
}

// ---------------------------------------------------------------------------
// Upload/import (docs/MCP_TOOL_MANIFEST.md media upload row).
// `stagedUploadsCreate` + a PUT to the returned URL is Shopify's documented
// path for uploading a file's bytes; `fileCreate` then registers it (either
// from a completed staged upload's resourceUrl, or directly from an
// `originalSource` URL for the "import by URL" path. No staged upload needed
// when Shopify can fetch the source itself).
// ---------------------------------------------------------------------------
export const STAGED_UPLOADS_CREATE_MUTATION = /* GraphQL */ `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
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

export interface StagedTarget {
  url: string;
  resourceUrl?: string;
  parameters: Array<{ name: string; value: string }>;
}

export async function stagedUploadsCreate(
  client: AdminClient,
  input: { filename: string; mimeType: string; fileSize: string; resource?: string },
): Promise<{ target?: StagedTarget; userErrors: UserError[] }> {
  const result = await client.mutate<{ stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: UserError[] } }>(
    STAGED_UPLOADS_CREATE_MUTATION,
    {
      input: [
        {
          filename: input.filename,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          resource: input.resource ?? "FILE",
          httpMethod: "POST",
        },
      ],
    },
    { cost: 10 },
  );
  return { target: result.data.stagedUploadsCreate.stagedTargets[0], userErrors: result.data.stagedUploadsCreate.userErrors };
}

export const FILE_CREATE_MUTATION = /* GraphQL */ `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
        ... on MediaImage {
          image {
            url
          }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface FileCreateResult {
  id: string;
  alt?: string;
  url?: string;
}

export async function fileCreate(
  client: AdminClient,
  input: { originalSource: string; alt?: string; contentType?: "IMAGE" | "VIDEO" | "FILE" },
): Promise<{ file?: FileCreateResult; userErrors: UserError[] }> {
  const result = await client.mutate<{ fileCreate: { files: Array<{ id: string; alt?: string | null; image?: { url?: string }; url?: string }>; userErrors: UserError[] } }>(
    FILE_CREATE_MUTATION,
    { files: [{ originalSource: input.originalSource, alt: input.alt, contentType: input.contentType ?? "FILE" }] },
    { cost: 10 },
  );
  const f = result.data.fileCreate.files[0];
  return {
    file: f ? { id: f.id, alt: f.alt ?? undefined, url: f.image?.url ?? f.url } : undefined,
    userErrors: result.data.fileCreate.userErrors,
  };
}

export const PRODUCT_CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        alt
        mediaContentType
        ... on MediaImage {
          id
          image {
            url
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export interface ProductCreateMediaResult {
  id?: string;
  alt?: string;
  url?: string;
}

export async function productCreateMedia(
  client: AdminClient,
  productId: string,
  media: Array<{ originalSource: string; alt?: string; mediaContentType?: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO" | "MODEL_3D" }>,
): Promise<{ media: ProductCreateMediaResult[]; userErrors: UserError[] }> {
  const result = await client.mutate<{
    productCreateMedia: { media: Array<{ id?: string; alt?: string | null; image?: { url?: string } }>; mediaUserErrors: UserError[] };
  }>(
    PRODUCT_CREATE_MEDIA_MUTATION,
    { productId, media: media.map((m) => ({ originalSource: m.originalSource, alt: m.alt, mediaContentType: m.mediaContentType ?? "IMAGE" })) },
    { cost: 10 },
  );
  return {
    media: result.data.productCreateMedia.media.map((m) => ({ id: m.id, alt: m.alt ?? undefined, url: m.image?.url })),
    userErrors: result.data.productCreateMedia.mediaUserErrors,
  };
}
