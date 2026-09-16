/**
 * Blog posts.
 *
 * `/api/posts/*` is public and only ever returns published posts - the marketing site's
 * build reads it to generate the static blog. `/api/panel/posts/*` is the operator CRUD
 * surface and requires an admin session, so drafts stay private until they are published.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ShopManagerAIError, ERROR_CODES } from "@shopmanagerai/shared";
import type { UserRow } from "@shopmanagerai/storage";
import type { Container } from "../container.js";
import { apiError, requireSession } from "./account.js";

async function requireAdmin(container: Container, c: any): Promise<UserRow> {
  const { user } = await requireSession(container, c);
  if (user.role !== "admin") throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Admin access required.", { httpStatus: 403 });
  return user;
}

const Block: z.ZodType<any> = z.union([
  z.object({ type: z.literal("p"), text: z.string() }),
  z.object({ type: z.literal("h2"), text: z.string() }),
  z.object({ type: z.literal("h3"), text: z.string() }),
  z.object({ type: z.literal("ul"), items: z.array(z.string()) }),
  z.object({ type: z.literal("ol"), items: z.array(z.string()) }),
  z.object({ type: z.literal("code"), code: z.string(), label: z.string().optional() }),
  z.object({
    type: z.literal("image"),
    src: z.string().min(1),
    alt: z.string(),
    caption: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
]);

const PostBody = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(400),
  body: z.array(Block).default([]),
  excerpt: z.string().max(600).nullish(),
  status: z.enum(["draft", "published"]).default("draft"),
  publishedAt: z.string().nullish(),
  modifiedAt: z.string().nullish(),
  author: z.string().max(120).default(""),
  authorUrl: z.string().url().nullish(),
  tags: z.array(z.string().max(60)).default([]),
  heroImage: z.string().nullish(),
  heroImageAlt: z.string().max(300).nullish(),
  heroImageCaption: z.string().max(300).nullish(),
  canonicalUrl: z.string().url().nullish(),
  noindex: z.boolean().default(false),
  focusKeyword: z.string().max(120).nullish(),
  schemaType: z.string().max(60).default("BlogPosting"),
  ogTitle: z.string().max(200).nullish(),
  ogDescription: z.string().max(400).nullish(),
  ogImage: z.string().nullish(),
  ogImageAlt: z.string().max(300).nullish(),
  twitterCard: z.string().max(60).nullish(),
  twitterTitle: z.string().max(200).nullish(),
  twitterDescription: z.string().max(400).nullish(),
  twitterImage: z.string().nullish(),
});

/** An import file is either a bare array of posts or `{ posts: [...] }`. */
const ImportBody = z.union([
  z.array(PostBody),
  z.object({ posts: z.array(PostBody) }).transform((v) => v.posts),
]);

export function mountPostsApi(app: Hono, container: Container): void {
  const publicApi = new Hono();

  publicApi.get("/", async (c) => {
    try {
      return c.json({ ok: true, posts: await container.posts.list({ status: "published" }) });
    } catch (e) {
      return apiError(c, e);
    }
  });

  publicApi.get("/:slug", async (c) => {
    try {
      const post = await container.posts.get(c.req.param("slug"));
      if (!post || post.status !== "published") throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Post not found.");
      return c.json({ ok: true, post });
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.route("/api/posts", publicApi);

  const adminApi = new Hono();

  adminApi.get("/", async (c) => {
    try {
      await requireAdmin(container, c);
      return c.json({ ok: true, posts: await container.posts.list() });
    } catch (e) {
      return apiError(c, e);
    }
  });

  adminApi.get("/:slug", async (c) => {
    try {
      await requireAdmin(container, c);
      const post = await container.posts.get(c.req.param("slug"));
      if (!post) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Post not found.");
      return c.json({ ok: true, post });
    } catch (e) {
      return apiError(c, e);
    }
  });

  adminApi.post("/", async (c) => {
    try {
      const admin = await requireAdmin(container, c);
      const post = await container.posts.upsert(PostBody.parse(await c.req.json()));
      container.log.info("admin: post saved", { by: admin.email, slug: post.slug, status: post.status });
      return c.json({ ok: true, post });
    } catch (e) {
      return apiError(c, e);
    }
  });

  adminApi.post("/import", async (c) => {
    try {
      const admin = await requireAdmin(container, c);
      const posts = ImportBody.parse(await c.req.json());
      const result = await container.posts.importMany(posts);
      container.log.info("admin: posts imported", { by: admin.email, imported: result.imported.length, failed: result.errors.length });
      return c.json({ ok: true, ...result });
    } catch (e) {
      return apiError(c, e);
    }
  });

  adminApi.delete("/:slug", async (c) => {
    try {
      const admin = await requireAdmin(container, c);
      const slug = c.req.param("slug");
      if (!(await container.posts.delete(slug))) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Post not found.");
      container.log.info("admin: post deleted", { by: admin.email, slug });
      return c.json({ ok: true });
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.route("/api/panel/posts", adminApi);
}
