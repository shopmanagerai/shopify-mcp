import type { Kysely } from "kysely";

/**
 * Accounts: a merchant/agency identity that lives outside any single Shopify store.
 * Login is passwordless (magic link by email). A user owns N shops through user_shops;
 * billing (Freemius) is bound to the user, and `pro_seat` marks which linked shops
 * consume one of the plan's shop seats. Shop-level entitlement rows are still the
 * source of truth the tool gate reads; the account layer writes them (see applySeats).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("user_id", "text", (c) => c.primaryKey())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("last_login_at", "text")
    .addColumn("plan_state", "text", (c) => c.notNull().defaultTo("FREE"))
    .addColumn("plan", "text")
    .addColumn("seats_json", "text")
    .addColumn("license_ref", "text")
    .addColumn("freemius_user_id", "text")
    .addColumn("freemius_license_id", "text")
    .addColumn("grace_until", "text")
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("users_email_uq").on("users").column("email").unique().execute();

  await db.schema
    .createTable("magic_links")
    .addColumn("token_hash", "text", (c) => c.primaryKey())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("redirect", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("consumed_at", "text")
    .execute();
  await db.schema.createIndex("magic_links_email_idx").on("magic_links").column("email").execute();

  await db.schema
    .createTable("sessions")
    .addColumn("session_id", "text", (c) => c.primaryKey())
    .addColumn("token_hash", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("last_seen_at", "text", (c) => c.notNull())
    .addColumn("user_agent", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("revoked_at", "text")
    .execute();
  await db.schema.createIndex("sessions_token_uq").on("sessions").column("token_hash").unique().execute();
  await db.schema.createIndex("sessions_user_idx").on("sessions").column("user_id").execute();

  await db.schema
    .createTable("user_shops")
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("role", "text", (c) => c.notNull().defaultTo("owner"))
    .addColumn("pro_seat", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("user_shops_pk", ["user_id", "shop_id"])
    .execute();
  await db.schema.createIndex("user_shops_shop_idx").on("user_shops").column("shop_id").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("user_shops").ifExists().execute();
  await db.schema.dropTable("sessions").ifExists().execute();
  await db.schema.dropTable("magic_links").ifExists().execute();
  await db.schema.dropTable("users").ifExists().execute();
}
