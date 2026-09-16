/**
 * In-memory test doubles for everything a ToolContext needs, plus
 * `makeTestContext` which assembles a full context around a FakeThemeEngine
 * seeded with `seedDawnLike()`. Used by this package's own tests and
 * available for the server/other packages' tests too.
 */
import { newId } from "@shopmanagerai/shared";
import type {
  ApprovalService,
  BrowserPlane,
  Credential,
  DesignManifest,
  Entitlement,
  EntitlementProvider,
  EntitlementState,
  Ledger,
  OperationRecord,
  Profile,
  ShopSummary,
  SnapshotRecord,
  SnapshotStore,
  StoreCapability,
  ThemeEngine,
  ThemeFile,
  ThemeRef,
  ToolContext,
} from "@shopmanagerai/shared";
import { FakeThemeEngine, seedDawnLike, WorkingThemeService } from "@shopmanagerai/shopify-theme";
/** Screenshot tools are Pro; this build has no browser plane to fake. */
class FakeBrowserPlane {
  async capture(): Promise<never> {
    throw new Error("Visual capture is not available in the open-source build.");
  }
}
import { ToolRegistry } from "@shopmanagerai/tool-registry";
import { createRegistry } from "../index.js";
import {
  CONNECTIONS_SERVICE_KEY,
  DESIGN_MANIFESTS_SERVICE_KEY,
  KV_SERVICE_KEY,
  MEMORY_SERVICE_KEY,
  REGISTRY_SERVICE_KEY,
  ROLLBACK_SERVICE_KEY,
  SKILLS_SERVICE_KEY,
  VISUAL_AUDIT_SERVICE_KEY,
  type ConnectionRecord,
  type ConnectionsService,
  type DesignManifestRecord,
  type DesignManifestService,
  type KvService,
  type MemoryRecord,
  type MemoryService,
  type MemoryType,
  type MemoryVersionRecord,
  type RollbackExecuteResult,
  type RollbackPlan,
  type RollbackService,
  type SkillRecord,
  type SkillsService,
  type VisualAuditService,
  type VisualAuditSession,
  type VisualIssueRecord,
} from "../services.js";

// ---------------------------------------------------------------------------
// InMemoryLedger
// ---------------------------------------------------------------------------
export class InMemoryLedger implements Ledger {
  private readonly records = new Map<string, OperationRecord>();

  async begin(rec: Omit<OperationRecord, "status" | "startedAt">): Promise<OperationRecord> {
    const full: OperationRecord = { ...rec, status: "pending", startedAt: new Date().toISOString() };
    this.records.set(full.operationId, full);
    return full;
  }

  async finish(operationId: string, patch: Partial<OperationRecord>): Promise<OperationRecord> {
    const existing = this.records.get(operationId);
    const base: OperationRecord =
      existing ??
      ({
        operationId,
        shopId: patch.shopId ?? "",
        credentialId: patch.credentialId ?? "",
        credentialLabel: patch.credentialLabel ?? "",
        tool: patch.tool ?? "",
        tier: patch.tier ?? "free",
        risk: patch.risk ?? "read",
        status: "pending",
        inputsHash: patch.inputsHash ?? "",
        inputsRedacted: patch.inputsRedacted ?? {},
        resources: patch.resources ?? [],
        changes: patch.changes ?? [],
        evidence: patch.evidence ?? [],
        warnings: patch.warnings ?? [],
        rollback: patch.rollback ?? { available: false, strategy: "none" },
        startedAt: new Date().toISOString(),
      } as OperationRecord);
    const merged: OperationRecord = { ...base, ...patch };
    this.records.set(operationId, merged);
    return merged;
  }

  async get(operationId: string): Promise<OperationRecord | null> {
    return this.records.get(operationId) ?? null;
  }

  async list(shopId: string, opts?: { limit?: number; cursor?: string; tool?: string; status?: OperationRecord["status"] }): Promise<{ items: OperationRecord[]; nextCursor?: string }> {
    let items = Array.from(this.records.values()).filter((r) => r.shopId === shopId);
    if (opts?.tool) items = items.filter((r) => r.tool === opts.tool);
    if (opts?.status) items = items.filter((r) => r.status === opts.status);
    items = items.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const limit = opts?.limit ?? 50;
    return { items: items.slice(0, limit) };
  }

  /** Test helper: directly record a completed operation (skips begin/finish lifecycle). */
  seed(rec: OperationRecord): void {
    this.records.set(rec.operationId, rec);
  }
}

// ---------------------------------------------------------------------------
// InMemorySnapshotStore
// ---------------------------------------------------------------------------
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly themeFiles = new Map<string, ThemeFile[]>();
  private readonly resources = new Map<string, Array<{ id: string; type: string; body: unknown }>>();

  async createThemeSnapshot(shopId: string, themeId: string, files: ThemeFile[], meta: { label: string; createdBy: string; operationId?: string }): Promise<SnapshotRecord> {
    const snapshotId = newId("snap");
    const record: SnapshotRecord = {
      snapshotId,
      shopId,
      kind: "theme",
      label: meta.label,
      themeId,
      fileCount: files.length,
      bytes: files.reduce((n, f) => n + (f.content?.length ?? f.contentBase64?.length ?? 0), 0),
      createdAt: new Date().toISOString(),
      createdBy: meta.createdBy,
      operationId: meta.operationId,
    };
    this.snapshots.set(snapshotId, record);
    this.themeFiles.set(snapshotId, files.map((f) => ({ ...f })));
    return record;
  }

  async createResourceSnapshot(shopId: string, resources: Array<{ id: string; type: string; body: unknown }>, meta: { label: string; createdBy: string; operationId?: string }): Promise<SnapshotRecord> {
    const snapshotId = newId("snap");
    const record: SnapshotRecord = {
      snapshotId,
      shopId,
      kind: "resource",
      label: meta.label,
      resourceIds: resources.map((r) => r.id),
      createdAt: new Date().toISOString(),
      createdBy: meta.createdBy,
      operationId: meta.operationId,
    };
    this.snapshots.set(snapshotId, record);
    this.resources.set(snapshotId, resources);
    return record;
  }

  async get(snapshotId: string): Promise<SnapshotRecord | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  async list(shopId: string, opts?: { kind?: SnapshotRecord["kind"]; limit?: number }): Promise<SnapshotRecord[]> {
    let items = Array.from(this.snapshots.values()).filter((s) => s.shopId === shopId);
    if (opts?.kind) items = items.filter((s) => s.kind === opts.kind);
    items = items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts?.limit ? items.slice(0, opts.limit) : items;
  }

  async readThemeFiles(snapshotId: string, keys?: string[]): Promise<ThemeFile[]> {
    const files = this.themeFiles.get(snapshotId) ?? [];
    if (!keys) return files;
    return files.filter((f) => keys.includes(f.key));
  }

  async readResources(snapshotId: string): Promise<Array<{ id: string; type: string; body: unknown }>> {
    return this.resources.get(snapshotId) ?? [];
  }

  async delete(snapshotId: string): Promise<void> {
    this.snapshots.delete(snapshotId);
    this.themeFiles.delete(snapshotId);
    this.resources.delete(snapshotId);
  }
}

// ---------------------------------------------------------------------------
// InMemoryApprovalService
// ---------------------------------------------------------------------------
interface StoredApproval {
  token: string;
  shopId: string;
  tool: string;
  planHash: string;
  expiresAt: number;
  consumed: boolean;
  issuedBy: string;
}

export class InMemoryApprovalService implements ApprovalService {
  private readonly tokens = new Map<string, StoredApproval>();

  async issue(input: { shopId: string; credentialId: string; tool: string; planHash: string; ttlMs?: number; issuedBy: string }): Promise<{ token: string; expiresAt: string }> {
    const token = newId("appr");
    const expiresAt = Date.now() + (input.ttlMs ?? 5 * 60 * 1000);
    this.tokens.set(token, { token, shopId: input.shopId, tool: input.tool, planHash: input.planHash, expiresAt, consumed: false, issuedBy: input.issuedBy });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async consume(input: { token: string; shopId: string; tool: string; planHash: string }): Promise<{ ok: true; approvedBy: string } | { ok: false; reason: "invalid" | "expired" | "consumed" | "mismatch" }> {
    const stored = this.tokens.get(input.token);
    if (!stored) return { ok: false, reason: "invalid" };
    if (stored.consumed) return { ok: false, reason: "consumed" };
    if (stored.expiresAt < Date.now()) return { ok: false, reason: "expired" };
    if (stored.shopId !== input.shopId || stored.tool !== input.tool || stored.planHash !== input.planHash) return { ok: false, reason: "mismatch" };
    stored.consumed = true;
    return { ok: true, approvedBy: stored.issuedBy };
  }
}

// ---------------------------------------------------------------------------
// NullEntitlementProvider, always FREE, no entitlements
// ---------------------------------------------------------------------------
export class NullEntitlementProvider implements EntitlementProvider {
  async getState(_shopId: string) {
    return {
      state: "FREE" as EntitlementState,
      plan: "free",
      entitlements: [] as Entitlement[],
      upgradeUrl: "https://shopmanagerai.com/upgrade",
    };
  }
  async has(_shopId: string, _e: Entitlement): Promise<boolean> {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Simple in-memory rollback service, restores from ledger before-images
// using the theme engine directly. Understands the `theme_file:<themeId>:<key>`
// resource convention.
// ---------------------------------------------------------------------------
export class InMemoryRollbackService implements RollbackService {
  constructor(private readonly ledger: InMemoryLedger, private readonly theme: ThemeEngine) {}

  async plan(operationId: string): Promise<RollbackPlan> {
    const record = await this.ledger.get(operationId);
    if (!record) {
      return { operationId, strategy: "none", steps: [], available: false, reason: "Operation not found." };
    }
    const steps = record.changes
      .filter((c) => c.resource.startsWith("theme_file:"))
      .map((c) => ({ resource: c.resource, kind: c.kind, description: `Restore ${c.resource} to its before-image (${c.kind}).` }));
    return { operationId, strategy: record.rollback.strategy, steps, available: steps.length > 0 || !!record.rollback.snapshotId };
  }

  async execute(operationId: string, _opts?: { force?: boolean }): Promise<RollbackExecuteResult> {
    const record = await this.ledger.get(operationId);
    if (!record) return { operationId, executed: false, restored: [], errors: [{ resource: "*", message: "Operation not found." }] };

    const restored: string[] = [];
    const errors: Array<{ resource: string; message: string }> = [];

    for (const change of record.changes) {
      if (!change.resource.startsWith("theme_file:")) continue;
      const [, themeId, ...rest] = change.resource.split(":");
      const key = rest.join(":");
      try {
        if (change.kind === "delete") {
          await this.theme.writeFiles(themeId as string, [{ key, content: typeof change.before === "string" ? change.before : undefined }]);
        } else if (change.before === undefined) {
          await this.theme.deleteFiles(themeId as string, [key]);
        } else {
          await this.theme.writeFiles(themeId as string, [{ key, content: typeof change.before === "string" ? change.before : undefined }]);
        }
        restored.push(change.resource);
      } catch (e) {
        errors.push({ resource: change.resource, message: e instanceof Error ? e.message : String(e) });
      }
    }

    return { operationId, executed: restored.length > 0, restored, errors };
  }
}

// ---------------------------------------------------------------------------
// InMemorySkillsService, keyed by shopId, holds custom/overridden skills.
// ---------------------------------------------------------------------------
export class InMemorySkillsService implements SkillsService {
  private readonly byShop = new Map<string, Map<string, SkillRecord>>();

  private bucket(shopId: string): Map<string, SkillRecord> {
    let b = this.byShop.get(shopId);
    if (!b) {
      b = new Map();
      this.byShop.set(shopId, b);
    }
    return b;
  }

  async list(shopId: string): Promise<SkillRecord[]> {
    return Array.from(this.bucket(shopId).values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(shopId: string, name: string): Promise<SkillRecord | null> {
    return this.bucket(shopId).get(name) ?? null;
  }

  async upsert(shopId: string, input: { name: string; title: string; description: string; tier?: string; body: string }): Promise<SkillRecord> {
    const b = this.bucket(shopId);
    const existing = b.get(input.name);
    const record: SkillRecord = {
      name: input.name,
      title: input.title,
      description: input.description,
      tier: input.tier ?? existing?.tier ?? "free",
      body: input.body,
      source: existing?.source ?? "custom",
      enabled: existing?.enabled ?? true,
      updatedAt: new Date().toISOString(),
    };
    b.set(input.name, record);
    return record;
  }

  async delete(shopId: string, name: string): Promise<boolean> {
    return this.bucket(shopId).delete(name);
  }

  async setEnabled(shopId: string, name: string, enabled: boolean): Promise<SkillRecord | null> {
    const b = this.bucket(shopId);
    const existing = b.get(name);
    if (!existing) return null;
    const updated: SkillRecord = { ...existing, enabled, updatedAt: new Date().toISOString() };
    b.set(name, updated);
    return updated;
  }

  /** Test helper: seed a built-in skill directly (bypasses upsert's "custom" default). */
  seed(shopId: string, record: SkillRecord): void {
    this.bucket(shopId).set(record.name, record);
  }
}

// ---------------------------------------------------------------------------
// InMemoryKvService, a tiny namespaced key/value store fake.
// ---------------------------------------------------------------------------
export class InMemoryKvService implements KvService {
  private readonly store = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | null> {
    return (this.store.has(key) ? (this.store.get(key) as T) : null);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------------
// InMemoryConnectionsService, a small in-memory stand-in for the
// storage-backed ConnectionRepo (see @shopmanagerai/storage's ConnectionRepo).
// ---------------------------------------------------------------------------
export class InMemoryConnectionsService implements ConnectionsService {
  private readonly byShop = new Map<string, ConnectionRecord[]>();

  private bucket(shopId: string): ConnectionRecord[] {
    let b = this.byShop.get(shopId);
    if (!b) {
      b = [];
      this.byShop.set(shopId, b);
    }
    return b;
  }

  async list(shopId: string): Promise<ConnectionRecord[]> {
    return this.bucket(shopId).slice().sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  async forget(id: string): Promise<boolean> {
    for (const [, rows] of this.byShop) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) {
        rows.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  async forgetStale(_shopId: string): Promise<number> {
    return 0;
  }

  /** Test helper: seed a connection row directly. */
  seed(shopId: string, record: ConnectionRecord): void {
    this.bucket(shopId).push(record);
  }
}

// ---------------------------------------------------------------------------
// InMemoryMemoryService, a small in-memory stand-in for the storage-backed
// MemoryRepo (see @shopmanagerai/storage's MemoryRepo).
// ---------------------------------------------------------------------------
export class InMemoryMemoryService implements MemoryService {
  private readonly byShop = new Map<string, Map<string, MemoryRecord>>();
  private readonly versionsById = new Map<string, MemoryVersionRecord[]>();
  private readonly enabledByShop = new Map<string, boolean>();
  private seq = 0;

  private bucket(shopId: string): Map<string, MemoryRecord> {
    let b = this.byShop.get(shopId);
    if (!b) {
      b = new Map();
      this.byShop.set(shopId, b);
    }
    return b;
  }

  async list(shopId: string, type?: MemoryType): Promise<MemoryRecord[]> {
    const all = Array.from(this.bucket(shopId).values());
    return (type ? all.filter((m) => m.type === type) : all).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(shopId: string, idOrName: string): Promise<MemoryRecord | null> {
    const b = this.bucket(shopId);
    return b.get(idOrName) ?? Array.from(b.values()).find((m) => m.name === idOrName) ?? null;
  }

  async save(shopId: string, input: { id?: string; name: string; description: string; type: MemoryType; content: string; createdBy: string }): Promise<MemoryRecord> {
    const b = this.bucket(shopId);
    const existing = input.id ? b.get(input.id) : undefined;
    const now = new Date().toISOString();
    const id = existing?.id ?? input.id ?? `mem_test_${++this.seq}`;
    const record: MemoryRecord = {
      id,
      name: input.name,
      description: input.description,
      type: input.type,
      content: input.content,
      enabled: existing?.enabled ?? true,
      createdBy: existing?.createdBy ?? input.createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };
    b.set(id, record);
    const versions = this.versionsById.get(id) ?? [];
    versions.unshift({ version: record.version, name: record.name, description: record.description, type: record.type, content: record.content, savedBy: input.createdBy, savedAt: now });
    this.versionsById.set(id, versions);
    return record;
  }

  async delete(shopId: string, id: string): Promise<boolean> {
    this.versionsById.delete(id);
    return this.bucket(shopId).delete(id);
  }

  async versions(_shopId: string, id: string): Promise<MemoryVersionRecord[]> {
    return this.versionsById.get(id) ?? [];
  }

  async restore(shopId: string, id: string, version: number, restoredBy: string): Promise<MemoryRecord | null> {
    const target = (this.versionsById.get(id) ?? []).find((v) => v.version === version);
    if (!target) return null;
    return this.save(shopId, { id, name: target.name, description: target.description, type: target.type as MemoryType, content: target.content, createdBy: restoredBy });
  }

  async isEnabled(shopId: string): Promise<boolean> {
    return this.enabledByShop.get(shopId) ?? true;
  }

  async setEnabled(shopId: string, enabled: boolean): Promise<void> {
    this.enabledByShop.set(shopId, enabled);
  }
}

// ---------------------------------------------------------------------------
// InMemoryVisualAuditService, a small, process-local visual-audit-session
// store used by the Pro shopify.visual.* tools (issue/score/plan_repair/
// verify reference the most recent capture without re-capturing).
// ---------------------------------------------------------------------------
export class InMemoryVisualAuditService implements VisualAuditService {
  private readonly byId = new Map<string, VisualAuditSession>();

  async save(session: Omit<VisualAuditSession, "sessionId" | "createdAt">): Promise<VisualAuditSession> {
    const full: VisualAuditSession = { ...session, sessionId: newId("vaudit"), createdAt: new Date().toISOString() };
    this.byId.set(full.sessionId, full);
    return full;
  }

  async get(sessionId: string): Promise<VisualAuditSession | null> {
    return this.byId.get(sessionId) ?? null;
  }

  async latest(shopId: string): Promise<VisualAuditSession | null> {
    const forShop = [...this.byId.values()].filter((s) => s.shopId === shopId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return forShop[0] ?? null;
  }

  async findIssue(shopId: string, issueId: string): Promise<{ session: VisualAuditSession; issue: VisualIssueRecord } | null> {
    const forShop = [...this.byId.values()].filter((s) => s.shopId === shopId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const session of forShop) {
      const issue = session.issues.find((i) => i.id === issueId);
      if (issue) return { session, issue };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// makeTestContext
// ---------------------------------------------------------------------------
export interface MakeTestContextOptions {
  theme?: ThemeEngine;
  browser?: BrowserPlane;
  admin?: ToolContext["admin"];
  profile?: Profile;
  shop?: Partial<ShopSummary>;
  capabilities?: StoreCapability[];
  registry?: ToolRegistry;
  entitlements?: EntitlementProvider;
  designManifests?: DesignManifestService;
  skills?: SkillsService;
  kv?: KvService;
  visualAudits?: VisualAuditService;
  connections?: ConnectionsService;
  memory?: MemoryService;
}

export interface TestContextBundle {
  ctx: ToolContext;
  theme: ThemeEngine;
  seededTheme: ThemeRef;
  ledger: InMemoryLedger;
  snapshots: InMemorySnapshotStore;
  approvals: InMemoryApprovalService;
  registry: ToolRegistry;
}

export function makeTestContext(opts: MakeTestContextOptions = {}): TestContextBundle {
  let seededTheme: ThemeRef;
  let theme: ThemeEngine;
  if (opts.theme) {
    theme = opts.theme;
    seededTheme = { id: "1", name: "seeded", role: "main" };
  } else {
    const fake = new FakeThemeEngine();
    seededTheme = seedDawnLike(fake);
    theme = fake;
  }

  const ledger = new InMemoryLedger();
  const snapshots = new InMemorySnapshotStore();
  const approvals = new InMemoryApprovalService();
  const registry = opts.registry ?? createRegistry();

  const credential: Credential = {
    credentialId: "cred_test",
    shopId: "shop_test",
    shopDomain: "test-shop.myshopify.com",
    kind: "token",
    label: "Test credential",
    profile: opts.profile ?? "developer_full_access",
    policy: {},
    scopesGranted: ["read_themes", "write_themes", "read_products"],
  };

  const shop: ShopSummary = {
    shopId: "shop_test",
    domain: "test-shop.myshopify.com",
    name: "Test Shop",
    passwordProtected: false,
    ...opts.shop,
  };

  const capabilities = new Set<StoreCapability>(
    opts.capabilities ?? ["theme.read", "theme.write", "admin.read", ...(opts.browser ? (["browser.capture"] as StoreCapability[]) : [])],
  );

  const services = new Map<string, unknown>();
  services.set(REGISTRY_SERVICE_KEY, registry);
  services.set(ROLLBACK_SERVICE_KEY, new InMemoryRollbackService(ledger, theme));
  services.set(DESIGN_MANIFESTS_SERVICE_KEY, opts.designManifests ?? new InMemoryDesignManifestService());
  services.set(SKILLS_SERVICE_KEY, opts.skills ?? new InMemorySkillsService());
  services.set(KV_SERVICE_KEY, opts.kv ?? new InMemoryKvService());
  services.set(VISUAL_AUDIT_SERVICE_KEY, opts.visualAudits ?? new InMemoryVisualAuditService());
  services.set(CONNECTIONS_SERVICE_KEY, opts.connections ?? new InMemoryConnectionsService());
  services.set(MEMORY_SERVICE_KEY, opts.memory ?? new InMemoryMemoryService());

  const ctx: ToolContext = {
    credential,
    shop,
    operationId: newId("op"),
    era: "modern",
    admin: opts.admin,
    theme,
    browser: opts.browser,
    ledger,
    snapshots,
    entitlements: opts.entitlements ?? new NullEntitlementProvider(),
    capabilities,
    approvals,
    clock: { now: () => new Date() },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    workingTheme: new WorkingThemeService(theme),
    services,
  };

  return { ctx, theme, seededTheme, ledger, snapshots, approvals, registry };
}

// ---------------------------------------------------------------------------
// AllEntitlementsProvider. Every entitlement granted, PRO_ACTIVE (test helper
// for exercising Pro-gated tools without a real Freemius provider).
// ---------------------------------------------------------------------------
export class AllEntitlementsProvider implements EntitlementProvider {
  constructor(private readonly all: Entitlement[]) {}

  async getState(_shopId: string) {
    return {
      state: "PRO_ACTIVE" as EntitlementState,
      plan: "pro",
      entitlements: this.all,
      upgradeUrl: "https://shopmanagerai.com/upgrade",
    };
  }
  async has(_shopId: string, e: Entitlement): Promise<boolean> {
    return this.all.includes(e);
  }
}

// ---------------------------------------------------------------------------
// InMemoryDesignManifestService
// ---------------------------------------------------------------------------
export class InMemoryDesignManifestService implements DesignManifestService {
  private readonly byId = new Map<string, DesignManifestRecord>();

  async list(shopId: string): Promise<DesignManifestRecord[]> {
    return [...this.byId.values()].filter((r) => r.shopId === shopId).sort((a, b) => b.version - a.version);
  }

  async get(manifestId: string): Promise<DesignManifestRecord | null> {
    return this.byId.get(manifestId) ?? null;
  }

  async getActive(shopId: string): Promise<DesignManifestRecord | null> {
    return [...this.byId.values()].find((r) => r.shopId === shopId && r.isActive) ?? null;
  }

  async create(input: {
    shopId: string;
    name: string;
    manifest: DesignManifest;
    source: "extracted" | "authored";
    createdBy: string;
    activate?: boolean;
  }): Promise<DesignManifestRecord> {
    const existing = await this.list(input.shopId);
    const version = (existing[0]?.version ?? 0) + 1;
    if (input.activate) {
      for (const r of existing) r.isActive = false;
    }
    const record: DesignManifestRecord = {
      manifestId: newId("dm"),
      shopId: input.shopId,
      version,
      name: input.name,
      manifest: input.manifest,
      source: input.source,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      isActive: !!input.activate,
    };
    this.byId.set(record.manifestId, record);
    return record;
  }

  async setActive(shopId: string, manifestId: string): Promise<void> {
    for (const r of this.byId.values()) {
      if (r.shopId === shopId) r.isActive = r.manifestId === manifestId;
    }
  }

  async delete(manifestId: string): Promise<void> {
    this.byId.delete(manifestId);
  }
}
