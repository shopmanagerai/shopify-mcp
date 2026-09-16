/**
 * Marketing blog posts. Authored in the operator panel, read by the marketing site's build.
 * Only `status: "published"` posts are ever exposed publicly; drafts stay behind admin auth.
 */
import type { Kysely } from "kysely";
import type { Schema } from "./schema.js";

export type PostStatus = "draft" | "published";

/** One block of article body. Mirrors the site's DocBlock union so the site can render it directly. */
export type PostBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; code: string; label?: string }
  | { type: "image"; src: string; alt: string; caption?: string; width?: number; height?: number };

export interface PostRow {
  slug: string;
  title: string;
  description: string;
  body: PostBlock[];
  excerpt: string | null;
  status: PostStatus;
  publishedAt: string | null;
  modifiedAt: string | null;
  author: string;
  authorUrl: string | null;
  tags: string[];
  heroImage: string | null;
  heroImageAlt: string | null;
  heroImageCaption: string | null;
  canonicalUrl: string | null;
  noindex: boolean;
  focusKeyword: string | null;
  schemaType: string;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogImageAlt: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PostInput = Partial<Omit<PostRow, "slug" | "createdAt" | "updatedAt">> &
  Pick<PostRow, "slug" | "title" | "description">;

/** Lowercase, hyphenated, URL-safe. Throws rather than silently writing a slug that would 404. */
export function normaliseSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Cannot derive a URL slug from ${JSON.stringify(raw)}.`);
  return slug;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapPost(r: any): PostRow {
  return {
    slug: r.slug,
    title: r.title,
    description: r.description,
    body: parseJson<PostBlock[]>(r.body, []),
    excerpt: r.excerpt ?? null,
    status: r.status === "published" ? "published" : "draft",
    publishedAt: r.published_at ?? null,
    modifiedAt: r.modified_at ?? null,
    author: r.author ?? "",
    authorUrl: r.author_url ?? null,
    tags: parseJson<string[]>(r.tags, []),
    heroImage: r.hero_image ?? null,
    heroImageAlt: r.hero_image_alt ?? null,
    heroImageCaption: r.hero_image_caption ?? null,
    canonicalUrl: r.canonical_url ?? null,
    noindex: Number(r.noindex) === 1,
    focusKeyword: r.focus_keyword ?? null,
    schemaType: r.schema_type || "BlogPosting",
    ogTitle: r.og_title ?? null,
    ogDescription: r.og_description ?? null,
    ogImage: r.og_image ?? null,
    ogImageAlt: r.og_image_alt ?? null,
    twitterCard: r.twitter_card ?? null,
    twitterTitle: r.twitter_title ?? null,
    twitterDescription: r.twitter_description ?? null,
    twitterImage: r.twitter_image ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toColumns(input: PostInput, now: string) {
  return {
    title: input.title,
    description: input.description,
    body: JSON.stringify(input.body ?? []),
    excerpt: input.excerpt ?? null,
    status: input.status === "published" ? "published" : "draft",
    // A post published without an explicit date is published now, not undated.
    published_at: input.publishedAt ?? (input.status === "published" ? now : null),
    modified_at: input.modifiedAt ?? null,
    author: input.author ?? "",
    author_url: input.authorUrl ?? null,
    tags: JSON.stringify(input.tags ?? []),
    hero_image: input.heroImage ?? null,
    hero_image_alt: input.heroImageAlt ?? null,
    hero_image_caption: input.heroImageCaption ?? null,
    canonical_url: input.canonicalUrl ?? null,
    noindex: input.noindex ? 1 : 0,
    focus_keyword: input.focusKeyword ?? null,
    schema_type: input.schemaType || "BlogPosting",
    og_title: input.ogTitle ?? null,
    og_description: input.ogDescription ?? null,
    og_image: input.ogImage ?? null,
    og_image_alt: input.ogImageAlt ?? null,
    twitter_card: input.twitterCard ?? null,
    twitter_title: input.twitterTitle ?? null,
    twitter_description: input.twitterDescription ?? null,
    twitter_image: input.twitterImage ?? null,
    updated_at: now,
  };
}

export class PostRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  /** Newest first. Omit `status` for every post, including drafts (admin only). */
  async list(opts: { status?: PostStatus } = {}): Promise<PostRow[]> {
    let q = this.db.selectFrom("posts").selectAll();
    if (opts.status) q = q.where("status", "=", opts.status);
    const rows = await q.execute();
    return rows
      .map(mapPost)
      .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
  }

  async get(slug: string): Promise<PostRow | null> {
    const row = await this.db.selectFrom("posts").selectAll().where("slug", "=", slug).executeTakeFirst();
    return row ? mapPost(row) : null;
  }

  /** Creates or replaces the post at this slug. */
  async upsert(input: PostInput): Promise<PostRow> {
    const slug = normaliseSlug(input.slug);
    const now = new Date().toISOString();
    const columns = toColumns(input, now);
    const existing = await this.db.selectFrom("posts").select("slug").where("slug", "=", slug).executeTakeFirst();
    if (existing) {
      await this.db.updateTable("posts").set(columns).where("slug", "=", slug).execute();
    } else {
      await this.db.insertInto("posts").values({ slug, created_at: now, ...columns } as any).execute();
    }
    return (await this.get(slug))!;
  }

  async delete(slug: string): Promise<boolean> {
    const res = await this.db.deleteFrom("posts").where("slug", "=", slug).executeTakeFirst();
    return Number(res.numDeletedRows ?? 0) > 0;
  }

  /**
   * Bulk import. Each post is validated and written independently so one malformed entry
   * reports its own error instead of discarding the whole file.
   */
  async importMany(posts: PostInput[]): Promise<{ imported: string[]; errors: { slug: string; error: string }[] }> {
    const imported: string[] = [];
    const errors: { slug: string; error: string }[] = [];
    for (const post of posts) {
      try {
        const saved = await this.upsert(post);
        imported.push(saved.slug);
      } catch (e) {
        errors.push({ slug: String(post?.slug ?? "(missing slug)"), error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { imported, errors };
  }
}
