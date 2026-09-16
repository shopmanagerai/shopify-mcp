/**
 * Theme queries/mutations (docs/CURRENT_SHOPIFY_RESEARCH.md §2).
 * `theme.files(filenames:)` returns a union of body shapes; we request all
 * three (`OnlineStoreThemeFileBodyText`, `...Base64`, `...Url`) and normalise
 * to `ThemeFile`. Mutations that touch theme *files* (`themeFilesUpsert`,
 * `themeFilesDelete`) are exemption-gated (engine B), see THEME_ACCESS_STRATEGY.md.
 */
import type { AdminClient, ThemeFile, ThemeFileWrite, ThemeRef } from "@shopmanagerai/shared";
import { ShopManagerAIError, isShopManagerAIError } from "@shopmanagerai/shared";

const THEME_FIELDS = /* GraphQL */ `
  id
  name
  role
  processing
`;

export const THEMES_LIST_QUERY = /* GraphQL */ `
  query ThemesList($first: Int!, $after: String) {
    themes(first: $first, after: $after) {
      edges {
        node {
          ${THEME_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const THEME_BY_ID_QUERY = /* GraphQL */ `
  query ThemeById($id: ID!) {
    theme(id: $id) {
      ${THEME_FIELDS}
    }
  }
`;

const THEME_FILE_BODY_FRAGMENT = /* GraphQL */ `
  filename
  size
  checksumMd5
  contentType
  body {
    ... on OnlineStoreThemeFileBodyText {
      content
    }
    ... on OnlineStoreThemeFileBodyBase64 {
      contentBase64
    }
    ... on OnlineStoreThemeFileBodyUrl {
      url
    }
  }
`;

export const THEME_FILES_QUERY = /* GraphQL */ `
  query ThemeFiles($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      files(filenames: $filenames, first: 250) {
        nodes {
          ${THEME_FILE_BODY_FRAGMENT}
        }
      }
    }
  }
`;

export const THEME_CREATE_MUTATION = /* GraphQL */ `
  mutation ThemeCreate($source: URL!, $name: String) {
    themeCreate(source: $source, name: $name) {
      theme {
        ${THEME_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Verified live 2026-09-05: themeDuplicate(id: ID!, name: String) { newTheme { ... } userErrors }
 * per docs/CURRENT_SHOPIFY_RESEARCH.md §2. Confirm the exact argument name
 * (`themeId` assumed) against the live schema before relying on this in prod.
 */
export const THEME_DUPLICATE_MUTATION = /* GraphQL */ `
  mutation ThemeDuplicate($id: ID!, $name: String) {
    themeDuplicate(id: $id, name: $name) {
      newTheme {
        ${THEME_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const THEME_PUBLISH_MUTATION = /* GraphQL */ `
  mutation ThemePublish($id: ID!) {
    themePublish(id: $id) {
      theme {
        ${THEME_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const THEME_DELETE_MUTATION = /* GraphQL */ `
  mutation ThemeDelete($id: ID!) {
    themeDelete(id: $id) {
      deletedThemeId
      userErrors {
        field
        message
      }
    }
  }
`;

export const THEME_UPDATE_MUTATION = /* GraphQL */ `
  mutation ThemeUpdate($id: ID!, $input: OnlineStoreThemeInput!) {
    themeUpdate(id: $id, input: $input) {
      theme {
        ${THEME_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const THEME_FILES_UPSERT_MUTATION = /* GraphQL */ `
  mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles {
        filename
      }
      userErrors {
        field
        message
        filename
      }
    }
  }
`;

export const THEME_FILES_DELETE_MUTATION = /* GraphQL */ `
  mutation ThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles {
        filename
      }
      userErrors {
        field
        message
        filename
      }
    }
  }
`;

interface RawThemeNode {
  id: string;
  name: string;
  role: string;
  processing?: boolean | null;
}

function toThemeRef(node: RawThemeNode): ThemeRef {
  return {
    id: gidToNumericId(node.id),
    gid: node.id,
    name: node.name,
    role: mapRole(node.role),
    processing: node.processing ?? undefined,
  };
}

function mapRole(role: string): ThemeRef["role"] {
  const lower = role.toLowerCase();
  if (lower === "main" || lower === "unpublished" || lower === "development" || lower === "demo") return lower;
  return lower;
}

export function gidToNumericId(gid: string): string {
  const match = /\/(\d+)$/.exec(gid);
  return match ? match[1]! : gid;
}

export function numericIdToGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/OnlineStoreTheme/${id}`;
}

export async function listThemes(client: AdminClient): Promise<ThemeRef[]> {
  const out: ThemeRef[] = [];
  let after: string | undefined;
  for (;;) {
    const result = await client.query<{
      themes: { edges: Array<{ node: RawThemeNode }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
    }>(THEMES_LIST_QUERY, { first: 50, after }, { cost: 50 });
    for (const edge of result.data.themes.edges) out.push(toThemeRef(edge.node));
    if (!result.data.themes.pageInfo.hasNextPage) break;
    after = result.data.themes.pageInfo.endCursor;
  }
  return out;
}

export async function getTheme(client: AdminClient, themeId: string): Promise<ThemeRef | null> {
  // Theme ids are numeric; anything else can never resolve, and Shopify answers a malformed
  // gid with a GraphQL error rather than null. Both cases are "not found" for callers.
  if (!/^\d+$/.test(String(themeId).replace(/^gid:\/\/shopify\/OnlineStoreTheme\//, ""))) return null;
  try {
    const result = await client.query<{ theme: RawThemeNode | null }>(THEME_BY_ID_QUERY, { id: numericIdToGid(themeId) }, { cost: 5 });
    return result.data.theme ? toThemeRef(result.data.theme) : null;
  } catch (e) {
    if (isShopManagerAIError(e) && e.code === "UPSTREAM_ERROR" && /invalid|not found|does not exist/i.test(e.technicalMessage ?? "")) return null;
    throw e;
  }
}

interface RawThemeFileBody {
  content?: string;
  contentBase64?: string;
  url?: string;
}
interface RawThemeFileNode {
  filename: string;
  size?: number | null;
  checksumMd5?: string | null;
  contentType?: string | null;
  body?: RawThemeFileBody | null;
}

/** Shopify caps the `filenames` argument at 50 per query (verified live 2026-09-05). */
const READ_CHUNK = 50;

export async function readThemeFiles(client: AdminClient, themeId: string, filenames: string[]): Promise<ThemeFile[]> {
  if (filenames.length === 0) return [];
  const nodes: RawThemeFileNode[] = [];
  for (let i = 0; i < filenames.length; i += READ_CHUNK) {
    const chunk = filenames.slice(i, i + READ_CHUNK);
    const result = await client.query<{ theme: { files: { nodes: RawThemeFileNode[] } } | null }>(
      THEME_FILES_QUERY,
      { id: numericIdToGid(themeId), filenames: chunk },
      { cost: Math.max(10, chunk.length * 2) },
    );
    nodes.push(...(result.data.theme?.files.nodes ?? []));
  }
  return nodes.map((node) => ({
    key: node.filename,
    content: node.body?.content ?? undefined,
    contentBase64: node.body?.contentBase64 ?? undefined,
    size: node.size ?? undefined,
    checksum: node.checksumMd5 ?? undefined,
    contentType: node.contentType ?? undefined,
  }));
}

export async function themeCreate(client: AdminClient, source: string, name?: string): Promise<ThemeRef> {
  const result = await client.mutate<{ themeCreate: { theme: RawThemeNode | null; userErrors: Array<{ field: string[]; message: string }> } }>(
    THEME_CREATE_MUTATION,
    { source, name },
    { cost: 10 },
  );
  const payload = result.data.themeCreate;
  assertNoUserErrors(payload.userErrors, "themeCreate");
  if (!payload.theme) throw new Error("themeCreate returned no theme");
  return toThemeRef(payload.theme);
}

export async function themeDuplicate(client: AdminClient, sourceThemeId: string, name?: string): Promise<ThemeRef> {
  const result = await client.mutate<{
    themeDuplicate: { newTheme: RawThemeNode | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(THEME_DUPLICATE_MUTATION, { id: numericIdToGid(sourceThemeId), name }, { cost: 50 });
  const payload = result.data.themeDuplicate;
  assertNoUserErrors(payload.userErrors, "themeDuplicate");
  if (!payload.newTheme) throw new Error("themeDuplicate returned no theme");
  return waitForThemeProcessing(client, toThemeRef(payload.newTheme));
}

/**
 * themeDuplicate / themeCreate return while Shopify is still copying files
 * (`processing: true`); listing the new theme's files during that window
 * returns an empty (or partial) set. Poll until processing finishes.
 */
export async function waitForThemeProcessing(client: AdminClient, theme: ThemeRef, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<ThemeRef> {
  if (theme.processing === false) return theme;
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  let current = theme;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 1500));
    const fresh = await getTheme(client, theme.id);
    if (fresh) current = fresh;
    if (current.processing === false) return current;
  }
  return current;
}

export async function themePublish(client: AdminClient, themeId: string): Promise<ThemeRef> {
  const result = await client.mutate<{ themePublish: { theme: RawThemeNode | null; userErrors: Array<{ field: string[]; message: string }> } }>(
    THEME_PUBLISH_MUTATION,
    { id: numericIdToGid(themeId) },
    { cost: 10 },
  );
  const payload = result.data.themePublish;
  assertNoUserErrors(payload.userErrors, "themePublish");
  if (!payload.theme) throw new Error("themePublish returned no theme");
  return toThemeRef(payload.theme);
}

export async function themeDelete(client: AdminClient, themeId: string): Promise<void> {
  const result = await client.mutate<{ themeDelete: { deletedThemeId: string | null; userErrors: Array<{ field: string[]; message: string }> } }>(
    THEME_DELETE_MUTATION,
    { id: numericIdToGid(themeId) },
    { cost: 10 },
  );
  assertNoUserErrors(result.data.themeDelete.userErrors, "themeDelete");
}

export async function themeUpdate(client: AdminClient, themeId: string, name: string): Promise<ThemeRef> {
  const result = await client.mutate<{ themeUpdate: { theme: RawThemeNode | null; userErrors: Array<{ field: string[]; message: string }> } }>(
    THEME_UPDATE_MUTATION,
    { id: numericIdToGid(themeId), input: { name } },
    { cost: 10 },
  );
  const payload = result.data.themeUpdate;
  assertNoUserErrors(payload.userErrors, "themeUpdate");
  if (!payload.theme) throw new Error("themeUpdate returned no theme");
  return toThemeRef(payload.theme);
}

export interface ThemeFilesUpsertResult {
  written: string[];
  errors: Array<{ key: string; message: string }>;
}

export async function themeFilesUpsert(client: AdminClient, themeId: string, files: ThemeFileWrite[]): Promise<ThemeFilesUpsertResult> {
  const input = files.map((f) => ({
    filename: f.key,
    body:
      f.contentBase64 !== undefined
        ? { type: "BASE64" as const, value: f.contentBase64 }
        : { type: "TEXT" as const, value: f.content ?? "" },
  }));
  const result = await client.mutate<{
    themeFilesUpsert: {
      upsertedThemeFiles: Array<{ filename: string }>;
      userErrors: Array<{ field: string[]; message: string; filename?: string | null }>;
    };
  }>(THEME_FILES_UPSERT_MUTATION, { themeId: numericIdToGid(themeId), files: input }, { cost: Math.max(10, files.length * 5) });
  const payload = result.data.themeFilesUpsert;
  return {
    written: payload.upsertedThemeFiles.map((f) => f.filename),
    errors: payload.userErrors.map((e) => ({ key: e.filename ?? "", message: e.message })),
  };
}

export interface ThemeFilesDeleteResult {
  deleted: string[];
  errors: Array<{ key: string; message: string }>;
}

export async function themeFilesDelete(client: AdminClient, themeId: string, keys: string[]): Promise<ThemeFilesDeleteResult> {
  const result = await client.mutate<{
    themeFilesDelete: {
      deletedThemeFiles: Array<{ filename: string }>;
      userErrors: Array<{ field: string[]; message: string; filename?: string | null }>;
    };
  }>(THEME_FILES_DELETE_MUTATION, { themeId: numericIdToGid(themeId), files: keys }, { cost: Math.max(10, keys.length * 2) });
  const payload = result.data.themeFilesDelete;
  return {
    deleted: payload.deletedThemeFiles.map((f) => f.filename),
    errors: payload.userErrors.map((e) => ({ key: e.filename ?? "", message: e.message })),
  };
}

function assertNoUserErrors(userErrors: Array<{ field: string[]; message: string }>, op: string): void {
  if (userErrors.length > 0) {
    // Shopify validation results are the caller's problem (bad src URL, duplicate name, ...), not a server fault.
    const err = new ShopManagerAIError("USER_ERRORS", `${op} userErrors: ${userErrors.map((e) => e.message).join("; ")}`, { retryable: false, details: { userErrors } });
    (err as any).userErrors = userErrors;
    throw err;
  }
}

/** Metadata-only listing (no bodies). `theme.files` paginates at 250 per page. */
export const THEME_FILES_LIST_QUERY = /* GraphQL */ `
  query ThemeFilesList($id: ID!, $after: String) {
    theme(id: $id) {
      files(first: 250, after: $after) {
        nodes {
          filename
          size
          contentType
          checksumMd5
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/**
 * Lists every file in a theme (metadata only), following pagination. Verified live
 * 2026-09-05: `files` lists without a `filenames` filter. Optional prefix filter is
 * applied client-side (e.g. "sections/").
 */
export async function listThemeFiles(client: AdminClient, themeId: string, opts: { prefix?: string } = {}): Promise<ThemeFile[]> {
  const out: ThemeFile[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const result: { data: { theme: { files: { nodes: Array<{ filename: string; size?: number | string | null; contentType?: string | null; checksumMd5?: string | null }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null } } =
      await client.query(THEME_FILES_LIST_QUERY, { id: numericIdToGid(themeId), after }, { cost: 30 });
    const files = result.data.theme?.files;
    if (!files) break;
    for (const n of files.nodes) {
      if (opts.prefix && !n.filename.startsWith(opts.prefix)) continue;
      out.push({
        key: n.filename,
        size: n.size == null ? undefined : Number(n.size),
        contentType: n.contentType ?? undefined,
        checksum: n.checksumMd5 ?? undefined,
      });
    }
    if (!files.pageInfo.hasNextPage || !files.pageInfo.endCursor) break;
    after = files.pageInfo.endCursor;
  }
  return out;
}
