/** Tiers, risk classes, profiles, envelope. Vocabulary from docs/PRODUCT_ARCHITECTURE.md. */

export const TIERS = ["free", "pro", "agency"] as const;
export type Tier = (typeof TIERS)[number];

export const RISK_CLASSES = [
  "read",
  "write",
  "theme_write",
  "bulk",
  "commerce_sensitive",
  "destructive",
  "publish",
  "critical",
] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/**
 * Agent-facing risk levels (spec vocabulary). Derived from riskClass + category by
 * the registry; enforcement still keys off riskClass.
 */
export const RISK_LEVELS = ["READ_ONLY", "SAFE_WRITE", "CONTENT_WRITE", "DESIGN_WRITE", "COMMERCE_WRITE", "FINANCIAL_IMPACT", "CUSTOMER_DATA", "CHECKOUT_CRITICAL", "DESTRUCTIVE", "PRODUCTION_DEPLOY"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Ordering used by profiles: higher index = more dangerous. */
export const RISK_ORDER: Record<RiskClass, number> = {
  read: 0,
  write: 1,
  theme_write: 2,
  bulk: 3,
  commerce_sensitive: 4,
  destructive: 5,
  publish: 6,
  critical: 7,
};

export const EXECUTION_PLANES = ["server", "shopify_admin", "theme_engine", "browser", "job"] as const;
export type ExecutionPlane = (typeof EXECUTION_PLANES)[number];

export const PROFILES = ["read_only", "production_safe", "developer_full_access", "admin"] as const;
export type Profile = (typeof PROFILES)[number];

export const ROLLBACK_STRATEGIES = [
  "none",
  "ledger_before_image",
  "snapshot",
  "inverse_operation",
  "republish_previous",
] as const;
export type RollbackStrategy = (typeof ROLLBACK_STRATEGIES)[number];

export type ApprovalKind = "none" | "confirm" | "approval_token";

export const ENTITLEMENTS = [
  "free.core",
  "free.theme",
  "free.catalog",
  "free.seo_basic",
  "free.visual_capture",
  "pro.design_ai",
  "pro.visual_ai",
  "pro.auto_repair",
  "pro.seo_advanced",
  "pro.conflict_doctor",
  "pro.app_compat",
  "pro.bulk",
  "pro.orchestration",
  "pro.content",
  "pro.perf_a11y",
  "pro.commerce_ops",
  "pro.analytics",
  "pro.extensions",
  "agency.multi_store",
  "agency.team",
  "agency.cross_store",
] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

export const ENTITLEMENT_STATES = [
  "FREE",
  "TRIAL",
  "PRO_ACTIVE",
  "PRO_GRACE",
  "PRO_EXPIRED",
  "AGENCY_ACTIVE",
  "SUSPENDED",
] as const;
export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];

/** Store-level capabilities discovered by probes; tools declare what they need. */
export const STORE_CAPABILITIES = [
  "admin.read",
  "admin.write",
  "theme.read",
  "theme.write",
  "theme.engine_a",
  "theme.engine_b",
  "browser.capture",
  "jobs",
] as const;
export type StoreCapability = (typeof STORE_CAPABILITIES)[number];

/** Common mutation context (master prompt §9). Tools add their own fields. */
export interface OperationContext {
  dryRun?: boolean;
  idempotencyKey?: string;
  reason?: string;
  approvalToken?: string;
  expectedVersion?: string;
  confirm?: boolean;
  options?: Record<string, unknown>;
}

export interface Change {
  resource: string; // e.g. "theme_file:sections/hero.liquid" or "product:gid://shopify/Product/1"
  kind: "create" | "update" | "delete" | "rename" | "publish";
  before?: unknown;
  after?: unknown;
  diff?: string;
  fingerprintBefore?: string;
  fingerprintAfter?: string;
}

export interface Evidence {
  type: "text" | "json" | "image" | "resource_link" | "theme_check" | "diff";
  label: string;
  value?: unknown;
  uri?: string;
  mimeType?: string;
}

export interface NextAction {
  tool: string;
  reason: string;
  input?: Record<string, unknown>;
}

export interface RollbackInfo {
  available: boolean;
  strategy: RollbackStrategy;
  snapshotId?: string;
  operationId?: string;
  note?: string;
}

/** Standard success envelope (master prompt §10). */
export interface ToolSuccess<T = unknown> {
  ok: true;
  operationId: string;
  tool: string;
  summary: string;
  risk: RiskClass;
  data: T;
  changes: Change[];
  evidence: Evidence[];
  warnings: string[];
  errors: string[];
  nextActions: NextAction[];
  rollback: RollbackInfo;
  /** Present for task-mode tools. */
  jobId?: string;
  /** Inline MCP content (e.g. images) the transport should attach. */
  content?: McpContent[];
}

export interface ToolFailure {
  ok: false;
  operationId?: string;
  tool: string;
  code: string;
  message: string;
  technicalMessage?: string;
  retryable: boolean;
  risk: RiskClass;
  suggestedActions: NextAction[];
  details?: Record<string, unknown>;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; description?: string };

/** Identity of the caller as resolved by authentication. */
export interface Credential {
  credentialId: string;
  shopId: string;
  shopDomain: string;
  kind: "oauth" | "token" | "admin_ui" | "system";
  label: string;
  profile: Profile;
  /** Custom policy overrides, e.g. { "product.price.write": false, "bulk.maxResources": 100 } */
  policy: Record<string, boolean | number | string>;
  scopesGranted: string[];
  clientInfo?: { name?: string; version?: string };
}

export interface ShopSummary {
  shopId: string;
  domain: string;
  name?: string;
  plan?: string;
  primaryDomain?: string;
  currency?: string;
  passwordProtected?: boolean;
}

export interface Severity {
  level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OPPORTUNITY";
}

export interface Finding {
  id: string;
  severity: Severity["level"];
  category: string;
  title: string;
  detail: string;
  evidence: Evidence[];
  confidence: number; // 0..1
  location?: { file?: string; line?: number; url?: string; resource?: string };
  suggestedFix?: string;
}
