import type { Kysely } from "kysely";

/** Per-shop custom/override Skills (MCP prompts). See docs/ADMIN_API.md skills routes. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("skills")
    .addColumn("skill_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("description", "text", (c) => c.notNull())
    .addColumn("tier", "text", (c) => c.notNull().defaultTo("free"))
    .addColumn("body", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull().defaultTo("custom"))
    .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("skills_shop_idx").on("skills").column("shop_id").execute();
  await db.schema.createIndex("skills_shop_name_uq").on("skills").columns(["shop_id", "name"]).unique().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("skills").ifExists().execute();
}
