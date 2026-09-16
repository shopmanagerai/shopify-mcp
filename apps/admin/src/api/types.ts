import type {
  Credential,
  Entitlement,
  EntitlementState,
  OperationRecord,
  Profile,
  RiskClass,
  SnapshotRecord,
  ThemeRef,
} from "@shopmanagerai/shared";
import type { ToolCard } from "@shopmanagerai/shared";

export type { Credential, ToolCard, OperationRecord, SnapshotRecord, ThemeRef, Profile, RiskClass, Entitlement, EntitlementState };

/**
 * The actual shape the server's toClientCredential() sends - not the same as `Credential` above,
 * which is the server's internal auth-context type (has shopId/shopDomain/scopesGranted, lacks
 * createdAt/lastUsedAt/expiresAt/revokedAt). ConnectResponse.tokens and CreateTokenResponse.credential
 * were both mistyped as `Credential`, which TypeScript didn't catch because the two shapes happen to
 * share credentialId/label/profile/policy - until a field unique to this one (lastUsedAt) was used.
 */
export interface ClientCredential {
  credentialId: string;
  kind: "oauth" | "token" | "admin_ui" | "system";
  label: string;
  profile: Profile;
  policy: Record<string, boolean | number | string>;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ClientConfigs {
  claudeCode: string;
  cursor: string;
  codex: string;
  vscode: string;
  generic: string;
}

export interface SessionResponse {
  shop: { domain: string; name?: string; plan?: string };
  demo: boolean;
  entitlement: { state: EntitlementState; plan?: string; entitlements: Entitlement[]; upgradeUrl: string; seats?: { shops: number; members: number } };
  version: string;
}

export interface ConnectResponse {
  mcpUrl: string;
  flatMcpUrl: string;
  oauth: { authorizeUrl: string; metadataUrl: string; cimdSupported: boolean };
  tokens: ClientCredential[];
  clientConfigs: ClientConfigs;
}

export interface CreateTokenRequest {
  label: string;
  profile: Profile;
  policy?: Record<string, boolean | number | string>;
  expiresInDays?: number;
}

export interface CreateTokenResponse {
  token: string;
  credential: ClientCredential;
  clientConfigs: ClientConfigs;
}

export interface ThemeAccessResponse {
  configured: boolean;
  last4?: string;
  engineA: "ok" | "missing" | "invalid";
  engineB: "ok" | "exemption_missing" | "unknown";
}

export interface ToolsResponse {
  cards: ToolCard[];
  disabled: string[];
}

export interface PolicyProfilesResponse {
  profiles: Array<{ id: string; label: string; description: string; allowedRisks: RiskClass[] }>;
  policyKeys: Array<{ key: string; type: "boolean" | "number" | "string"; default: unknown; description: string }>;
}

export interface OperationsResponse {
  items: OperationRecord[];
  nextCursor?: string;
}

export interface OperationDetailResponse {
  operation: OperationRecord;
  rollbackPlan?: { summary: string; steps: string[]; irreversible?: string[] };
}

export interface SnapshotsResponse {
  items: SnapshotRecord[];
}

export interface ThemeResponse {
  /** null when the theme engine isn't configured for this shop, or the live-theme lookup failed. */
  live: ThemeRef | null;
  working: ThemeRef | null;
  previewUrl?: string;
  diffSummary?: { added: number; removed: number; changed: number };
}

export interface DetectedApp {
  name: string;
  handle?: string;
  category: string;
  confidence: number;
  integrationTypes: string[];
  locations: string[];
}

export interface PreservationEntry {
  id: string;
  description: string;
  resource?: string;
}

export interface AppsResponse {
  detected: DetectedApp[];
  preservation: PreservationEntry[];
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail?: string;
}

export interface DiagnosticsResponse {
  checks: DiagnosticCheck[];
}

export interface PrivacyResponse {
  retainSnapshotsDays: number;
  retainScreenshotsDays: number;
  retainLedgerDays: number;
  twinStoresContent: boolean;
  telemetry: boolean;
}

export interface SkillItem {
  name: string;
  title: string;
  description: string;
  tier: string;
  source: "builtin" | "custom";
  enabled: boolean;
  updatedAt: string;
}

export interface SkillDetail extends SkillItem {
  body: string;
}

export interface SkillsResponse {
  skills: SkillItem[];
}

export interface SkillWriteRequest {
  name: string;
  title: string;
  description: string;
  tier?: string;
  body: string;
}

export interface ApprovalResponse {
  token: string;
  expiresAt: string;
  planHash: string;
}

// ---------- Design manifests ----------
export interface DesignManifestCard {
  manifestId: string;
  shopId: string;
  version: number;
  name: string;
  source: "extracted" | "authored";
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

export interface DesignManifestDetail extends DesignManifestCard {
  manifest: Record<string, unknown>;
}

export interface DesignManifestsResponse {
  manifests: DesignManifestCard[];
}

export interface DesignManifestValidationResponse {
  valid: boolean;
  schemaIssues: unknown[];
  semanticIssues: Array<{ path: string; message: string; severity: "error" | "warning" }>;
}

// ---------- Design Pro: anti-generic audit ----------
export interface AntiGenericFinding {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OPPORTUNITY";
  category: string;
  title: string;
  detail: string;
  confidence: number;
  location?: { file?: string };
  suggestedFix?: string;
}
export interface AntiGenericAuditResponse {
  findings: AntiGenericFinding[];
  countsBySeverity: Record<string, number>;
}

// ---------- Store orchestration jobs / reports ----------
export interface JobStage {
  name: string;
  status: "running" | "done" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  note?: string;
}
export interface JobRecordSummary {
  jobId: string;
  shopId: string;
  tool: string;
  createdAt: string;
  updatedAt: string;
  stages: JobStage[];
  ok?: boolean;
  result?: unknown;
}
export interface JobsResponse {
  jobs: JobRecordSummary[];
}
export interface JobDetailResponse {
  job: JobRecordSummary;
}

// ---------- Connections (the original WordPress plugin includes/connections.php port) ----------
export interface ConnectionRow {
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
export interface ConnectionsResponse {
  connections: ConnectionRow[];
}

// ---------- Memory (the original Pro plugin original-plugin-memory port) ----------
export type MemoryType = "user" | "feedback" | "project" | "reference" | "design";
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
export interface MemoriesResponse {
  memories: MemoryRecord[];
}
export interface MemoryVersionsResponse {
  versions: MemoryVersionRecord[];
}
export interface MemoryWriteRequest {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}
export interface MemorySettingsResponse {
  enabled: boolean;
}

// ---------- Entitlement (Freemius) ----------
export interface EntitlementResponse {
  state: EntitlementState;
  plan?: string;
  entitlements: Entitlement[];
  seats?: { shops: number; members: number };
  graceUntil?: string;
  upgradeUrl: string;
  activationUrl: string;
  shopifyPricingUrl?: string | null;
  billedVia?: "shopify" | "account" | "license" | null;
}
