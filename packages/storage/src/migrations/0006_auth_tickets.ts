import type { Kysely } from "kysely";

/**
 * Password sign-in (scrypt hash; magic links stay as the passwordless / reset path), email
 * verification, an account role for the operator admin panel, and the support ticket system.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("users").addColumn("password_hash", "text").execute();
  await db.schema.alterTable("users").addColumn("email_verified_at", "text").execute();
  await db.schema.alterTable("users").addColumn("role", "text", (c) => c.notNull().defaultTo("user")).execute();
  await db.schema.alterTable("users").addColumn("notes", "text").execute();

  await db.schema
    .createTable("tickets")
    .addColumn("ticket_id", "text", (c) => c.primaryKey())
    .addColumn("number", "integer", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("shop_id", "text")
    .addColumn("subject", "text", (c) => c.notNull())
    .addColumn("category", "text", (c) => c.notNull().defaultTo("general"))
    .addColumn("priority", "text", (c) => c.notNull().defaultTo("normal"))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("open"))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addColumn("last_message_at", "text", (c) => c.notNull())
    .addColumn("last_message_by", "text", (c) => c.notNull().defaultTo("user"))
    .addColumn("closed_at", "text")
    .execute();
  await db.schema.createIndex("tickets_user_idx").on("tickets").columns(["user_id", "updated_at"]).execute();
  await db.schema.createIndex("tickets_status_idx").on("tickets").columns(["status", "updated_at"]).execute();
  await db.schema.createIndex("tickets_number_uq").on("tickets").column("number").unique().execute();

  await db.schema
    .createTable("ticket_messages")
    .addColumn("message_id", "text", (c) => c.primaryKey())
    .addColumn("ticket_id", "text", (c) => c.notNull())
    .addColumn("author_user_id", "text", (c) => c.notNull())
    .addColumn("author_role", "text", (c) => c.notNull().defaultTo("user"))
    .addColumn("body", "text", (c) => c.notNull())
    .addColumn("internal", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("ticket_messages_ticket_idx").on("ticket_messages").columns(["ticket_id", "created_at"]).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("ticket_messages").ifExists().execute();
  await db.schema.dropTable("tickets").ifExists().execute();
  await db.schema.alterTable("users").dropColumn("notes").execute();
  await db.schema.alterTable("users").dropColumn("role").execute();
  await db.schema.alterTable("users").dropColumn("email_verified_at").execute();
  await db.schema.alterTable("users").dropColumn("password_hash").execute();
}
