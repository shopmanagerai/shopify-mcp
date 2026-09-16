import type { Kysely } from "kysely";

/**
 * Marketing blog posts, authored in the operator panel and read by the marketing site's
 * build. Every field a post needs to render and to describe itself to a search engine or
 * crawler lives here, so the site never has to invent metadata at build time.
 *
 * `body` holds the article as a JSON DocBlock array, matching what the site already
 * renders for docs. `tags` is a JSON string array. Slug is the primary key because it is
 * the public URL and must be unique anyway.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("posts")
    .addColumn("slug", "text", (c) => c.primaryKey())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("description", "text", (c) => c.notNull())
    .addColumn("body", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("excerpt", "text")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("draft"))
    .addColumn("published_at", "text")
    .addColumn("modified_at", "text")
    .addColumn("author", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("author_url", "text")
    .addColumn("tags", "text", (c) => c.notNull().defaultTo("[]"))
    // Featured image, shown at the top of the post and on the index card
    .addColumn("hero_image", "text")
    .addColumn("hero_image_alt", "text")
    .addColumn("hero_image_caption", "text")
    // SEO
    .addColumn("canonical_url", "text")
    .addColumn("noindex", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("focus_keyword", "text")
    .addColumn("schema_type", "text", (c) => c.notNull().defaultTo("BlogPosting"))
    // Open Graph / Twitter, each optional and falling back to title/description on render
    .addColumn("og_title", "text")
    .addColumn("og_description", "text")
    .addColumn("og_image", "text")
    .addColumn("og_image_alt", "text")
    .addColumn("twitter_card", "text")
    .addColumn("twitter_title", "text")
    .addColumn("twitter_description", "text")
    .addColumn("twitter_image", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("posts_status_idx").on("posts").columns(["status", "published_at"]).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("posts").ifExists().execute();
}
