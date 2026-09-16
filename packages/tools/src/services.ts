/**
 * Local service interfaces that tool handlers pull out of `ctx.services`
 * (a free-form registry, see @shopmanagerai/shared ToolContext). Kept local
 * to this package so `@shopmanagerai/tools` never depends on storage/ledger
 * concretely; whatever wires up the server supplies real implementations
 * (or the in-memory ones in `testing/fakes.ts`) under these same keys.
 */
import type { Credential, DesignManifest } from "@shopmanagerai/shared";

/**
 * Plans and executes rollback for a completed operation, using the ledger's
 * recorded before-images (strategy "ledger_before_image") or a snapshot
 * (strategy "snapshot"). Looked up as `ctx.services.get("rollback")`.
 */
export interface RollbackPlanStep {
  resource: string;
  kind: string;
  description: string;
}
export interface RollbackPlan {
  operationId: string;
  strategy: string;
  steps: RollbackPlanStep[];
  available: boolean;
  reason?: string;
}
export interface RollbackExecuteResult {
  operationId: string;
  executed: boolean;
  restored: string[];
  errors: Array<{ resource: string; message: string }>;
}
export interface RollbackService {
  plan(operationId: string): Promise<RollbackPlan>;
  execute(operationId: string, opts?: { force?: boolean }): Promise<RollbackExecuteResult>;
}

/** Looked up as `ctx.services.get("credentials")`. Optional, used by commerce.connections. */
export interface CredentialsService {
  list(shopId: string): Promise<Credential[]>;
}

/** Looked up as `ctx.services.get("settings")`. Optional, used by commerce.config.*. */
export interface SettingsService {
  get(shopId: string): Promise<Record<string, unknown>>;
  validate(shopId: string, patch: Record<string, unknown>): Promise<{ valid: boolean; errors: string[] }>;
}

/** Looked up as `ctx.services.get("registry")` so system tools can introspect the live registry. */
export const REGISTRY_SERVICE_KEY = "registry";
export const API_VERSION_SERVICE_KEY = "apiVersion";
export const ROLLBACK_SERVICE_KEY = "rollback";
export const CREDENTIALS_SERVICE_KEY = "credentials";
export const SETTINGS_SERVICE_KEY = "settings";

/** Looked up as `ctx.services.get("storefrontPassword")`. Stores the Online Store password encrypted; never returns it to tools. */
export interface StorefrontPasswordService {
  set(shopId: string, password: string): Promise<void>;
  clear(shopId: string): Promise<void>;
  has(shopId: string): Promise<boolean>;
}
export const STOREFRONT_PASSWORD_SERVICE_KEY = "storefrontPassword";

// ---------------------------------------------------------------------------
// Design manifests (docs/STORE_DIGITAL_TWIN.md §2)
// ---------------------------------------------------------------------------
export interface DesignManifestRecord {
  manifestId: string;
  shopId: string;
  version: number;
  name: string;
  manifest: DesignManifest;
  source: "extracted" | "authored";
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

/** Looked up as `ctx.services.get("designManifests")`. */
export interface DesignManifestService {
  list(shopId: string): Promise<DesignManifestRecord[]>;
  get(manifestId: string): Promise<DesignManifestRecord | null>;
  getActive(shopId: string): Promise<DesignManifestRecord | null>;
  create(input: {
    shopId: string;
    name: string;
    manifest: DesignManifest;
    source: "extracted" | "authored";
    createdBy: string;
    activate?: boolean;
  }): Promise<DesignManifestRecord>;
  setActive(shopId: string, manifestId: string): Promise<void>;
  delete(manifestId: string): Promise<void>;
}

export const DESIGN_MANIFESTS_SERVICE_KEY = "designManifests";

/**
 * Per-shop skill storage, looked up as `ctx.services.get("skills")`. Keeps
 * `commerce.skills.*` tools storage-agnostic, the server wires a real
 * SkillRepo-backed implementation; tests use the in-memory fake in
 * `testing/fakes.ts`.
 */
export interface SkillRecord {
  name: string;
  title: string;
  description: string;
  tier: string;
  body: string;
  source: "builtin" | "custom";
  enabled: boolean;
  updatedAt: string;
}
export interface SkillsService {
  list(shopId: string): Promise<SkillRecord[]>;
  get(shopId: string, name: string): Promise<SkillRecord | null>;
  upsert(shopId: string, input: { name: string; title: string; description: string; tier?: string; body: string }): Promise<SkillRecord>;
  delete(shopId: string, name: string): Promise<boolean>;
  setEnabled(shopId: string, name: string, enabled: boolean): Promise<SkillRecord | null>;
}
export const SKILLS_SERVICE_KEY = "skills";

// ---------------------------------------------------------------------------
// Visual audit sessions (Pro visual-intelligence): a small, in-process record
// of the issues/score from a `shopify.visual.*` capture so a follow-up call
// (issue/score/plan_repair/verify) can reference it without re-capturing.
// Not a durable store, Free 0.1 persists no screenshots server-side; this is
// scoped to the current process/shop and safe to lose.
// ---------------------------------------------------------------------------
export interface VisualIssueRecord {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OPPORTUNITY";
  viewport?: string;
  kind: string;
  evidence: unknown[];
  suggestedFix: string;
  ownership: "theme" | "app" | "unknown";
  sectionFile?: string;
}
export interface VisualAuditSession {
  sessionId: string;
  shopId: string;
  url: string;
  viewportsCaptured: number;
  issues: VisualIssueRecord[];
  score: number;
  breakdown: Record<string, number>;
  createdAt: string;
}

/** Looked up as `ctx.services.get("visualAudits")`. */
export interface VisualAuditService {
  save(session: Omit<VisualAuditSession, "sessionId" | "createdAt">): Promise<VisualAuditSession>;
  get(sessionId: string): Promise<VisualAuditSession | null>;
  latest(shopId: string): Promise<VisualAuditSession | null>;
  findIssue(shopId: string, issueId: string): Promise<{ session: VisualAuditSession; issue: VisualIssueRecord } | null>;
}
export const VISUAL_AUDIT_SERVICE_KEY = "visualAudits";

// ---------------------------------------------------------------------------
// Tiny namespaced key/value store, looked up as `ctx.services.get("kv")`. Used
// by Pro diagnostics tools (e.g. conflict-doctor's last-scan-per-shop cache)
// that need small, cheap persistence without depending on ledger/storage
// concretely. The server wires this over storage's KvRepo; tests use the
// in-memory fake in `testing/fakes.ts`.
// ---------------------------------------------------------------------------
export interface KvService {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
export const KV_SERVICE_KEY = "kv";

// ---------------------------------------------------------------------------
// Connections (the original WordPress plugin includes/connections.php port): which AI clients have
// actually reached the MCP endpoint for this shop, and how much. Looked up
// as `ctx.services.get("connections")`. Never carries secrets, tokens, or IPs.
// ---------------------------------------------------------------------------
export interface ConnectionRecord {
  id: string;
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
export interface ConnectionsService {
  list(shopId: string): Promise<ConnectionRecord[]>;
  forget(id: string): Promise<boolean>;
  forgetStale(shopId: string): Promise<number>;
}
export const CONNECTIONS_SERVICE_KEY = "connections";

// ---------------------------------------------------------------------------
// Memory (the original Pro plugin the original memory abilities port): persistent,
// database-backed memories agents build up across conversations. Looked up
// as `ctx.services.get("memory")`.
// ---------------------------------------------------------------------------
export const MEMORY_TYPES = ["user", "feedback", "project", "reference", "design"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryRecord {
  id: string;
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
export interface MemoryVersionRecord {
  version: number;
  name: string;
  description: string;
  type: string;
  content: string;
  savedBy: string;
  savedAt: string;
}
export interface MemoryService {
  list(shopId: string, type?: MemoryType): Promise<MemoryRecord[]>;
  get(shopId: string, idOrName: string): Promise<MemoryRecord | null>;
  save(shopId: string, input: { id?: string; name: string; description: string; type: MemoryType; content: string; createdBy: string }): Promise<MemoryRecord>;
  delete(shopId: string, id: string): Promise<boolean>;
  versions(shopId: string, id: string): Promise<MemoryVersionRecord[]>;
  restore(shopId: string, id: string, version: number, restoredBy: string): Promise<MemoryRecord | null>;
  isEnabled(shopId: string): Promise<boolean>;
  setEnabled(shopId: string, enabled: boolean): Promise<void>;
}
export const MEMORY_SERVICE_KEY = "memory";

/** Looked up as `ctx.services.get("appInfo")`: facts about this app the webhook/diagnostics tools need (Phase 6). */
export interface AppInfoService {
  appUrl: string;
  apiVersion: string;
  configuredScopes: string[];
  expectedWebhookTopics: string[];
  /** HMAC-SHA256 (base64) of a raw body with the app client secret, or null when no secret is configured. */
  signWebhookBody(rawBody: string): string | null;
  lastWebhookReceipt(shopId: string, topic: string): Promise<{ receivedAt: string; webhookId?: string } | null>;
}
export const APP_INFO_SERVICE_KEY = "appInfo";
