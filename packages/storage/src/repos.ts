import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { newId, sha256 } from "@shopmanagerai/shared";
import type { JobRecord, JobStatus } from "@shopmanagerai/shared";
import type { Schema } from "./schema.js";

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------
export interface ShopRow {
  shopId: string;
  domain: string;
  name: string | null;
  plan: string | null;
  primaryDomain: string | null;
  currency: string | null;
  passwordProtected: boolean;
  installedAt: string;
  uninstalledAt: string | null;
  settings: Record<string, unknown> | null;
}

export class ShopRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async upsert(input: {
    shopId: string;
    domain: string;
    name?: string | null;
    plan?: string | null;
    primaryDomain?: string | null;
    currency?: string | null;
    passwordProtected?: boolean;
    settings?: Record<string, unknown> | null;
  }): Promise<ShopRow> {
    const now = new Date().toISOString();
    const existing = await this.getById(input.shopId);
    const values = {
      shop_id: input.shopId,
      domain: input.domain,
      name: input.name ?? existing?.name ?? null,
      plan: input.plan ?? existing?.plan ?? null,
      primary_domain: input.primaryDomain ?? existing?.primaryDomain ?? null,
      currency: input.currency ?? existing?.currency ?? null,
      password_protected: (input.passwordProtected ?? existing?.passwordProtected ?? false) ? 1 : 0,
      installed_at: existing?.installedAt ?? now,
      uninstalled_at: null as string | null,
      settings_json: toJson(input.settings ?? existing?.settings ?? null),
    };
    await this.db
      .insertInto("shops")
      .values(values)
      .onConflict((oc) =>
        oc.column("shop_id").doUpdateSet({
          domain: values.domain,
          name: values.name,
          plan: values.plan,
          primary_domain: values.primary_domain,
          currency: values.currency,
          password_protected: values.password_protected,
          settings_json: values.settings_json,
          uninstalled_at: null,
        }),
      )
      .execute();
    const row = await this.getById(input.shopId);
    if (!row) throw new Error("storage: shop upsert did not persist");
    return row;
  }

  async getByDomain(domain: string): Promise<ShopRow | null> {
    const row = await this.db.selectFrom("shops").selectAll().where("domain", "=", domain).executeTakeFirst();
    return row ? mapShop(row) : null;
  }

  async getById(shopId: string): Promise<ShopRow | null> {
    const row = await this.db.selectFrom("shops").selectAll().where("shop_id", "=", shopId).executeTakeFirst();
    return row ? mapShop(row) : null;
  }

  async markUninstalled(shopId: string, at: string = new Date().toISOString()): Promise<void> {
    await this.db.updateTable("shops").set({ uninstalled_at: at }).where("shop_id", "=", shopId).execute();
  }
}

function mapShop(row: any): ShopRow {
  return {
    shopId: row.shop_id,
    domain: row.domain,
    name: row.name,
    plan: row.plan,
    primaryDomain: row.primary_domain,
    currency: row.currency,
    passwordProtected: !!row.password_protected,
    installedAt: row.installed_at,
    uninstalledAt: row.uninstalled_at,
    settings: parseJson(row.settings_json, null),
  };
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------
export interface CredentialRow {
  credentialId: string;
  shopId: string;
  kind: "oauth" | "token";
  label: string;
  profile: string;
  policy: Record<string, boolean | number | string>;
  tokenHash: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  ipAllowlist: string[];
}

function mapCredential(row: any): CredentialRow {
  return {
    credentialId: row.credential_id,
    shopId: row.shop_id,
    kind: row.kind,
    label: row.label,
    profile: row.profile,
    policy: parseJson(row.policy_json, {}),
    tokenHash: row.token_hash,
    scopes: parseJson(row.scopes_json, []),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    ipAllowlist: parseJson(row.ip_allowlist_json, []),
  };
}

export class CredentialRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  /** Hashes a bearer/token secret the same way everywhere (sha256 hex). */
  static hashToken(token: string): string {
    return sha256(token);
  }

  async create(input: {
    credentialId: string;
    shopId: string;
    kind: "oauth" | "token";
    label: string;
    profile: string;
    policy?: Record<string, boolean | number | string>;
    token?: string; // plaintext; only the hash is stored
    scopes?: string[];
    expiresAt?: string | null;
    ipAllowlist?: string[];
  }): Promise<CredentialRow> {
    const now = new Date().toISOString();
    await this.db
      .insertInto("credentials")
      .values({
        credential_id: input.credentialId,
        shop_id: input.shopId,
        kind: input.kind,
        label: input.label,
        profile: input.profile,
        policy_json: toJson(input.policy ?? {}),
        token_hash: input.token ? CredentialRepo.hashToken(input.token) : null,
        scopes_json: toJson(input.scopes ?? []),
        created_at: now,
        last_used_at: null,
        expires_at: input.expiresAt ?? null,
        revoked_at: null,
        ip_allowlist_json: toJson(input.ipAllowlist ?? []),
      })
      .execute();
    const row = await this.get(input.credentialId);
    if (!row) throw new Error("storage: credential create did not persist");
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<CredentialRow | null> {
    const row = await this.db.selectFrom("credentials").selectAll().where("token_hash", "=", tokenHash).executeTakeFirst();
    return row ? mapCredential(row) : null;
  }

  async get(credentialId: string): Promise<CredentialRow | null> {
    const row = await this.db.selectFrom("credentials").selectAll().where("credential_id", "=", credentialId).executeTakeFirst();
    return row ? mapCredential(row) : null;
  }

  async listByShop(shopId: string): Promise<CredentialRow[]> {
    const rows = await this.db.selectFrom("credentials").selectAll().where("shop_id", "=", shopId).orderBy("created_at", "desc").execute();
    return rows.map(mapCredential);
  }

  async revoke(credentialId: string, at: string = new Date().toISOString()): Promise<void> {
    await this.db.updateTable("credentials").set({ revoked_at: at }).where("credential_id", "=", credentialId).execute();
  }

  async touch(credentialId: string, at: string = new Date().toISOString()): Promise<void> {
    await this.db.updateTable("credentials").set({ last_used_at: at }).where("credential_id", "=", credentialId).execute();
  }
}

// ---------------------------------------------------------------------------
// OAuth (clients / codes / tokens)
// ---------------------------------------------------------------------------
export interface OAuthClientRow {
  clientId: string;
  shopId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
export interface OAuthCodeRow {
  codeHash: string;
  clientId: string;
  credentialSeed: Record<string, unknown> | null;
  pkceChallenge: string | null;
  pkceMethod: string | null;
  redirectUri: string;
  scope: string | null;
  expiresAt: string;
  consumedAt: string | null;
}
export interface OAuthTokenRow {
  tokenHash: string;
  kind: "access" | "refresh";
  credentialId: string;
  clientId: string;
  expiresAt: string;
  revokedAt: string | null;
  rotatedFrom: string | null;
}

export class OAuthRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  static hash(secret: string): string {
    return sha256(secret);
  }

  async createClient(input: { clientId: string; shopId?: string | null; metadata?: Record<string, unknown> | null }): Promise<OAuthClientRow> {
    const now = new Date().toISOString();
    await this.db
      .insertInto("oauth_clients")
      .values({ client_id: input.clientId, shop_id: input.shopId ?? null, metadata_json: toJson(input.metadata ?? null), created_at: now })
      .execute();
    return { clientId: input.clientId, shopId: input.shopId ?? null, metadata: input.metadata ?? null, createdAt: now };
  }

  async getClient(clientId: string): Promise<OAuthClientRow | null> {
    const row = await this.db.selectFrom("oauth_clients").selectAll().where("client_id", "=", clientId).executeTakeFirst();
    if (!row) return null;
    return { clientId: row.client_id, shopId: row.shop_id, metadata: parseJson(row.metadata_json, null), createdAt: row.created_at };
  }

  async createCode(input: {
    code: string; // plaintext; stored hashed
    clientId: string;
    credentialSeed?: Record<string, unknown> | null;
    pkceChallenge?: string | null;
    pkceMethod?: string | null;
    redirectUri: string;
    scope?: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.db
      .insertInto("oauth_codes")
      .values({
        code_hash: OAuthRepo.hash(input.code),
        client_id: input.clientId,
        credential_seed_json: toJson(input.credentialSeed ?? null),
        pkce_challenge: input.pkceChallenge ?? null,
        pkce_method: input.pkceMethod ?? null,
        redirect_uri: input.redirectUri,
        scope: input.scope ?? null,
        expires_at: input.expiresAt,
        consumed_at: null,
      })
      .execute();
  }

  async consumeCode(code: string): Promise<OAuthCodeRow | null> {
    const hash = OAuthRepo.hash(code);
    const row = await this.db.selectFrom("oauth_codes").selectAll().where("code_hash", "=", hash).executeTakeFirst();
    if (!row || row.consumed_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    await this.db.updateTable("oauth_codes").set({ consumed_at: new Date().toISOString() }).where("code_hash", "=", hash).execute();
    return {
      codeHash: row.code_hash,
      clientId: row.client_id,
      credentialSeed: parseJson(row.credential_seed_json, null),
      pkceChallenge: row.pkce_challenge,
      pkceMethod: row.pkce_method,
      redirectUri: row.redirect_uri,
      scope: row.scope,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  }

  async createToken(input: {
    token: string; // plaintext; stored hashed
    kind: "access" | "refresh";
    credentialId: string;
    clientId: string;
    expiresAt: string;
    rotatedFrom?: string | null;
  }): Promise<void> {
    await this.db
      .insertInto("oauth_tokens")
      .values({
        token_hash: OAuthRepo.hash(input.token),
        kind: input.kind,
        credential_id: input.credentialId,
        client_id: input.clientId,
        expires_at: input.expiresAt,
        revoked_at: null,
        rotated_from: input.rotatedFrom ?? null,
      })
      .execute();
  }

  async findToken(token: string): Promise<OAuthTokenRow | null> {
    const hash = OAuthRepo.hash(token);
    const row = await this.db.selectFrom("oauth_tokens").selectAll().where("token_hash", "=", hash).executeTakeFirst();
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      kind: row.kind,
      credentialId: row.credential_id,
      clientId: row.client_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      rotatedFrom: row.rotated_from,
    };
  }

  async revokeToken(tokenHash: string, at: string = new Date().toISOString()): Promise<void> {
    await this.db.updateTable("oauth_tokens").set({ revoked_at: at }).where("token_hash", "=", tokenHash).execute();
  }
}

// ---------------------------------------------------------------------------
// Capability cache
// ---------------------------------------------------------------------------
export class CapabilityRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async get(shopId: string): Promise<{ capabilities: string[]; probedAt: string } | null> {
    const row = await this.db.selectFrom("capability_cache").selectAll().where("shop_id", "=", shopId).executeTakeFirst();
    if (!row) return null;
    return { capabilities: parseJson(row.capabilities_json, []), probedAt: row.probed_at };
  }

  async set(shopId: string, capabilities: string[], probedAt: string = new Date().toISOString()): Promise<void> {
    await this.db
      .insertInto("capability_cache")
      .values({ shop_id: shopId, capabilities_json: toJson(capabilities)!, probed_at: probedAt })
      .onConflict((oc) => oc.column("shop_id").doUpdateSet({ capabilities_json: toJson(capabilities)!, probed_at: probedAt }))
      .execute();
  }
}

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------
export class KvRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const row = await this.db.selectFrom("kv").selectAll().where("key", "=", key).executeTakeFirst();
    return row ? parseJson<T>(row.value_json, null as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insertInto("kv")
      .values({ key, value_json: toJson(value)!, updated_at: now })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value_json: toJson(value)!, updated_at: now }))
      .execute();
  }

  async delete(key: string): Promise<void> {
    await this.db.deleteFrom("kv").where("key", "=", key).execute();
  }

  /** Lists every kv row whose key starts with `prefix` (used for shop-scoped job listings, e.g. "job:<shopId>:"). */
  async listByPrefix<T = unknown>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const escaped = prefix.replace(/[%_]/g, (m) => `\\${m}`);
    const rows = await this.db
      .selectFrom("kv")
      .selectAll()
      .where("key", "like", `${escaped}%`)
      .execute();
    return rows.map((row) => ({ key: row.key, value: parseJson<T>(row.value_json, null as T) }));
  }
}

// ---------------------------------------------------------------------------
// Jobs (mirrors shared's JobRecord shape)
// ---------------------------------------------------------------------------
function mapJob(row: any): JobRecord {
  return {
    jobId: row.job_id,
    shopId: row.shop_id,
    tool: row.tool,
    status: row.status as JobStatus,
    stage: row.stage ?? undefined,
    progress: row.progress,
    stages: parseJson(row.stages_json, []),
    artifacts: parseJson(row.artifacts_json, []),
    warnings: parseJson(row.warnings_json, []),
    errors: parseJson(row.errors_json, []),
    result: parseJson(row.result_json, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Skills (per-shop custom/override skills; see packages/tools/src/tools/skills.ts)
// ---------------------------------------------------------------------------
export interface SkillRow {
  skillId: string;
  shopId: string;
  name: string;
  title: string;
  description: string;
  tier: string;
  body: string;
  source: "builtin" | "custom";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapSkill(row: any): SkillRow {
  return {
    skillId: row.skill_id,
    shopId: row.shop_id,
    name: row.name,
    title: row.title,
    description: row.description,
    tier: row.tier,
    body: row.body,
    source: row.source,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SkillRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async list(shopId: string): Promise<SkillRow[]> {
    const rows = await this.db.selectFrom("skills").selectAll().where("shop_id", "=", shopId).orderBy("name", "asc").execute();
    return rows.map(mapSkill);
  }

  async get(shopId: string, name: string): Promise<SkillRow | null> {
    const row = await this.db.selectFrom("skills").selectAll().where("shop_id", "=", shopId).where("name", "=", name).executeTakeFirst();
    return row ? mapSkill(row) : null;
  }

  async upsert(input: {
    shopId: string;
    name: string;
    title: string;
    description: string;
    tier?: string;
    body: string;
    source?: "builtin" | "custom";
    enabled?: boolean;
  }): Promise<SkillRow> {
    const now = new Date().toISOString();
    const existing = await this.get(input.shopId, input.name);
    const skillId = existing?.skillId ?? newId("skill");
    const values = {
      skill_id: skillId,
      shop_id: input.shopId,
      name: input.name,
      title: input.title,
      description: input.description,
      tier: input.tier ?? existing?.tier ?? "free",
      body: input.body,
      source: input.source ?? existing?.source ?? "custom",
      enabled: (input.enabled ?? existing?.enabled ?? true) ? 1 : 0,
      created_at: existing?.createdAt ?? now,
      updated_at: now,
    };
    if (existing) {
      await this.db
        .updateTable("skills")
        .set({
          title: values.title,
          description: values.description,
          tier: values.tier,
          body: values.body,
          source: values.source,
          enabled: values.enabled,
          updated_at: values.updated_at,
        })
        .where("skill_id", "=", skillId)
        .execute();
    } else {
      await this.db.insertInto("skills").values(values).execute();
    }
    const row = await this.get(input.shopId, input.name);
    if (!row) throw new Error("storage: skill upsert did not persist");
    return row;
  }

  async setEnabled(shopId: string, name: string, enabled: boolean): Promise<SkillRow | null> {
    await this.db
      .updateTable("skills")
      .set({ enabled: enabled ? 1 : 0, updated_at: new Date().toISOString() })
      .where("shop_id", "=", shopId)
      .where("name", "=", name)
      .execute();
    return this.get(shopId, name);
  }

  async delete(shopId: string, name: string): Promise<boolean> {
    const result = await this.db.deleteFrom("skills").where("shop_id", "=", shopId).where("name", "=", name).executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }
}

export class JobRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async create(input: {
    jobId: string;
    shopId: string;
    tool: string;
    credentialId?: string | null;
    input?: unknown;
  }): Promise<JobRecord> {
    const now = new Date().toISOString();
    await this.db
      .insertInto("jobs")
      .values({
        job_id: input.jobId,
        shop_id: input.shopId,
        tool: input.tool,
        status: "queued",
        stage: null,
        progress: 0,
        stages_json: toJson([]),
        artifacts_json: toJson([]),
        warnings_json: toJson([]),
        errors_json: toJson([]),
        result_json: null,
        input_json: toJson(input.input ?? null),
        credential_id: input.credentialId ?? null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const row = await this.get(input.jobId);
    if (!row) throw new Error("storage: job create did not persist");
    return row;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const row = await this.db.selectFrom("jobs").selectAll().where("job_id", "=", jobId).executeTakeFirst();
    return row ? mapJob(row) : null;
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) set["status"] = patch.status;
    if (patch.stage !== undefined) set["stage"] = patch.stage;
    if (patch.progress !== undefined) set["progress"] = patch.progress;
    if (patch.stages !== undefined) set["stages_json"] = toJson(patch.stages);
    if (patch.artifacts !== undefined) set["artifacts_json"] = toJson(patch.artifacts);
    if (patch.warnings !== undefined) set["warnings_json"] = toJson(patch.warnings);
    if (patch.errors !== undefined) set["errors_json"] = toJson(patch.errors);
    if (patch.result !== undefined) set["result_json"] = toJson(patch.result);
    await this.db.updateTable("jobs").set(set as any).where("job_id", "=", jobId).execute();
    return this.get(jobId);
  }

  async listByShop(shopId: string, opts: { status?: JobStatus; limit?: number } = {}): Promise<JobRecord[]> {
    let q = this.db.selectFrom("jobs").selectAll().where("shop_id", "=", shopId);
    if (opts.status) q = q.where("status", "=", opts.status);
    q = q.orderBy("created_at", "desc").limit(opts.limit ?? 50);
    const rows = await q.execute();
    return rows.map(mapJob);
  }

  async cancel(jobId: string): Promise<JobRecord | null> {
    return this.update(jobId, { status: "cancelled" });
  }
}

// ---------------------------------------------------------------------------
// Design manifests (docs/STORE_DIGITAL_TWIN.md §2)
// ---------------------------------------------------------------------------
export interface DesignManifestRow {
  manifestId: string;
  shopId: string;
  version: number;
  name: string;
  manifest: Record<string, unknown>;
  source: "extracted" | "authored";
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

function mapDesignManifest(row: any): DesignManifestRow {
  return {
    manifestId: row.manifest_id,
    shopId: row.shop_id,
    version: row.version,
    name: row.name,
    manifest: parseJson(row.manifest_json, {}),
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
    isActive: !!row.is_active,
  };
}

export class DesignManifestRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async list(shopId: string): Promise<DesignManifestRow[]> {
    const rows = await this.db
      .selectFrom("design_manifests")
      .selectAll()
      .where("shop_id", "=", shopId)
      .orderBy("version", "desc")
      .execute();
    return rows.map(mapDesignManifest);
  }

  async get(manifestId: string): Promise<DesignManifestRow | null> {
    const row = await this.db.selectFrom("design_manifests").selectAll().where("manifest_id", "=", manifestId).executeTakeFirst();
    return row ? mapDesignManifest(row) : null;
  }

  async getActive(shopId: string): Promise<DesignManifestRow | null> {
    const row = await this.db
      .selectFrom("design_manifests")
      .selectAll()
      .where("shop_id", "=", shopId)
      .where("is_active", "=", 1)
      .executeTakeFirst();
    return row ? mapDesignManifest(row) : null;
  }

  async create(input: {
    manifestId: string;
    shopId: string;
    name: string;
    manifest: Record<string, unknown>;
    source: "extracted" | "authored";
    createdBy: string;
    activate?: boolean;
  }): Promise<DesignManifestRow> {
    const now = new Date().toISOString();
    const latest = await this.db
      .selectFrom("design_manifests")
      .select(({ fn }) => fn.max("version").as("maxVersion"))
      .where("shop_id", "=", input.shopId)
      .executeTakeFirst();
    const nextVersion = (Number((latest as any)?.maxVersion) || 0) + 1;

    if (input.activate) {
      await this.db.updateTable("design_manifests").set({ is_active: 0 }).where("shop_id", "=", input.shopId).execute();
    }

    await this.db
      .insertInto("design_manifests")
      .values({
        manifest_id: input.manifestId,
        shop_id: input.shopId,
        version: nextVersion,
        name: input.name,
        manifest_json: toJson(input.manifest)!,
        source: input.source,
        created_by: input.createdBy,
        created_at: now,
        is_active: input.activate ? 1 : 0,
      })
      .execute();
    const row = await this.get(input.manifestId);
    if (!row) throw new Error("storage: design manifest create did not persist");
    return row;
  }

  async setActive(shopId: string, manifestId: string): Promise<void> {
    await this.db.updateTable("design_manifests").set({ is_active: 0 }).where("shop_id", "=", shopId).execute();
    await this.db.updateTable("design_manifests").set({ is_active: 1 }).where("manifest_id", "=", manifestId).where("shop_id", "=", shopId).execute();
  }

  async delete(manifestId: string): Promise<void> {
    await this.db.deleteFrom("design_manifests").where("manifest_id", "=", manifestId).execute();
  }
}

// ---------------------------------------------------------------------------
// Entitlements (Freemius-backed; docs/FREE_PRO_AGENCY_MATRIX.md)
// ---------------------------------------------------------------------------
export interface EntitlementRow {
  shopId: string;
  state: string;
  plan: string | null;
  entitlements: string[];
  seats: { shops: number; members: number } | null;
  licenseRef: string | null;
  freemiusUserId: string | null;
  freemiusLicenseId: string | null;
  graceUntil: string | null;
  updatedAt: string;
  rawLastEvent: Record<string, unknown> | null;
}

function mapEntitlement(row: any): EntitlementRow {
  return {
    shopId: row.shop_id,
    state: row.state,
    plan: row.plan,
    entitlements: parseJson(row.entitlements_json, []),
    seats: parseJson(row.seats_json, null),
    licenseRef: row.license_ref,
    freemiusUserId: row.freemius_user_id,
    freemiusLicenseId: row.freemius_license_id,
    graceUntil: row.grace_until,
    updatedAt: row.updated_at,
    rawLastEvent: parseJson(row.raw_last_event_json, null),
  };
}

// ---------------------------------------------------------------------------
// Connections (the original WordPress plugin includes/connections.php port): one row per
// (credential, client) pair known to have reached the MCP endpoint.
// ---------------------------------------------------------------------------

/** Recognised MCP client keys, longest/most-specific match first. */
const KNOWN_CLIENT_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "claude-code", re: /claude[\s-]?code/i },
  { key: "claude-desktop", re: /claude[\s-]?desktop|claude-ai|^claude$/i },
  { key: "cursor", re: /cursor/i },
  { key: "codex", re: /codex/i },
  { key: "vscode", re: /vscode|visual studio code/i },
  { key: "gemini", re: /gemini/i },
  { key: "chatgpt", re: /chatgpt|openai/i },
  { key: "windsurf", re: /windsurf/i },
];

/**
 * Bucket a reported client name into a stable, short key. Recognised clients
 * collapse to a registry key (so "Claude Code" and "claude-code/1.2" are one
 * connection); anything else hashes to `other:<md5-8>`, stable and short
 * enough to sit in a unique index without storing the raw (arbitrary-length)
 * name as the join key.
 */
export function normalizeClientKey(clientName: string): string {
  const name = clientName.trim();
  if (name === "") return "unknown";
  for (const { key, re } of KNOWN_CLIENT_PATTERNS) {
    if (re.test(name)) return key;
  }
  return `other:${createHash("md5").update(name.toLowerCase()).digest("hex").slice(0, 8)}`;
}

export interface ConnectionRow {
  id: string;
  shopId: string;
  credentialId: string;
  credentialLabel: string;
  kind: "token" | "oauth" | "admin_ui";
  clientKey: string;
  clientName: string;
  clientVersion: string;
  protocolVersion: string;
  firstSeen: string;
  lastSeen: string;
  requestCount: number;
}

function mapConnection(row: any): ConnectionRow {
  return {
    id: row.id,
    shopId: row.shop_id,
    credentialId: row.credential_id,
    credentialLabel: row.credential_label,
    kind: row.kind,
    clientKey: row.client_key,
    clientName: row.client_name,
    clientVersion: row.client_version,
    protocolVersion: row.protocol_version,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    requestCount: row.request_count,
  };
}

export class ConnectionRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  /**
   * Record one authenticated MCP request against its (credential, client)
   * pair. A single upsert incrementing request_count so concurrent traffic
   * cannot lose a count the way a read-modify-write would; an empty
   * client name/version does not erase what a previous request recorded.
   */
  async record(input: {
    shopId: string;
    credentialId: string;
    credentialLabel: string;
    kind: "token" | "oauth" | "admin_ui";
    clientName?: string;
    clientVersion?: string;
    protocolVersion?: string;
  }): Promise<ConnectionRow> {
    const clientName = input.clientName ?? "";
    const clientVersion = input.clientVersion ?? "";
    const clientKey = normalizeClientKey(clientName);
    const now = new Date().toISOString();

    const existing = await this.db
      .selectFrom("connections")
      .selectAll()
      .where("shop_id", "=", input.shopId)
      .where("credential_id", "=", input.credentialId)
      .where("client_key", "=", clientKey)
      .executeTakeFirst();

    if (!existing) {
      const id = newId("conn");
      await this.db
        .insertInto("connections")
        .values({
          id,
          shop_id: input.shopId,
          credential_id: input.credentialId,
          credential_label: input.credentialLabel,
          kind: input.kind,
          client_key: clientKey,
          client_name: clientName,
          client_version: clientVersion,
          protocol_version: input.protocolVersion ?? "",
          first_seen: now,
          last_seen: now,
          request_count: 1,
        })
        .execute();
      const row = await this.getById(id);
      if (!row) throw new Error("storage: connection insert did not persist");
      return row;
    }

    await this.db
      .updateTable("connections")
      .set({
        credential_label: input.credentialLabel,
        client_name: clientName !== "" ? clientName : existing.client_name,
        client_version: clientVersion !== "" ? clientVersion : existing.client_version,
        protocol_version: input.protocolVersion ?? existing.protocol_version,
        last_seen: now,
        request_count: (existing.request_count as number) + 1,
      })
      .where("id", "=", existing.id)
      .execute();
    const row = await this.getById(existing.id);
    if (!row) throw new Error("storage: connection update did not persist");
    return row;
  }

  async getById(id: string): Promise<ConnectionRow | null> {
    const row = await this.db.selectFrom("connections").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? mapConnection(row) : null;
  }

  async list(shopId: string): Promise<ConnectionRow[]> {
    const rows = await this.db.selectFrom("connections").selectAll().where("shop_id", "=", shopId).orderBy("last_seen", "desc").execute();
    return rows.map(mapConnection);
  }

  async forget(id: string): Promise<boolean> {
    const result = await this.db.deleteFrom("connections").where("id", "=", id).executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * Forgets every connection row for this shop whose credential no longer
   * exists (revoked or deleted) or is unknown to `existingCredentialIds`.
   * Returns the number of rows removed.
   */
  async forgetStale(shopId: string, existingCredentialIds: ReadonlySet<string>): Promise<number> {
    const rows = await this.list(shopId);
    let removed = 0;
    for (const row of rows) {
      if (!existingCredentialIds.has(row.credentialId)) {
        if (await this.forget(row.id)) removed++;
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Memory (the original Pro plugin the original memory abilities port): persistent,
// database-backed memories agents build up across conversations, with a
// version history enabling "restore".
// ---------------------------------------------------------------------------
export type MemoryType = "user" | "feedback" | "project" | "reference" | "design";

export interface MemoryRow {
  memoryId: string;
  shopId: string;
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemoryVersionRow {
  memoryId: string;
  version: number;
  name: string;
  description: string;
  type: string;
  content: string;
  savedBy: string;
  savedAt: string;
}

const MAX_MEMORY_VERSIONS = 50;

function mapMemory(row: any): MemoryRow {
  return {
    memoryId: row.memory_id,
    shopId: row.shop_id,
    name: row.name,
    description: row.description,
    type: row.type,
    content: row.content,
    enabled: !!row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapMemoryVersion(row: any): MemoryVersionRow {
  return {
    memoryId: row.memory_id,
    version: row.version,
    name: row.name,
    description: row.description,
    type: row.type,
    content: row.content,
    savedBy: row.saved_by,
    savedAt: row.saved_at,
  };
}

export class MemoryRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async list(shopId: string, type?: MemoryType): Promise<MemoryRow[]> {
    let q = this.db.selectFrom("memories").selectAll().where("shop_id", "=", shopId);
    if (type) q = q.where("type", "=", type);
    const rows = await q.orderBy("name", "asc").execute();
    return rows.map(mapMemory);
  }

  async get(memoryId: string): Promise<MemoryRow | null> {
    const row = await this.db.selectFrom("memories").selectAll().where("memory_id", "=", memoryId).executeTakeFirst();
    return row ? mapMemory(row) : null;
  }

  async getByName(shopId: string, name: string): Promise<MemoryRow | null> {
    const row = await this.db.selectFrom("memories").selectAll().where("shop_id", "=", shopId).where("name", "=", name).executeTakeFirst();
    return row ? mapMemory(row) : null;
  }

  private async writeVersion(row: MemoryRow, savedBy: string): Promise<void> {
    await this.db
      .insertInto("memory_versions")
      .values({
        memory_id: row.memoryId,
        version: row.version,
        name: row.name,
        description: row.description,
        type: row.type,
        content: row.content,
        saved_by: savedBy,
        saved_at: row.updatedAt,
      })
      .execute();

    // Bounded retention: keep only the most recent MAX_MEMORY_VERSIONS rows.
    const versions = await this.db
      .selectFrom("memory_versions")
      .select(["version"])
      .where("memory_id", "=", row.memoryId)
      .orderBy("version", "desc")
      .execute();
    if (versions.length > MAX_MEMORY_VERSIONS) {
      const cutoff = versions[MAX_MEMORY_VERSIONS]!.version;
      await this.db.deleteFrom("memory_versions").where("memory_id", "=", row.memoryId).where("version", "<=", cutoff).execute();
    }
  }

  /** Creates a new memory, or updates an existing one (bumping its version and writing a memory_versions row of the new state). */
  async save(input: {
    memoryId?: string;
    shopId: string;
    name: string;
    description: string;
    type: MemoryType;
    content: string;
    createdBy: string;
  }): Promise<MemoryRow> {
    const now = new Date().toISOString();
    const existing = input.memoryId ? await this.get(input.memoryId) : null;

    if (!existing) {
      const memoryId = input.memoryId ?? newId("mem");
      const row: MemoryRow = {
        memoryId,
        shopId: input.shopId,
        name: input.name,
        description: input.description,
        type: input.type,
        content: input.content,
        enabled: true,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await this.db
        .insertInto("memories")
        .values({
          memory_id: row.memoryId,
          shop_id: row.shopId,
          name: row.name,
          description: row.description,
          type: row.type,
          content: row.content,
          enabled: 1,
          created_by: row.createdBy,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
          version: row.version,
        })
        .execute();
      await this.writeVersion(row, input.createdBy);
      return row;
    }

    const updated: MemoryRow = {
      ...existing,
      name: input.name,
      description: input.description,
      type: input.type,
      content: input.content,
      updatedAt: now,
      version: existing.version + 1,
    };
    await this.db
      .updateTable("memories")
      .set({
        name: updated.name,
        description: updated.description,
        type: updated.type,
        content: updated.content,
        updated_at: updated.updatedAt,
        version: updated.version,
      })
      .where("memory_id", "=", updated.memoryId)
      .execute();
    await this.writeVersion(updated, input.createdBy);
    return updated;
  }

  async setEnabled(memoryId: string, enabled: boolean): Promise<MemoryRow | null> {
    await this.db
      .updateTable("memories")
      .set({ enabled: enabled ? 1 : 0, updated_at: new Date().toISOString() })
      .where("memory_id", "=", memoryId)
      .execute();
    return this.get(memoryId);
  }

  /** Hard delete. Version history rows for this memory are removed too. */
  async delete(memoryId: string): Promise<boolean> {
    await this.db.deleteFrom("memory_versions").where("memory_id", "=", memoryId).execute();
    const result = await this.db.deleteFrom("memories").where("memory_id", "=", memoryId).executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  async versions(memoryId: string): Promise<MemoryVersionRow[]> {
    const rows = await this.db.selectFrom("memory_versions").selectAll().where("memory_id", "=", memoryId).orderBy("version", "desc").execute();
    return rows.map(mapMemoryVersion);
  }

  /** Copies a past version's fields into the memory as a new version (a "reroll"/restore). */
  async restore(memoryId: string, version: number, restoredBy: string): Promise<MemoryRow | null> {
    const target = await this.db
      .selectFrom("memory_versions")
      .selectAll()
      .where("memory_id", "=", memoryId)
      .where("version", "=", version)
      .executeTakeFirst();
    if (!target) return null;
    return this.save({
      memoryId,
      shopId: (await this.get(memoryId))?.shopId ?? "",
      name: target.name,
      description: target.description,
      type: target.type as MemoryType,
      content: target.content,
      createdBy: restoredBy,
    });
  }
}

export class EntitlementRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async get(shopId: string): Promise<EntitlementRow | null> {
    const row = await this.db.selectFrom("entitlements").selectAll().where("shop_id", "=", shopId).executeTakeFirst();
    return row ? mapEntitlement(row) : null;
  }

  async upsert(input: {
    shopId: string;
    state: string;
    plan?: string | null;
    entitlements?: string[];
    seats?: { shops: number; members: number } | null;
    licenseRef?: string | null;
    freemiusUserId?: string | null;
    freemiusLicenseId?: string | null;
    graceUntil?: string | null;
    rawLastEvent?: Record<string, unknown> | null;
  }): Promise<EntitlementRow> {
    const now = new Date().toISOString();
    const existing = await this.get(input.shopId);
    const values = {
      shop_id: input.shopId,
      state: input.state,
      plan: input.plan !== undefined ? input.plan : (existing?.plan ?? null),
      entitlements_json: toJson(input.entitlements ?? existing?.entitlements ?? []),
      seats_json: toJson(input.seats !== undefined ? input.seats : (existing?.seats ?? null)),
      license_ref: input.licenseRef !== undefined ? input.licenseRef : (existing?.licenseRef ?? null),
      freemius_user_id: input.freemiusUserId !== undefined ? input.freemiusUserId : (existing?.freemiusUserId ?? null),
      freemius_license_id: input.freemiusLicenseId !== undefined ? input.freemiusLicenseId : (existing?.freemiusLicenseId ?? null),
      grace_until: input.graceUntil !== undefined ? input.graceUntil : (existing?.graceUntil ?? null),
      updated_at: now,
      raw_last_event_json: toJson(input.rawLastEvent !== undefined ? input.rawLastEvent : (existing?.rawLastEvent ?? null)),
    };
    await this.db
      .insertInto("entitlements")
      .values(values)
      .onConflict((oc) =>
        oc.column("shop_id").doUpdateSet({
          state: values.state,
          plan: values.plan,
          entitlements_json: values.entitlements_json,
          seats_json: values.seats_json,
          license_ref: values.license_ref,
          freemius_user_id: values.freemius_user_id,
          freemius_license_id: values.freemius_license_id,
          grace_until: values.grace_until,
          updated_at: values.updated_at,
          raw_last_event_json: values.raw_last_event_json,
        }),
      )
      .execute();
    const row = await this.get(input.shopId);
    if (!row) throw new Error("storage: entitlement upsert did not persist");
    return row;
  }
}
