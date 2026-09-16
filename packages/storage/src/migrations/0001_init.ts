import type { Kysely } from "kysely";

/** Initial schema. Kept to portable SQL types (TEXT/INTEGER/REAL) for a future Postgres dialect. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("shops")
    .addColumn("shop_id", "text", (c) => c.primaryKey())
    .addColumn("domain", "text", (c) => c.notNull().unique())
    .addColumn("name", "text")
    .addColumn("plan", "text")
    .addColumn("primary_domain", "text")
    .addColumn("currency", "text")
    .addColumn("password_protected", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("installed_at", "text", (c) => c.notNull())
    .addColumn("uninstalled_at", "text")
    .addColumn("settings_json", "text")
    .execute();

  await db.schema
    .createTable("secrets")
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("ciphertext", "text", (c) => c.notNull())
    .addColumn("iv", "text", (c) => c.notNull())
    .addColumn("tag", "text", (c) => c.notNull())
    .addColumn("key_version", "integer", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("secrets_pk", ["shop_id", "kind"])
    .execute();

  await db.schema
    .createTable("credentials")
    .addColumn("credential_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("profile", "text", (c) => c.notNull())
    .addColumn("policy_json", "text")
    .addColumn("token_hash", "text", (c) => c.unique())
    .addColumn("scopes_json", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("last_used_at", "text")
    .addColumn("expires_at", "text")
    .addColumn("revoked_at", "text")
    .addColumn("ip_allowlist_json", "text")
    .execute();
  await db.schema.createIndex("credentials_shop_idx").on("credentials").column("shop_id").execute();

  await db.schema
    .createTable("oauth_clients")
    .addColumn("client_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text")
    .addColumn("metadata_json", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("oauth_codes")
    .addColumn("code_hash", "text", (c) => c.primaryKey())
    .addColumn("client_id", "text", (c) => c.notNull())
    .addColumn("credential_seed_json", "text")
    .addColumn("pkce_challenge", "text")
    .addColumn("pkce_method", "text")
    .addColumn("redirect_uri", "text", (c) => c.notNull())
    .addColumn("scope", "text")
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("consumed_at", "text")
    .execute();

  await db.schema
    .createTable("oauth_tokens")
    .addColumn("token_hash", "text", (c) => c.primaryKey())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("credential_id", "text", (c) => c.notNull())
    .addColumn("client_id", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("revoked_at", "text")
    .addColumn("rotated_from", "text")
    .execute();

  await db.schema
    .createTable("operations")
    .addColumn("operation_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("credential_id", "text", (c) => c.notNull())
    .addColumn("credential_label", "text", (c) => c.notNull())
    .addColumn("tool", "text", (c) => c.notNull())
    .addColumn("tier", "text", (c) => c.notNull())
    .addColumn("risk", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("inputs_hash", "text", (c) => c.notNull())
    .addColumn("inputs_redacted_json", "text")
    .addColumn("resources_json", "text")
    .addColumn("changes_json", "text")
    .addColumn("evidence_json", "text")
    .addColumn("warnings_json", "text")
    .addColumn("approval_json", "text")
    .addColumn("rollback_json", "text")
    .addColumn("error_json", "text")
    .addColumn("era", "text")
    .addColumn("started_at", "text", (c) => c.notNull())
    .addColumn("finished_at", "text")
    .addColumn("duration_ms", "integer")
    .execute();
  await db.schema
    .createIndex("operations_shop_started_idx")
    .on("operations")
    .columns(["shop_id", "started_at"])
    .execute();

  await db.schema
    .createTable("snapshots")
    .addColumn("snapshot_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("theme_id", "text")
    .addColumn("resource_ids_json", "text")
    .addColumn("file_count", "integer")
    .addColumn("bytes", "integer")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("created_by", "text", (c) => c.notNull())
    .addColumn("operation_id", "text")
    .execute();
  await db.schema
    .createIndex("snapshots_shop_created_idx")
    .on("snapshots")
    .columns(["shop_id", "created_at"])
    .execute();

  await db.schema
    .createTable("snapshot_files")
    .addColumn("snapshot_id", "text", (c) => c.notNull())
    .addColumn("key", "text", (c) => c.notNull())
    .addColumn("blob_hash", "text", (c) => c.notNull())
    .addColumn("size", "integer", (c) => c.notNull())
    .addColumn("content_type", "text")
    .addPrimaryKeyConstraint("snapshot_files_pk", ["snapshot_id", "key"])
    .execute();

  await db.schema
    .createTable("blobs")
    .addColumn("blob_hash", "text", (c) => c.primaryKey())
    .addColumn("bytes", "integer", (c) => c.notNull())
    .addColumn("stored_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("approvals")
    .addColumn("token_hash", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("credential_id", "text")
    .addColumn("tool", "text", (c) => c.notNull())
    .addColumn("plan_hash", "text", (c) => c.notNull())
    .addColumn("issued_by", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("consumed_at", "text")
    .execute();

  await db.schema
    .createTable("jobs")
    .addColumn("job_id", "text", (c) => c.primaryKey())
    .addColumn("shop_id", "text", (c) => c.notNull())
    .addColumn("tool", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("stage", "text")
    .addColumn("progress", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("stages_json", "text")
    .addColumn("artifacts_json", "text")
    .addColumn("warnings_json", "text")
    .addColumn("errors_json", "text")
    .addColumn("result_json", "text")
    .addColumn("input_json", "text")
    .addColumn("credential_id", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("jobs_shop_idx").on("jobs").column("shop_id").execute();

  await db.schema
    .createTable("capability_cache")
    .addColumn("shop_id", "text", (c) => c.primaryKey())
    .addColumn("capabilities_json", "text", (c) => c.notNull())
    .addColumn("probed_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("kv")
    .addColumn("key", "text", (c) => c.primaryKey())
    .addColumn("value_json", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("kv").ifExists().execute();
  await db.schema.dropTable("capability_cache").ifExists().execute();
  await db.schema.dropTable("jobs").ifExists().execute();
  await db.schema.dropTable("approvals").ifExists().execute();
  await db.schema.dropTable("blobs").ifExists().execute();
  await db.schema.dropTable("snapshot_files").ifExists().execute();
  await db.schema.dropTable("snapshots").ifExists().execute();
  await db.schema.dropTable("operations").ifExists().execute();
  await db.schema.dropTable("oauth_tokens").ifExists().execute();
  await db.schema.dropTable("oauth_codes").ifExists().execute();
  await db.schema.dropTable("oauth_clients").ifExists().execute();
  await db.schema.dropTable("credentials").ifExists().execute();
  await db.schema.dropTable("secrets").ifExists().execute();
  await db.schema.dropTable("shops").ifExists().execute();
}
