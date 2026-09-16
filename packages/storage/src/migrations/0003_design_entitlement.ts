import type { Kysely } from "kysely";

/** Design manifests (docs/STORE_DIGITAL_TWIN.md §2) and Freemius-backed entitlement state. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("design_manifests")
    .addColumn("manifest_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("manifest_json", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("created_by", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .createIndex("design_manifests_shop_idx")
    .on("design_manifests")
    .columns(["shop_id", "version"])
    .execute();

  await db.schema
    .createTable("entitlements")
    .addColumn("shop_id", "text", (c) => c.primaryKey())
    .addColumn("state", "text", (c) => c.notNull())
    .addColumn("plan", "text")
    .addColumn("entitlements_json", "text")
    .addColumn("seats_json", "text")
    .addColumn("license_ref", "text")
    .addColumn("freemius_user_id", "text")
    .addColumn("freemius_license_id", "text")
    .addColumn("grace_until", "text")
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addColumn("raw_last_event_json", "text")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("entitlements").ifExists().execute();
  await db.schema.dropTable("design_manifests").ifExists().execute();
}
