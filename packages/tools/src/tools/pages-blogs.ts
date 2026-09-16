/**
 * Online Store content tools: pages (§34) and blogs/articles (§35), all Free
 * tier. `article.create_draft` always sends `isPublished: false` regardless
 * of caller input (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Content" row).
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { listPages, getPage, listBlogs, getBlog, listArticles, getArticle } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";

const paginationInput = { first: z.number().int().min(1).max(250).optional(), after: z.string().optional() };

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
export const pagesListTool: ToolDefinition = defineTool({
  name: "shopify.pages.list",
  aliases: ["shopify.pages.search"],
  description: "Lists/searches Online Store pages, paginated.",
  tier: "free",
  category: "page",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_content"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput, query: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["pages"], writes: [], stores: [], returnsToClient: ["page list"] },
  docs: { examples: [{ title: "List pages", input: { first: 20 } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listPages(admin, input);
    return ok({ operationId: ctx.operationId }, pagesListTool, { summary: `${page.items.length} page(s)`, data: page });
  },
});

export const pageGetTool: ToolDefinition = defineTool({
  name: "shopify.page.get",
  description: "Reads a page's body, isPublished, templateSuffix, and seo.",
  tier: "free",
  category: "page",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_content"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ page: z.unknown().nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["page detail"], writes: [], stores: [], returnsToClient: ["page detail"] },
  docs: { examples: [{ title: "Read a page", input: { id: "gid://shopify/Page/1" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No page with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await getPage(admin, input.id);
    if (!page) return fail({ operationId: ctx.operationId }, pageGetTool, { code: "NOT_FOUND", message: `Page "${input.id}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, pageGetTool, { summary: `Read ${page.title}`, data: { page } });
  },
});

// ---------------------------------------------------------------------------
// Blogs
// ---------------------------------------------------------------------------
export const blogsListTool: ToolDefinition = defineTool({
  name: "shopify.blogs.list",
  description: "Lists blogs, paginated.",
  tier: "free",
  category: "blog",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_content"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ ...paginationInput }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["blogs"], writes: [], stores: [], returnsToClient: ["blog list"] },
  docs: { examples: [{ title: "List blogs", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listBlogs(admin, input);
    return ok({ operationId: ctx.operationId }, blogsListTool, { summary: `${page.items.length} blog(s)`, data: page });
  },
});

export const blogGetTool: ToolDefinition = defineTool({
  name: "shopify.blog.get",
  description: "Reads a single blog.",
  tier: "free",
  category: "blog",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_content"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ blog: z.unknown().nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["blog"], writes: [], stores: [], returnsToClient: ["blog detail"] },
  docs: { examples: [{ title: "Read a blog", input: { id: "gid://shopify/Blog/1" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No blog with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const blog = await getBlog(admin, input.id);
    if (!blog) return fail({ operationId: ctx.operationId }, blogGetTool, { code: "NOT_FOUND", message: `Blog "${input.id}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, blogGetTool, { summary: `Read ${blog.title}`, data: { blog } });
  },
});

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------
export const articlesListTool: ToolDefinition = defineTool({
  name: "shopify.articles.list",
  description: "Lists articles, optionally scoped to a blog, paginated.",
  tier: "free",
  category: "blog",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_content"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ blogId: z.string().optional(), ...paginationInput, query: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  supportsPagination: true,
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["articles"], writes: [], stores: [], returnsToClient: ["article list"] },
  docs: { examples: [{ title: "List articles", input: { first: 20 } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const page = await listArticles(admin, input);
    return ok({ operationId: ctx.operationId }, articlesListTool, { summary: `${page.items.length} article(s)`, data: page });
  },
});

export const articleGetTool: ToolDefinition = defineTool({
  name: "shopify.article.get",
  description: "Reads a single article's body, isPublished, and seo.",
  tier: "free",
  category: "blog",
  riskClass: "read",
  executionPlane: "shopify_admin",
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_content"],
  requiredStoreCapabilities: ["admin.read"],
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ article: z.unknown().nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["article detail"], writes: [], stores: [], returnsToClient: ["article detail"] },
  docs: { examples: [{ title: "Read an article", input: { id: "gid://shopify/Article/1" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No article with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const admin = requireAdmin(ctx.admin);
    const article = await getArticle(admin, input.id);
    if (!article) return fail({ operationId: ctx.operationId }, articleGetTool, { code: "NOT_FOUND", message: `Article "${input.id}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, articleGetTool, { summary: `Read ${article.title}`, data: { article } });
  },
});

export function registerPagesBlogsTools(registry: ToolRegistry): void {
  registry.register(pagesListTool);
  registry.register(pageGetTool);
  registry.register(blogsListTool);
  registry.register(blogGetTool);
  registry.register(articlesListTool);
  registry.register(articleGetTool);
}
