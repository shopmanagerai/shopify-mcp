/**
 * Execution-plane interfaces. Tool handlers depend on these, never on concrete
 * clients, so tests can substitute fakes and the private Pro repo can reuse them.
 */
import type { Change, Credential, Entitlement, EntitlementState, Evidence, ShopSummary, StoreCapability } from "./types.js";

// ---------- Shopify Admin GraphQL ----------
export interface GraphqlResult<T = any> {
  data: T;
  extensions?: { cost?: { requestedQueryCost: number; actualQueryCost: number; throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } } };
  deprecations?: string[];
}
export interface AdminClient {
  readonly apiVersion: string;
  query<T = any>(document: string, variables?: Record<string, unknown>, opts?: { cost?: number }): Promise<GraphqlResult<T>>;
  mutate<T = any>(document: string, variables?: Record<string, unknown>, opts?: { cost?: number }): Promise<GraphqlResult<T>>;
}

// ---------- Theme engine ----------
export interface ThemeRef {
  id: string; // numeric id as string
  gid?: string;
  name: string;
  role: "main" | "unpublished" | "development" | "demo" | string;
  updatedAt?: string;
  processing?: boolean;
}
export interface ThemeFile {
  key: string; // e.g. "sections/hero.liquid"
  content?: string; // text files
  contentBase64?: string; // binary
  size?: number;
  checksum?: string;
  updatedAt?: string;
  contentType?: string;
}
export interface ThemeFileWrite {
  key: string;
  content?: string;
  contentBase64?: string;
}
export interface ThemeEngine {
  readonly kind: "theme_access_proxy" | "admin_graphql" | "fake";
  listThemes(): Promise<ThemeRef[]>;
  getTheme(themeId: string): Promise<ThemeRef | null>;
  listFiles(themeId: string, opts?: { prefix?: string }): Promise<ThemeFile[]>; // metadata only
  readFiles(themeId: string, keys: string[]): Promise<ThemeFile[]>;
  writeFiles(themeId: string, files: ThemeFileWrite[]): Promise<{ written: string[]; errors: Array<{ key: string; message: string }> }>;
  deleteFiles(themeId: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }>;
  duplicateTheme(sourceThemeId: string, name: string): Promise<ThemeRef>;
  publishTheme(themeId: string): Promise<ThemeRef>;
  deleteTheme(themeId: string): Promise<void>;
  renameTheme(themeId: string, name: string): Promise<ThemeRef>;
  /**
   * Optional: creates a brand-new unpublished theme from a remote zip URL
   * (`shopify.theme.install_from_url`). Not every engine implements this , 
   * callers should check for its presence before calling.
   */
  createFromUrl?(src: string, name: string): Promise<ThemeRef>;
}

// ---------- Browser capture ----------
export interface CaptureRequest {
  url: string;
  viewports: Array<{ width: number; height: number; label?: string }>;
  fullPage?: boolean;
  selector?: string;
  waitFor?: { networkIdleMs?: number; fontsReady?: boolean; imagesReady?: boolean; freezeAnimations?: boolean; timeoutMs?: number };
  storefrontPassword?: string;
}
export interface CaptureResult {
  viewport: { width: number; height: number; label?: string };
  pngBase64: string;
  metrics: { documentWidth: number; documentHeight: number; horizontalOverflow: boolean; consoleErrors: string[]; failedRequests: string[]; scriptHosts: string[]; loadMs: number };
}
export interface BrowserPlane {
  capture(req: CaptureRequest): Promise<CaptureResult[]>;
}

// ---------- Ledger & snapshots ----------
export interface OperationRecord {
  operationId: string;
  shopId: string;
  credentialId: string;
  credentialLabel: string;
  tool: string;
  tier: string;
  risk: string;
  status: "pending" | "succeeded" | "failed" | "rolled_back";
  inputsHash: string;
  inputsRedacted: unknown;
  resources: string[];
  changes: Change[];
  evidence: Evidence[];
  warnings: string[];
  approval?: { kind: string; token?: string; approvedBy?: string };
  rollback: { available: boolean; strategy: string; snapshotId?: string; executedAt?: string; byOperationId?: string };
  error?: { code: string; message: string };
  era?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}
export interface SnapshotRecord {
  snapshotId: string;
  shopId: string;
  kind: "theme" | "resource" | "seo_baseline" | "visual_baseline";
  label: string;
  themeId?: string;
  resourceIds?: string[];
  fileCount?: number;
  bytes?: number;
  createdAt: string;
  createdBy: string;
  operationId?: string;
}
export interface Ledger {
  begin(rec: Omit<OperationRecord, "status" | "startedAt">): Promise<OperationRecord>;
  finish(operationId: string, patch: Partial<OperationRecord>): Promise<OperationRecord>;
  get(operationId: string): Promise<OperationRecord | null>;
  list(shopId: string, opts?: { limit?: number; cursor?: string; tool?: string; status?: OperationRecord["status"] }): Promise<{ items: OperationRecord[]; nextCursor?: string }>;
}
export interface SnapshotStore {
  createThemeSnapshot(shopId: string, themeId: string, files: ThemeFile[], meta: { label: string; createdBy: string; operationId?: string }): Promise<SnapshotRecord>;
  createResourceSnapshot(shopId: string, resources: Array<{ id: string; type: string; body: unknown }>, meta: { label: string; createdBy: string; operationId?: string }): Promise<SnapshotRecord>;
  get(snapshotId: string): Promise<SnapshotRecord | null>;
  list(shopId: string, opts?: { kind?: SnapshotRecord["kind"]; limit?: number }): Promise<SnapshotRecord[]>;
  readThemeFiles(snapshotId: string, keys?: string[]): Promise<ThemeFile[]>;
  readResources(snapshotId: string): Promise<Array<{ id: string; type: string; body: unknown }>>;
  delete(snapshotId: string): Promise<void>;
}

// ---------- Entitlement ----------
export interface EntitlementProvider {
  getState(shopId: string): Promise<{ state: EntitlementState; plan?: string; entitlements: Entitlement[]; seats?: { shops: number; members: number }; upgradeUrl: string; graceUntil?: string }>;
  has(shopId: string, e: Entitlement): Promise<boolean>;
}

// ---------- Store capability probes ----------
export interface CapabilityService {
  get(shopId: string): Promise<Set<StoreCapability>>;
  refresh(shopId: string): Promise<Set<StoreCapability>>;
}

// ---------- Approval tokens ----------
export interface ApprovalService {
  issue(input: { shopId: string; credentialId: string; tool: string; planHash: string; ttlMs?: number; issuedBy: string }): Promise<{ token: string; expiresAt: string }>;
  consume(input: { token: string; shopId: string; tool: string; planHash: string }): Promise<{ ok: true; approvedBy: string } | { ok: false; reason: "invalid" | "expired" | "consumed" | "mismatch" }>;
}

// ---------- Jobs ----------
export type JobStatus = "queued" | "planning" | "running" | "waiting_approval" | "verifying" | "completed" | "failed" | "cancelled";
export interface JobRecord {
  jobId: string;
  shopId: string;
  tool: string;
  status: JobStatus;
  stage?: string;
  progress: number; // 0..1
  stages: Array<{ name: string; status: "pending" | "running" | "done" | "failed" | "skipped"; startedAt?: string; finishedAt?: string; note?: string }>;
  artifacts: Array<{ label: string; uri: string; mimeType?: string }>;
  warnings: string[];
  errors: string[];
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface JobEngine {
  enqueue(input: { shopId: string; tool: string; credential: Credential; input: unknown }): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | null>;
  cancel(jobId: string): Promise<JobRecord | null>;
}

// ---------- Aggregate context handed to handlers ----------
export interface Clock {
  now(): Date;
}
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface ToolContext {
  credential: Credential;
  shop: ShopSummary;
  operationId: string;
  era: "modern" | "legacy" | "internal";
  admin?: AdminClient;
  theme?: ThemeEngine;
  browser?: BrowserPlane;
  ledger: Ledger;
  snapshots: SnapshotStore;
  entitlements: EntitlementProvider;
  capabilities: Set<StoreCapability>;
  approvals: ApprovalService;
  jobs?: JobEngine;
  clock: Clock;
  log: Logger;
  /** Working-theme resolver; implemented by shopify-theme package. */
  workingTheme?: { ensure(): Promise<ThemeRef>; current(): Promise<ThemeRef | null>; live(): Promise<ThemeRef> };
  /** Free-form services registry for packages to expose helpers without cycles. */
  services: Map<string, unknown>;
}
