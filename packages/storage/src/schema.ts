/**
 * Kysely table schema. Kept SQL-portable so a Postgres dialect can be swapped in
 * later: only TEXT/INTEGER/REAL column types, JSON payloads stored as TEXT
 * (stringified), booleans stored as INTEGER (0/1), timestamps stored as ISO-8601
 * TEXT strings.
 */
import type { ColumnType } from "kysely";

/** Helper: a column that always has a value on select/insert/update (no Kysely `Generated<>` needed since we assign all ids in app code). */
type Col<T> = ColumnType<T, T, T>;

export interface ShopsTable {
  shop_id: Col<string>;
  domain: Col<string>;
  name: Col<string | null>;
  plan: Col<string | null>;
  primary_domain: Col<string | null>;
  currency: Col<string | null>;
  password_protected: Col<number>;
  installed_at: Col<string>;
  uninstalled_at: Col<string | null>;
  settings_json: Col<string | null>;
}

export interface SecretsTable {
  shop_id: Col<string>;
  kind: Col<"admin_token" | "theme_access" | "app_client_secret" | "storefront_password">;
  ciphertext: Col<string>;
  iv: Col<string>;
  tag: Col<string>;
  key_version: Col<number>;
  updated_at: Col<string>;
}

export interface CredentialsTable {
  credential_id: Col<string>;
  shop_id: Col<string>;
  kind: Col<"oauth" | "token">;
  label: Col<string>;
  profile: Col<string>;
  policy_json: Col<string | null>;
  token_hash: Col<string | null>;
  scopes_json: Col<string | null>;
  created_at: Col<string>;
  last_used_at: Col<string | null>;
  expires_at: Col<string | null>;
  revoked_at: Col<string | null>;
  ip_allowlist_json: Col<string | null>;
}

export interface OauthClientsTable {
  client_id: Col<string>;
  shop_id: Col<string | null>;
  metadata_json: Col<string | null>;
  created_at: Col<string>;
}

export interface OauthCodesTable {
  code_hash: Col<string>;
  client_id: Col<string>;
  credential_seed_json: Col<string | null>;
  pkce_challenge: Col<string | null>;
  pkce_method: Col<string | null>;
  redirect_uri: Col<string>;
  scope: Col<string | null>;
  expires_at: Col<string>;
  consumed_at: Col<string | null>;
}

export interface OauthTokensTable {
  token_hash: Col<string>;
  kind: Col<"access" | "refresh">;
  credential_id: Col<string>;
  client_id: Col<string>;
  expires_at: Col<string>;
  revoked_at: Col<string | null>;
  rotated_from: Col<string | null>;
}

export interface OperationsTable {
  operation_id: Col<string>;
  shop_id: Col<string>;
  credential_id: Col<string>;
  credential_label: Col<string>;
  tool: Col<string>;
  tier: Col<string>;
  risk: Col<string>;
  status: Col<string>;
  inputs_hash: Col<string>;
  inputs_redacted_json: Col<string | null>;
  resources_json: Col<string | null>;
  changes_json: Col<string | null>;
  evidence_json: Col<string | null>;
  warnings_json: Col<string | null>;
  approval_json: Col<string | null>;
  rollback_json: Col<string | null>;
  error_json: Col<string | null>;
  era: Col<string | null>;
  started_at: Col<string>;
  finished_at: Col<string | null>;
  duration_ms: Col<number | null>;
}

export interface SnapshotsTable {
  snapshot_id: Col<string>;
  shop_id: Col<string>;
  kind: Col<"theme" | "resource" | "seo_baseline" | "visual_baseline">;
  label: Col<string>;
  theme_id: Col<string | null>;
  resource_ids_json: Col<string | null>;
  file_count: Col<number | null>;
  bytes: Col<number | null>;
  created_at: Col<string>;
  created_by: Col<string>;
  operation_id: Col<string | null>;
}

export interface SnapshotFilesTable {
  snapshot_id: Col<string>;
  key: Col<string>;
  blob_hash: Col<string>;
  size: Col<number>;
  content_type: Col<string | null>;
}

export interface BlobsTable {
  blob_hash: Col<string>;
  bytes: Col<number>;
  stored_at: Col<string>;
}

export interface ApprovalsTable {
  token_hash: Col<string>;
  shop_id: Col<string>;
  credential_id: Col<string | null>;
  tool: Col<string>;
  plan_hash: Col<string>;
  issued_by: Col<string>;
  expires_at: Col<string>;
  consumed_at: Col<string | null>;
}

export interface JobsTable {
  job_id: Col<string>;
  shop_id: Col<string>;
  tool: Col<string>;
  status: Col<string>;
  stage: Col<string | null>;
  progress: Col<number>;
  stages_json: Col<string | null>;
  artifacts_json: Col<string | null>;
  warnings_json: Col<string | null>;
  errors_json: Col<string | null>;
  result_json: Col<string | null>;
  input_json: Col<string | null>;
  credential_id: Col<string | null>;
  created_at: Col<string>;
  updated_at: Col<string>;
}

export interface CapabilityCacheTable {
  shop_id: Col<string>;
  capabilities_json: Col<string>;
  probed_at: Col<string>;
}

export interface KvTable {
  key: Col<string>;
  value_json: Col<string>;
  updated_at: Col<string>;
}

export interface DesignManifestsTable {
  manifest_id: Col<string>;
  shop_id: Col<string>;
  version: Col<number>;
  name: Col<string>;
  manifest_json: Col<string>;
  source: Col<"extracted" | "authored">;
  created_by: Col<string>;
  created_at: Col<string>;
  is_active: Col<number>;
}

export interface EntitlementsTable {
  shop_id: Col<string>;
  state: Col<string>;
  plan: Col<string | null>;
  entitlements_json: Col<string | null>;
  seats_json: Col<string | null>;
  license_ref: Col<string | null>;
  freemius_user_id: Col<string | null>;
  freemius_license_id: Col<string | null>;
  grace_until: Col<string | null>;
  updated_at: Col<string>;
  raw_last_event_json: Col<string | null>;
}

export interface SkillsTable {
  skill_id: Col<string>;
  shop_id: Col<string>;
  name: Col<string>;
  title: Col<string>;
  description: Col<string>;
  tier: Col<string>;
  body: Col<string>;
  source: Col<"builtin" | "custom">;
  enabled: Col<number>;
  created_at: Col<string>;
  updated_at: Col<string>;
}

export interface ConnectionsTable {
  id: Col<string>;
  shop_id: Col<string>;
  credential_id: Col<string>;
  credential_label: Col<string>;
  kind: Col<"token" | "oauth" | "admin_ui">;
  client_key: Col<string>;
  client_name: Col<string>;
  client_version: Col<string>;
  protocol_version: Col<string>;
  first_seen: Col<string>;
  last_seen: Col<string>;
  request_count: Col<number>;
}

export interface MemoriesTable {
  memory_id: Col<string>;
  shop_id: Col<string>;
  name: Col<string>;
  description: Col<string>;
  type: Col<"user" | "feedback" | "project" | "reference" | "design">;
  content: Col<string>;
  enabled: Col<number>;
  created_by: Col<string>;
  created_at: Col<string>;
  updated_at: Col<string>;
  version: Col<number>;
}

export interface MemoryVersionsTable {
  memory_id: Col<string>;
  version: Col<number>;
  name: Col<string>;
  description: Col<string>;
  type: Col<string>;
  content: Col<string>;
  saved_by: Col<string>;
  saved_at: Col<string>;
}

export interface UsersTable {
  user_id: Col<string>;
  email: Col<string>;
  name: Col<string>;
  created_at: Col<string>;
  last_login_at: Col<string | null>;
  plan_state: Col<string>;
  plan: Col<string | null>;
  seats_json: Col<string | null>;
  license_ref: Col<string | null>;
  freemius_user_id: Col<string | null>;
  freemius_license_id: Col<string | null>;
  grace_until: Col<string | null>;
  updated_at: Col<string>;
  password_hash: Col<string | null>;
  email_verified_at: Col<string | null>;
  role: Col<string>;
  notes: Col<string | null>;
}

export interface TicketsTable {
  ticket_id: Col<string>;
  number: Col<number>;
  user_id: Col<string>;
  shop_id: Col<string | null>;
  subject: Col<string>;
  category: Col<string>;
  priority: Col<string>;
  status: Col<string>;
  created_at: Col<string>;
  updated_at: Col<string>;
  last_message_at: Col<string>;
  last_message_by: Col<string>;
  closed_at: Col<string | null>;
}

export interface TicketMessagesTable {
  message_id: Col<string>;
  ticket_id: Col<string>;
  author_user_id: Col<string>;
  author_role: Col<string>;
  body: Col<string>;
  internal: Col<number>;
  created_at: Col<string>;
}

export interface PostsTable {
  slug: Col<string>;
  title: Col<string>;
  description: Col<string>;
  body: Col<string>;
  excerpt: Col<string | null>;
  status: Col<string>;
  published_at: Col<string | null>;
  modified_at: Col<string | null>;
  author: Col<string>;
  author_url: Col<string | null>;
  tags: Col<string>;
  hero_image: Col<string | null>;
  hero_image_alt: Col<string | null>;
  hero_image_caption: Col<string | null>;
  canonical_url: Col<string | null>;
  noindex: Col<number>;
  focus_keyword: Col<string | null>;
  schema_type: Col<string>;
  og_title: Col<string | null>;
  og_description: Col<string | null>;
  og_image: Col<string | null>;
  og_image_alt: Col<string | null>;
  twitter_card: Col<string | null>;
  twitter_title: Col<string | null>;
  twitter_description: Col<string | null>;
  twitter_image: Col<string | null>;
  created_at: Col<string>;
  updated_at: Col<string>;
}

export interface MagicLinksTable {
  token_hash: Col<string>;
  email: Col<string>;
  redirect: Col<string | null>;
  created_at: Col<string>;
  expires_at: Col<string>;
  consumed_at: Col<string | null>;
}

export interface SessionsTable {
  session_id: Col<string>;
  token_hash: Col<string>;
  user_id: Col<string>;
  created_at: Col<string>;
  expires_at: Col<string>;
  last_seen_at: Col<string>;
  user_agent: Col<string>;
  revoked_at: Col<string | null>;
}

export interface UserShopsTable {
  user_id: Col<string>;
  shop_id: Col<string>;
  role: Col<string>;
  pro_seat: Col<number>;
  created_at: Col<string>;
}

export interface Schema {
  users: UsersTable;
  magic_links: MagicLinksTable;
  sessions: SessionsTable;
  user_shops: UserShopsTable;
  tickets: TicketsTable;
  ticket_messages: TicketMessagesTable;
  posts: PostsTable;
  shops: ShopsTable;
  secrets: SecretsTable;
  credentials: CredentialsTable;
  oauth_clients: OauthClientsTable;
  oauth_codes: OauthCodesTable;
  oauth_tokens: OauthTokensTable;
  operations: OperationsTable;
  snapshots: SnapshotsTable;
  snapshot_files: SnapshotFilesTable;
  blobs: BlobsTable;
  approvals: ApprovalsTable;
  jobs: JobsTable;
  capability_cache: CapabilityCacheTable;
  kv: KvTable;
  design_manifests: DesignManifestsTable;
  entitlements: EntitlementsTable;
  skills: SkillsTable;
  connections: ConnectionsTable;
  memories: MemoriesTable;
  memory_versions: MemoryVersionsTable;
}
