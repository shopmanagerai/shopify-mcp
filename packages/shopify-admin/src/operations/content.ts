/**
 * Online Store content: pages, blogs, articles (docs/CURRENT_SHOPIFY_RESEARCH.md
 * §5 "Content" row). Articles created via `articleCreate` default to
 * `isPublished: false` (draft) at the call site, never here.
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

/**
 * Page and Article have no `seo` field in the Admin API (verified live 2026-09-06 via
 * introspection). Their SEO title/description live in the `global.title_tag` and
 * `global.description_tag` metafields, exactly like the Online Store editor writes them.
 */
const SEO_FIELDS = /* GraphQL */ `
      seoTitle: metafield(namespace: "global", key: "title_tag") {
        value
      }
      seoDescription: metafield(namespace: "global", key: "description_tag") {
        value
      }`;
interface SeoNode {
  seoTitle?: { value?: string | null } | null;
  seoDescription?: { value?: string | null } | null;
}
function seoFrom(node: SeoNode): { title?: string; description?: string } | undefined {
  const title = node.seoTitle?.value ?? undefined;
  const description = node.seoDescription?.value ?? undefined;
  return title === undefined && description === undefined ? undefined : { title, description };
}
export interface SeoMetafieldInput {
  namespace: "global";
  key: "title_tag" | "description_tag";
  type: "single_line_text_field" | "multi_line_text_field";
  value: string;
}
/** Maps the tool-level `seo` object onto the metafields Shopify actually accepts. */
export function seoToMetafields(seo?: { title?: string; description?: string }): SeoMetafieldInput[] | undefined {
  if (!seo) return undefined;
  const out: SeoMetafieldInput[] = [];
  if (seo.title !== undefined) out.push({ namespace: "global", key: "title_tag", type: "single_line_text_field", value: seo.title });
  if (seo.description !== undefined) out.push({ namespace: "global", key: "description_tag", type: "multi_line_text_field", value: seo.description });
  return out.length > 0 ? out : undefined;
}
function withSeoMetafields<T extends { seo?: { title?: string; description?: string } }>(input: T): Omit<T, "seo"> & { metafields?: SeoMetafieldInput[] } {
  const { seo, ...rest } = input;
  const metafields = seoToMetafields(seo);
  return metafields ? { ...rest, metafields } : rest;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
export const PAGES_LIST_QUERY = /* GraphQL */ `
  query PagesList($first: Int!, $after: String, $query: String) {
    pages(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          title
          handle
          isPublished
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface PageListItem {
  id: string;
  cursor: string;
  title: string;
  handle: string;
  isPublished: boolean;
  updatedAt?: string;
}
export interface PagesPage {
  items: PageListItem[];
  hasNextPage: boolean;
  endCursor?: string;
}

export async function listPages(client: AdminClient, opts: { first?: number; after?: string; query?: string } = {}): Promise<PagesPage> {
  const result = await client.query<{
    pages: { edges: Array<{ cursor: string; node: Omit<PageListItem, "cursor"> }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
  }>(PAGES_LIST_QUERY, { first: opts.first ?? 50, after: opts.after, query: opts.query }, { cost: Math.max(10, (opts.first ?? 50) * 2) });
  return {
    items: result.data.pages.edges.map((e) => ({ ...e.node, cursor: e.cursor })),
    hasNextPage: result.data.pages.pageInfo.hasNextPage,
    endCursor: result.data.pages.pageInfo.endCursor,
  };
}

export const PAGE_BY_ID_QUERY = /* GraphQL */ `
  query PageById($id: ID!) {
    page(id: $id) {
      id
      title
      handle
      body
      isPublished
      templateSuffix
      ${SEO_FIELDS}
      updatedAt
    }
  }
`;

export interface PageDetail {
  id: string;
  title: string;
  handle: string;
  body?: string;
  isPublished: boolean;
  templateSuffix?: string;
  seo?: { title?: string; description?: string };
  updatedAt?: string;
}

export async function getPage(client: AdminClient, id: string): Promise<PageDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Page/${id}`;
  const result = await client.query<{
    page: null | ({
      id: string;
      title: string;
      handle: string;
      body?: string | null;
      isPublished: boolean;
      templateSuffix?: string | null;
      updatedAt?: string;
    } & SeoNode);
  }>(PAGE_BY_ID_QUERY, { id: gid }, { cost: 5 });
  const p = result.data.page;
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    body: p.body ?? undefined,
    isPublished: p.isPublished,
    templateSuffix: p.templateSuffix ?? undefined,
    seo: seoFrom(p),
    updatedAt: p.updatedAt,
  };
}

export const PAGE_CREATE_MUTATION = /* GraphQL */ `
  mutation PageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
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

export interface PageCreateInput {
  title: string;
  body?: string;
  isPublished?: boolean;
  templateSuffix?: string;
  seo?: { title?: string; description?: string };
}

export async function createPage(client: AdminClient, input: PageCreateInput): Promise<{ page?: { id: string; title: string; handle: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ pageCreate: { page?: { id: string; title: string; handle: string } | null; userErrors: UserError[] } }>(
    PAGE_CREATE_MUTATION,
    { page: withSeoMetafields(input) },
    { cost: 10 },
  );
  return { page: result.data.pageCreate.page ?? undefined, userErrors: result.data.pageCreate.userErrors };
}

export const PAGE_UPDATE_MUTATION = /* GraphQL */ `
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        title
        handle
        body
        isPublished
      ${SEO_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface PageUpdateInput {
  title?: string;
  body?: string;
  isPublished?: boolean;
  templateSuffix?: string;
  seo?: { title?: string; description?: string };
}

export async function updatePage(client: AdminClient, id: string, input: PageUpdateInput): Promise<{ page?: PageDetail; userErrors: UserError[] }> {
  const result = await client.mutate<{
    pageUpdate: {
      page?: ({ id: string; title: string; handle: string; body?: string | null; isPublished: boolean } & SeoNode) | null;
      userErrors: UserError[];
    };
  }>(PAGE_UPDATE_MUTATION, { id, page: withSeoMetafields(input) }, { cost: 10 });
  const p = result.data.pageUpdate.page;
  return {
    page: p
      ? { id: p.id, title: p.title, handle: p.handle, body: p.body ?? undefined, isPublished: p.isPublished, seo: seoFrom(p) }
      : undefined,
    userErrors: result.data.pageUpdate.userErrors,
  };
}

// ---------------------------------------------------------------------------
// Blogs
// ---------------------------------------------------------------------------
export const BLOGS_LIST_QUERY = /* GraphQL */ `
  query BlogsList($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          handle
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface BlogListItem {
  id: string;
  cursor: string;
  title: string;
  handle: string;
}
export async function listBlogs(client: AdminClient, opts: { first?: number; after?: string } = {}): Promise<{ items: BlogListItem[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{ blogs: { edges: Array<{ cursor: string; node: Omit<BlogListItem, "cursor"> }>; pageInfo: { hasNextPage: boolean; endCursor?: string } } }>(
    BLOGS_LIST_QUERY,
    { first: opts.first ?? 50, after: opts.after },
    { cost: 10 },
  );
  return {
    items: result.data.blogs.edges.map((e) => ({ ...e.node, cursor: e.cursor })),
    hasNextPage: result.data.blogs.pageInfo.hasNextPage,
    endCursor: result.data.blogs.pageInfo.endCursor,
  };
}

export const BLOG_BY_ID_QUERY = /* GraphQL */ `
  query BlogById($id: ID!) {
    blog(id: $id) {
      id
      title
      handle
    }
  }
`;
export async function getBlog(client: AdminClient, id: string): Promise<{ id: string; title: string; handle: string } | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Blog/${id}`;
  const result = await client.query<{ blog: null | { id: string; title: string; handle: string } }>(BLOG_BY_ID_QUERY, { id: gid }, { cost: 2 });
  return result.data.blog;
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------
const ARTICLE_LIST_NODE = /* GraphQL */ `
        cursor
        node {
          id
          title
          handle
          isPublished
          blog {
            id
          }
          updatedAt
        }`;
export const ARTICLES_LIST_QUERY = /* GraphQL */ `
  query ArticlesList($first: Int!, $after: String, $query: String) {
    articles(first: $first, after: $after, query: $query) {
      edges {
        ${ARTICLE_LIST_NODE}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
/** `articles` has no blog filter, so a blog-scoped listing goes through `blog.articles`. */
export const BLOG_ARTICLES_LIST_QUERY = /* GraphQL */ `
  query BlogArticlesList($blogId: ID!, $first: Int!, $after: String, $query: String) {
    blog(id: $blogId) {
      articles(first: $first, after: $after, query: $query) {
        edges {
          ${ARTICLE_LIST_NODE}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export interface ArticleListItem {
  id: string;
  cursor: string;
  title: string;
  handle: string;
  isPublished: boolean;
  blogId: string;
  updatedAt?: string;
}

export async function listArticles(
  client: AdminClient,
  opts: { blogId?: string; first?: number; after?: string; query?: string } = {},
): Promise<{ items: ArticleListItem[]; hasNextPage: boolean; endCursor?: string }> {
  type Conn = { edges: Array<{ cursor: string; node: { id: string; title: string; handle: string; isPublished: boolean; blog: { id: string }; updatedAt?: string } }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
  const vars = { first: opts.first ?? 50, after: opts.after, query: opts.query };
  let conn: Conn;
  if (opts.blogId) {
    const blogGid = opts.blogId.startsWith("gid://") ? opts.blogId : `gid://shopify/Blog/${opts.blogId}`;
    const result = await client.query<{ blog: { articles: Conn } | null }>(BLOG_ARTICLES_LIST_QUERY, { ...vars, blogId: blogGid }, { cost: 10 });
    conn = result.data.blog?.articles ?? { edges: [], pageInfo: { hasNextPage: false } };
  } else {
    const result = await client.query<{ articles: Conn }>(ARTICLES_LIST_QUERY, vars, { cost: 10 });
    conn = result.data.articles;
  }
  const result = { data: { articles: conn } };
  return {
    items: result.data.articles.edges.map((e) => ({ id: e.node.id, cursor: e.cursor, title: e.node.title, handle: e.node.handle, isPublished: e.node.isPublished, blogId: e.node.blog.id, updatedAt: e.node.updatedAt })),
    hasNextPage: result.data.articles.pageInfo.hasNextPage,
    endCursor: result.data.articles.pageInfo.endCursor,
  };
}

export const ARTICLE_BY_ID_QUERY = /* GraphQL */ `
  query ArticleById($id: ID!) {
    article(id: $id) {
      id
      title
      handle
      body
      isPublished
      blog {
        id
      }
      ${SEO_FIELDS}
      updatedAt
    }
  }
`;
export interface ArticleDetail {
  id: string;
  title: string;
  handle: string;
  body?: string;
  isPublished: boolean;
  blogId: string;
  seo?: { title?: string; description?: string };
  updatedAt?: string;
}
export async function getArticle(client: AdminClient, id: string): Promise<ArticleDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Article/${id}`;
  const result = await client.query<{
    article: null | ({
      id: string;
      title: string;
      handle: string;
      body?: string | null;
      isPublished: boolean;
      blog: { id: string };
      updatedAt?: string;
    } & SeoNode);
  }>(ARTICLE_BY_ID_QUERY, { id: gid }, { cost: 5 });
  const a = result.data.article;
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    handle: a.handle,
    body: a.body ?? undefined,
    isPublished: a.isPublished,
    blogId: a.blog.id,
    seo: seoFrom(a),
    updatedAt: a.updatedAt,
  };
}

/** Draft-only convenience: `articleCreate` always receives `isPublished: false` here. */
export const ARTICLE_CREATE_MUTATION = /* GraphQL */ `
  mutation ArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        id
        title
        handle
        isPublished
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export interface ArticleCreateInput {
  blogId: string;
  title: string;
  body?: string;
  author?: { name: string };
  tags?: string[];
}
const SHOP_NAME_QUERY = /* GraphQL */ `
  query ShopNameForAuthor {
    shop {
      name
    }
  }
`;
/** `ArticleCreateInput.author` is required by Shopify; default to the shop name when the caller gives none. */
export async function createDraftArticle(client: AdminClient, input: ArticleCreateInput): Promise<{ article?: { id: string; title: string; handle: string; isPublished: boolean }; userErrors: UserError[] }> {
  let author = input.author;
  if (!author?.name) {
    const shop = await client.query<{ shop: { name: string } }>(SHOP_NAME_QUERY, {}, { cost: 1 });
    author = { name: shop.data.shop.name };
  }
  const result = await client.mutate<{ articleCreate: { article?: { id: string; title: string; handle: string; isPublished: boolean } | null; userErrors: UserError[] } }>(
    ARTICLE_CREATE_MUTATION,
    { article: { ...input, author, isPublished: false } },
    { cost: 10 },
  );
  return { article: result.data.articleCreate.article ?? undefined, userErrors: result.data.articleCreate.userErrors };
}

export const ARTICLE_UPDATE_MUTATION = /* GraphQL */ `
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article {
        id
        title
        handle
        body
        isPublished
      ${SEO_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export interface ArticleUpdateInput {
  title?: string;
  body?: string;
  isPublished?: boolean;
  seo?: { title?: string; description?: string };
}
export async function updateArticle(client: AdminClient, id: string, input: ArticleUpdateInput): Promise<{ article?: ArticleDetail; userErrors: UserError[] }> {
  const result = await client.mutate<{
    articleUpdate: {
      article?: ({ id: string; title: string; handle: string; body?: string | null; isPublished: boolean } & SeoNode) | null;
      userErrors: UserError[];
    };
  }>(ARTICLE_UPDATE_MUTATION, { id, article: withSeoMetafields(input) }, { cost: 10 });
  const a = result.data.articleUpdate.article;
  return {
    article: a
      ? { id: a.id, title: a.title, handle: a.handle, body: a.body ?? undefined, isPublished: a.isPublished, blogId: "", seo: seoFrom(a) }
      : undefined,
    userErrors: result.data.articleUpdate.userErrors,
  };
}

export const PAGEDELETE_MUTATION = /* GraphQL */ `
  mutation PageDelete($id: ID!) {
    pageDelete(id: $id) {
      deletedPageId
      userErrors {
        field
        message
      }
    }
  }
`;
/** Used by ledger rollback to undo a `create` (create → delete). */
export async function deletePage(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Page/${id}`;
  const result = await client.mutate<{ pageDelete: { deletedPageId?: string | null; userErrors: UserError[] } }>(PAGEDELETE_MUTATION, { id: gid }, { cost: 10 });
  return { deletedId: result.data.pageDelete.deletedPageId ?? undefined, userErrors: result.data.pageDelete.userErrors };
}

export const ARTICLEDELETE_MUTATION = /* GraphQL */ `
  mutation ArticleDelete($id: ID!) {
    articleDelete(id: $id) {
      deletedArticleId
      userErrors {
        field
        message
      }
    }
  }
`;
/** Used by ledger rollback to undo a `create` (create → delete). */
export async function deleteArticle(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Article/${id}`;
  const result = await client.mutate<{ articleDelete: { deletedArticleId?: string | null; userErrors: UserError[] } }>(ARTICLEDELETE_MUTATION, { id: gid }, { cost: 10 });
  return { deletedId: result.data.articleDelete.deletedArticleId ?? undefined, userErrors: result.data.articleDelete.userErrors };
}
