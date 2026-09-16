/**
 * Static fixtures used only when VITE_CP_MOCK=1, so every screen renders
 * without a running server (`pnpm --filter @shopmanagerai/admin dev:mock`).
 */
import type {
  AppsResponse,
  ClientConfigs,
  ClientCredential,
  ConnectResponse,
  ConnectionsResponse,
  DiagnosticsResponse,
  MemoriesResponse,
  MemoryVersionsResponse,
  OperationDetailResponse,
  OperationsResponse,
  PolicyProfilesResponse,
  PrivacyResponse,
  SessionResponse,
  SkillsResponse,
  SnapshotsResponse,
  ThemeAccessResponse,
  ThemeResponse,
  ToolsResponse,
} from "./types";

const TOKEN_PLACEHOLDER = "<TOKEN>";

function clientConfigs(token: string): ClientConfigs {
  return {
    claudeCode: `claude mcp add shopmanager --transport http https://demo.myshopify.com/mcp --header "Authorization: Bearer ${token}"`,
    cursor: JSON.stringify({ mcpServers: { shopmanager: { url: "https://demo.myshopify.com/mcp", headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    codex: `[mcp_servers.shopmanager]\nurl = "https://demo.myshopify.com/mcp"\nheaders = { Authorization = "Bearer ${token}" }\n`,
    vscode: JSON.stringify({ servers: { shopmanager: { type: "http", url: "https://demo.myshopify.com/mcp", headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    generic: JSON.stringify({ url: "https://demo.myshopify.com/mcp", transport: "http", headers: { Authorization: `Bearer ${token}` } }, null, 2),
  };
}

export const demoTokens: ClientCredential[] = [
  {
    credentialId: "cred_1",
    kind: "token",
    label: "Claude Desktop",
    profile: "production_safe",
    policy: {},
    scopes: ["read_products", "write_products", "read_themes", "write_themes"],
    createdAt: "2026-08-01T00:00:00.000Z",
    lastUsedAt: "2026-09-14T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
  },
  {
    credentialId: "cred_2",
    kind: "token",
    label: "Dev laptop (Cursor)",
    profile: "developer_full_access",
    policy: { "bulk.maxResources": 200 },
    scopes: ["read_products", "write_products", "read_themes", "write_themes", "read_content"],
    createdAt: "2026-08-10T00:00:00.000Z",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  },
];

export const demoSession: SessionResponse = {
  shop: { domain: "demo.myshopify.com", name: "Demo Store", plan: "Shopify" },
  demo: true,
  entitlement: {
    state: "FREE",
    plan: "free",
    entitlements: ["free.core", "free.theme", "free.catalog", "free.seo_basic", "free.visual_capture"],
    upgradeUrl: "https://shopmanagerai.app/upgrade?shop=demo.myshopify.com",
    seats: { shops: 1, members: 1 },
  },
  version: "0.1.0",
};

export const demoConnect: ConnectResponse = {
  mcpUrl: "https://demo.myshopify.com/mcp",
  flatMcpUrl: "https://demo.myshopify.com/mcp/flat",
  oauth: {
    authorizeUrl: "https://demo.myshopify.com/oauth/authorize",
    metadataUrl: "https://demo.myshopify.com/.well-known/oauth-authorization-server",
    cimdSupported: true,
  },
  tokens: demoTokens,
  clientConfigs: clientConfigs(TOKEN_PLACEHOLDER),
};

export function demoCreateTokenConfigs(token: string): ClientConfigs {
  return clientConfigs(token);
}

export const demoThemeAccess: ThemeAccessResponse = {
  configured: true,
  last4: "8f2a",
  engineA: "ok",
  engineB: "unknown",
};

export const demoTools: ToolsResponse = {
  cards: [
    { name: "theme.list", description: "List themes on the store.", tier: "free", category: "theme", risk: "read", availability: "available" },
    { name: "theme.file.update", description: "Update a theme file on the working theme.", tier: "free", category: "theme_file", risk: "write", availability: "available" },
    { name: "theme.publish", description: "Publish the working theme live.", tier: "free", category: "theme", risk: "publish", availability: "available" },
    { name: "product.bulk.update", description: "Bulk-update products with checkpoint/resume.", tier: "pro", category: "product", risk: "bulk", availability: "pro_required", reason: "Bulk operations require Pro." },
    { name: "design.redesign", description: "AI-directed redesign within design-system constraints.", tier: "pro", category: "design", risk: "theme_write", availability: "pro_required", reason: "Design intelligence is a Pro feature." },
    { name: "seo.advanced.audit", description: "Cross-page SEO reasoning and regression protection.", tier: "pro", category: "seo", risk: "read", availability: "pro_required", reason: "Advanced SEO audits require Pro." },
    { name: "conflicts.doctor.fix", description: "Correlate and safely fix app conflicts.", tier: "pro", category: "conflicts", risk: "write", availability: "scope_missing", reason: "Missing write_themes scope." },
    { name: "visual.capture.page", description: "Capture a full-page screenshot matrix.", tier: "free", category: "visual", risk: "read", availability: "available" },
  ],
  disabled: [],
};

export const demoPolicyProfiles: PolicyProfilesResponse = {
  profiles: [
    { id: "read_only", label: "Read Only", description: "Read-only access; no mutations of any kind.", allowedRisks: ["read"] },
    { id: "production_safe", label: "Production Safe", description: "Everyday safe writes; confirms before destructive or publish actions.", allowedRisks: ["read", "write", "theme_write"] },
    { id: "developer_full_access", label: "Developer Full Access", description: "Full access for trusted developer tooling, including bulk operations.", allowedRisks: ["read", "write", "theme_write", "bulk", "commerce_sensitive"] },
    { id: "admin", label: "Admin", description: "Everything, including destructive, publish, and critical operations.", allowedRisks: ["read", "write", "theme_write", "bulk", "commerce_sensitive", "destructive", "publish", "critical"] },
  ],
  policyKeys: [
    { key: "product.price.write", type: "boolean", default: true, description: "Allow writing product prices." },
    { key: "bulk.maxResources", type: "number", default: 500, description: "Maximum resources touched by one bulk operation." },
    { key: "delete", type: "boolean", default: false, description: "Allow delete operations." },
    { key: "theme.publish", type: "boolean", default: false, description: "Allow publishing a theme live." },
  ],
};

export const demoOperations: OperationsResponse = {
  items: [
    {
      operationId: "op_1001",
      shopId: "shop_demo",
      credentialId: "cred_1",
      credentialLabel: "Claude Desktop",
      tool: "theme.file.update",
      tier: "free",
      risk: "write",
      status: "succeeded",
      inputsHash: "a1b2c3",
      inputsRedacted: { themeId: "123456", key: "sections/hero.liquid" },
      resources: ["theme_file:sections/hero.liquid"],
      changes: [
        {
          resource: "theme_file:sections/hero.liquid",
          kind: "update",
          diff: "--- a/sections/hero.liquid\n+++ b/sections/hero.liquid\n@@ -12,7 +12,7 @@\n-  <h1>{{ section.settings.title }}</h1>\n+  <h1 class=\"hero-title\">{{ section.settings.title }}</h1>\n",
          fingerprintBefore: "sha256:aaa",
          fingerprintAfter: "sha256:bbb",
        },
      ],
      evidence: [{ type: "text", label: "Applied change", value: "Added hero-title class." }],
      warnings: [],
      rollback: { available: true, strategy: "ledger_before_image" },
      startedAt: "2026-09-03T14:02:00Z",
      finishedAt: "2026-09-03T14:02:01Z",
      durationMs: 900,
    },
    {
      operationId: "op_1000",
      shopId: "shop_demo",
      credentialId: "cred_2",
      credentialLabel: "Dev laptop (Cursor)",
      tool: "theme.publish",
      tier: "free",
      risk: "publish",
      status: "succeeded",
      inputsHash: "d4e5f6",
      inputsRedacted: { themeId: "123456" },
      resources: ["theme:123456"],
      changes: [{ resource: "theme:123456", kind: "publish" }],
      evidence: [],
      warnings: ["Previous live theme was archived, not deleted."],
      rollback: { available: true, strategy: "republish_previous" },
      startedAt: "2026-09-02T09:15:00Z",
      finishedAt: "2026-09-02T09:15:04Z",
      durationMs: 4200,
    },
    {
      operationId: "op_999",
      shopId: "shop_demo",
      credentialId: "cred_1",
      credentialLabel: "Claude Desktop",
      tool: "product.price.update",
      tier: "free",
      risk: "write",
      status: "failed",
      inputsHash: "g7h8i9",
      inputsRedacted: { productId: "gid://shopify/Product/1" },
      resources: ["product:gid://shopify/Product/1"],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: false, strategy: "none" },
      error: { code: "POLICY_DENIED", message: "product.price.write is disabled by custom policy." },
      startedAt: "2026-09-01T11:00:00Z",
      finishedAt: "2026-09-01T11:00:00Z",
      durationMs: 120,
    },
  ],
};

export const demoOperationDetails: Record<string, OperationDetailResponse> = Object.fromEntries(
  demoOperations.items.map((operation) => [
    operation.operationId,
    {
      operation,
      rollbackPlan: operation.rollback.available
        ? {
            summary: `Restore ${operation.resources[0] ?? "the affected resource"} to its state before this operation.`,
            steps: ["Verify current fingerprint matches the after-image.", "Restore the before-image.", "Record a new ledger entry for the rollback."],
            irreversible: operation.risk === "publish" ? ["Storefront traffic served by the newly-live theme during the window cannot be replayed."] : undefined,
          }
        : undefined,
    },
  ]),
);

export const demoSnapshots: SnapshotsResponse = {
  items: [
    { snapshotId: "snap_1", shopId: "shop_demo", kind: "theme", label: "Before hero redesign", themeId: "123456", fileCount: 214, bytes: 1_540_000, createdAt: "2026-09-03T14:01:00Z", createdBy: "cred_1" },
    { snapshotId: "snap_2", shopId: "shop_demo", kind: "resource", label: "Baseline products", resourceIds: ["1", "2", "3"], createdAt: "2026-08-28T10:00:00Z", createdBy: "cred_2" },
  ],
};

export const demoTheme: ThemeResponse = {
  live: { id: "123456", name: "Dawn", role: "main", updatedAt: "2026-09-02T09:15:04Z" },
  working: { id: "123457", name: "Dawn (working copy)", role: "development", updatedAt: "2026-09-03T14:02:01Z" },
  previewUrl: "https://demo.myshopify.com?preview_theme_id=123457",
  diffSummary: { added: 2, removed: 0, changed: 5 },
};

export const demoApps: AppsResponse = {
  detected: [
    { name: "Judge.me Reviews", handle: "judgeme", category: "reviews", confidence: 0.96, integrationTypes: ["app_block", "script_tag"], locations: ["sections/main-product.liquid"] },
    { name: "Klaviyo", handle: "klaviyo", category: "marketing", confidence: 0.88, integrationTypes: ["app_embed", "script_tag"], locations: ["settings_data.json", "layout/theme.liquid"] },
  ],
  preservation: [
    { id: "pres_1", description: "Preserve Judge.me widget block on PDP.", resource: "sections/main-product.liquid" },
    { id: "pres_2", description: "Preserve Klaviyo embed in theme settings.", resource: "settings_data.json" },
  ],
};

export const demoDiagnostics: DiagnosticsResponse = {
  checks: [
    { id: "scopes", label: "Required scopes granted", status: "ok" },
    { id: "theme_access", label: "Theme Access token configured", status: "ok", detail: "Engine A verified via list-themes probe." },
    { id: "engine_b", label: "Engine B exemption", status: "warn", detail: "Exemption status unknown; contact Shopify Partner support to confirm." },
    { id: "working_theme", label: "Working theme reachable", status: "ok" },
    { id: "webhooks", label: "Mandatory webhooks registered", status: "ok" },
    { id: "rate_limits", label: "Admin API rate limit headroom", status: "ok" },
  ],
};

export const demoPrivacy: PrivacyResponse = {
  retainSnapshotsDays: 90,
  retainScreenshotsDays: 30,
  retainLedgerDays: 90,
  twinStoresContent: true,
  telemetry: true,
};

export const demoSkills: SkillsResponse = {
  skills: [
    { name: "audit_store", title: "Audit my store", description: "Run a prioritised health audit across theme, SEO, accessibility, and performance.", tier: "free", source: "builtin", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z" },
    { name: "fix_theme_check", title: "Fix Theme Check issues", description: "Review and safely fix Theme Check findings on the working theme.", tier: "free", source: "builtin", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z" },
    { name: "redesign_home", title: "Redesign the homepage", description: "Plan and build a homepage redesign inside your design system.", tier: "pro", source: "builtin", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z" },
  ],
};

export const demoSkillBodies: Record<string, string> = {
  audit_store: "Run shopify.theme.validate_structure, shopify.security.audit_basic, and shopify.performance.audit; summarize findings by severity.",
  fix_theme_check: "Run shopify.theme_check.run on the working theme, then fix each offense with shopify.theme.files.apply (dry run first).",
  redesign_home: "Inspect the current design tokens, propose a homepage layout, and build it as a duplicate theme.",
};

export const demoConnections: ConnectionsResponse = {
  connections: [
    {
      id: "conn_1",
      credentialId: "cred_1",
      credentialLabel: "Claude Code",
      kind: "token",
      clientKey: "claude-code",
      clientName: "Claude Code",
      clientVersion: "1.4.0",
      protocolVersion: "2026-07-28",
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: new Date(Date.now() - 2 * 60_000).toISOString(),
      requestCount: 214,
    },
    {
      id: "conn_2",
      credentialId: "cred_2",
      credentialLabel: "Cursor token",
      kind: "token",
      clientKey: "cursor",
      clientName: "Cursor",
      clientVersion: "0.9",
      protocolVersion: "2025-11-25",
      firstSeen: "2026-01-05T00:00:00.000Z",
      lastSeen: new Date(Date.now() - 60 * 60_000).toISOString(),
      requestCount: 38,
    },
  ],
};

export const demoMemories: MemoriesResponse = {
  memories: [
    {
      id: "mem_1",
      name: "User profile",
      description: "Who the user is",
      type: "user",
      content: "Senior engineer, prefers terse commit messages.",
      enabled: true,
      createdBy: "cred_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ],
};

export const demoMemoryVersions: Record<string, MemoryVersionsResponse> = {
  mem_1: { versions: [{ version: 1, name: "User profile", description: "Who the user is", type: "user", content: "Senior engineer, prefers terse commit messages.", savedBy: "cred_1", savedAt: "2026-01-01T00:00:00.000Z" }] },
};
