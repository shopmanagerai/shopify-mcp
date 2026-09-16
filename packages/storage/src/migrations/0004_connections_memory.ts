import type { Kysely } from "kysely";

/**
 * Connections (the original WordPress plugin `includes/connections.php` port): one row per
 * (credential, client) pair, upserted in a single statement so concurrent
 * agent traffic cannot lose a count the way a read-modify-write would.
 *
 * Memory (the original Pro plugin `the original memory abilities`): persistent,
 * database-backed memories agents build up across conversations, plus a
 * `memory_versions` history table so a save can be rolled back ("restore").
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("connections")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("credential_id", "text", (c) => c.notNull())
    .addColumn("credential_label", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("client_key", "text", (c) => c.notNull())
    .addColumn("client_name", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("client_version", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("protocol_version", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("first_seen", "text", (c) => c.notNull())
    .addColumn("last_seen", "text", (c) => c.notNull())
    .addColumn("request_count", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex("connections_shop_idx").on("connections").column("shop_id").execute();
  await db.schema
    .createIndex("connections_shop_credential_client_uq")
    .on("connections")
    .columns(["shop_id", "credential_id", "client_key"])
    .unique()
    .execute();

  await db.schema
    .createTable("memories")
    .addColumn("memory_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text", (c) => c.notNull())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_by", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .execute();
  await db.schema.createIndex("memories_shop_idx").on("memories").columns(["shop_id", "name"]).execute();
  await db.schema.createIndex("memories_shop_type_idx").on("memories").columns(["shop_id", "type"]).execute();

  await db.schema
    .createTable("memory_versions")
    .addColumn("memory_id", "text", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text", (c) => c.notNull())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("saved_by", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("saved_at", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("memory_versions_pk", ["memory_id", "version"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("memory_versions").ifExists().execute();
  await db.schema.dropTable("memories").ifExists().execute();
  await db.schema.dropTable("connections").ifExists().execute();
}
