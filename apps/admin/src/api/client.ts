import { getDemoShop, getSessionToken, isEmbedded, invalidateSessionToken } from "../lib/appBridge";
import * as fixtures from "./demo-fixtures";
import type {
  AppsResponse,
  ApprovalResponse,
  ClientConfigs,
  ClientCredential,
  ConnectResponse,
  ConnectionsResponse,
  CreateTokenRequest,
  CreateTokenResponse,
  DesignManifestDetail,
  DesignManifestsResponse,
  DesignManifestValidationResponse,
  AntiGenericAuditResponse,
  DiagnosticsResponse,
  EntitlementResponse,
  JobDetailResponse,
  JobsResponse,
  MemoriesResponse,
  MemoryRecord,
  MemorySettingsResponse,
  MemoryType,
  MemoryVersionsResponse,
  MemoryWriteRequest,
  OperationDetailResponse,
  OperationsResponse,
  PolicyProfilesResponse,
  PrivacyResponse,
  Profile,
  SessionResponse,
  SkillDetail,
  SkillItem,
  SkillsResponse,
  SkillWriteRequest,
  SnapshotsResponse,
  ThemeAccessResponse,
  ThemeResponse,
  ToolCard,
  ToolsResponse,
} from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(opts: { code: string; message: string; status: number }) {
    super(opts.message);
    this.code = opts.code;
    this.status = opts.status;
  }
}

const IS_MOCK = import.meta.env.VITE_CP_MOCK === "1";

/** Registered by the app shell so any client call can surface a toast on error. */
let globalErrorHandler: ((err: ApiError) => void) | undefined;
export function setGlobalErrorHandler(handler: (err: ApiError) => void): void {
  globalErrorHandler = handler;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (isEmbedded()) {
    const token = await getSessionToken();
    if (token) return { Authorization: `Bearer ${token}` };
  }
  const demoShop = getDemoShop();
  if (demoShop) return { "X-CP-Demo-Shop": demoShop };
  return {};
}

async function request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  try {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        ...(init?.headers ?? {}),
      },
    });
    // Session tokens live ~60s. A 401 on an embedded request almost always means the
    // token we sent was stale (URL id_token after a long idle, or a cached promise), so
    // mint a fresh one from App Bridge and retry once before surfacing "Not authenticated".
    if (res.status === 401 && attempt === 0 && isEmbedded()) {
      invalidateSessionToken();
      return request<T>(path, init, 1);
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok || body?.ok === false) {
      const err = new ApiError({
        code: body?.code ?? "UNKNOWN",
        message: body?.message ?? res.statusText ?? "Request failed",
        status: res.status,
      });
      globalErrorHandler?.(err);
      throw err;
    }
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const err = new ApiError({ code: "NETWORK", message: e instanceof Error ? e.message : "Network error", status: 0 });
    globalErrorHandler?.(err);
    throw err;
  }
}

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// ---------- Session ----------
export function getSession(): Promise<SessionResponse> {
  if (IS_MOCK) return delay(fixtures.demoSession);
  return request<SessionResponse>("/session");
}

// ---------- Connect ----------
export function getConnect(): Promise<ConnectResponse> {
  if (IS_MOCK) return delay(fixtures.demoConnect);
  return request<ConnectResponse>("/connect");
}

export function createToken(body: CreateTokenRequest): Promise<CreateTokenResponse> {
  if (IS_MOCK) {
    const token = `cp_live_${Math.random().toString(36).slice(2, 10)}`;
    const credential: ClientCredential = {
      credentialId: `cred_${Date.now()}`,
      kind: "token",
      label: body.label,
      profile: body.profile,
      policy: body.policy ?? {},
      scopes: ["read_products", "write_products", "read_themes", "write_themes"],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    };
    return delay({ token, credential, clientConfigs: fixtures.demoCreateTokenConfigs(token) });
  }
  return request<CreateTokenResponse>("/tokens", { method: "POST", body: JSON.stringify(body) });
}

export function revokeToken(credentialId: string): Promise<{ ok: true }> {
  if (IS_MOCK) return delay({ ok: true });
  return request<{ ok: true }>(`/tokens/${credentialId}`, { method: "DELETE" });
}

export function updateCredential(
  credentialId: string,
  patch: { profile?: Profile; policy?: Record<string, boolean | number | string>; label?: string },
): Promise<{ credential: ClientCredential }> {
  if (IS_MOCK) {
    const existing = fixtures.demoTokens.find((t) => t.credentialId === credentialId) ?? fixtures.demoTokens[0];
    return delay({ credential: { ...existing, ...patch, policy: { ...existing?.policy, ...patch.policy } } as ClientCredential });
  }
  return request<{ credential: ClientCredential }>(`/credentials/${credentialId}`, { method: "PUT", body: JSON.stringify(patch) });
}

// ---------- Theme Access ----------
export function getThemeAccess(): Promise<ThemeAccessResponse> {
  if (IS_MOCK) return delay(fixtures.demoThemeAccess);
  return request<ThemeAccessResponse>("/theme-access");
}

export function setThemeAccess(password: string): Promise<{ configured: true; last4: string }> {
  if (IS_MOCK) return delay({ configured: true, last4: password.slice(-4) });
  return request<{ configured: true; last4: string }>("/theme-access", { method: "PUT", body: JSON.stringify({ password }) });
}

export function removeThemeAccess(): Promise<{ ok: true }> {
  if (IS_MOCK) return delay({ ok: true });
  return request<{ ok: true }>("/theme-access", { method: "DELETE" });
}

// ---------- Tools ----------
export function getTools(profile?: Profile): Promise<ToolsResponse> {
  if (IS_MOCK) return delay(fixtures.demoTools);
  const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return request<ToolsResponse>(`/tools${qs}`);
}

export function setToolEnabled(name: string, enabled: boolean): Promise<{ ok: true }> {
  if (IS_MOCK) return delay({ ok: true });
  return request<{ ok: true }>(`/tools/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function getPolicyProfiles(): Promise<PolicyProfilesResponse> {
  if (IS_MOCK) return delay(fixtures.demoPolicyProfiles);
  return request<PolicyProfilesResponse>("/policy/profiles");
}

// ---------- Ledger ----------
export function getOperations(opts?: { cursor?: string; limit?: number; tool?: string; status?: string }): Promise<OperationsResponse> {
  if (IS_MOCK) return delay(fixtures.demoOperations);
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.tool) params.set("tool", opts.tool);
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  return request<OperationsResponse>(`/operations${qs ? `?${qs}` : ""}`);
}

export function getOperation(id: string): Promise<OperationDetailResponse> {
  if (IS_MOCK) {
    const detail = fixtures.demoOperationDetails[id];
    if (!detail) return Promise.reject(new ApiError({ code: "NOT_FOUND", message: "Operation not found", status: 404 }));
    return delay(detail);
  }
  return request<OperationDetailResponse>(`/operations/${id}`);
}

export function rollbackOperation(id: string, opts?: { force?: boolean }): Promise<{ operation: OperationsResponse["items"][number] }> {
  if (IS_MOCK) {
    const detail = fixtures.demoOperationDetails[id];
    const base = detail?.operation ?? fixtures.demoOperations.items[0]!;
    return delay({ operation: { ...base, status: "rolled_back" as const } });
  }
  return request(`/operations/${id}/rollback`, { method: "POST", body: JSON.stringify({ confirm: true, force: opts?.force }) });
}

// ---------- Snapshots ----------
export function getSnapshots(kind?: string): Promise<SnapshotsResponse> {
  if (IS_MOCK) return delay(fixtures.demoSnapshots);
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return request<SnapshotsResponse>(`/snapshots${qs}`);
}

export function createSnapshot(body: { label?: string; themeId?: string }): Promise<{ snapshot: SnapshotsResponse["items"][number] }> {
  if (IS_MOCK) {
    const snapshot = {
      snapshotId: `snap_${Date.now()}`,
      shopId: "shop_demo",
      kind: "theme" as const,
      label: body.label ?? "Manual snapshot",
      themeId: body.themeId,
      fileCount: 0,
      bytes: 0,
      createdAt: new Date().toISOString(),
      createdBy: "admin_ui",
    };
    return delay({ snapshot });
  }
  return request(`/snapshots`, { method: "POST", body: JSON.stringify(body) });
}

// ---------- Theme ----------
export function getTheme(): Promise<ThemeResponse> {
  if (IS_MOCK) return delay(fixtures.demoTheme);
  return request<ThemeResponse>("/theme");
}

export function ensureWorkingTheme(): Promise<{ working: ThemeResponse["working"] }> {
  if (IS_MOCK) return delay({ working: fixtures.demoTheme.working });
  return request(`/theme/working/ensure`, { method: "POST" });
}

export function publishTheme(themeId: string): Promise<{ operation: OperationsResponse["items"][number] }> {
  if (IS_MOCK) return delay({ operation: { ...fixtures.demoOperations.items[1]!, status: "succeeded" as const } });
  return request(`/theme/publish`, { method: "POST", body: JSON.stringify({ themeId, confirm: true }) });
}

// ---------- Approvals ----------
export function createApproval(tool: string, input: Record<string, unknown>): Promise<ApprovalResponse> {
  if (IS_MOCK) return delay({ token: `appr_${Date.now()}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), planHash: "sha256:demo" });
  return request<ApprovalResponse>(`/approvals`, { method: "POST", body: JSON.stringify({ tool, input }) });
}

// ---------- Apps ----------
export function getApps(): Promise<AppsResponse> {
  if (IS_MOCK) return delay(fixtures.demoApps);
  return request<AppsResponse>("/apps");
}

// ---------- Diagnostics ----------
export function getDiagnostics(): Promise<DiagnosticsResponse> {
  if (IS_MOCK) return delay(fixtures.demoDiagnostics);
  return request<DiagnosticsResponse>("/diagnostics");
}

// ---------- Privacy ----------
export function getPrivacy(): Promise<PrivacyResponse> {
  if (IS_MOCK) return delay(fixtures.demoPrivacy);
  return request<PrivacyResponse>("/privacy");
}

export function setPrivacy(body: PrivacyResponse): Promise<PrivacyResponse> {
  if (IS_MOCK) return delay(body);
  return request<PrivacyResponse>("/privacy", { method: "PUT", body: JSON.stringify(body) });
}

// ---------- Skills ----------
export function getSkills(): Promise<SkillsResponse> {
  if (IS_MOCK) return delay(fixtures.demoSkills);
  return request<SkillsResponse>("/skills");
}

export function getSkill(name: string): Promise<{ skill: SkillDetail }> {
  if (IS_MOCK) {
    const item = fixtures.demoSkills.skills.find((s) => s.name === name);
    if (!item) return Promise.reject(new ApiError({ code: "NOT_FOUND", message: "Skill not found", status: 404 }));
    return delay({ skill: { ...item, body: fixtures.demoSkillBodies[name] ?? "" } });
  }
  return request<{ skill: SkillDetail }>(`/skills/${encodeURIComponent(name)}`);
}

export function createSkill(body: SkillWriteRequest): Promise<{ skill: SkillDetail }> {
  if (IS_MOCK) return delay({ skill: { ...body, tier: body.tier ?? "free", source: "custom", enabled: true, updatedAt: new Date().toISOString() } });
  return request<{ skill: SkillDetail }>("/skills", { method: "POST", body: JSON.stringify(body) });
}

export function updateSkill(name: string, body: Omit<SkillWriteRequest, "name">): Promise<{ skill: SkillDetail }> {
  if (IS_MOCK) return delay({ skill: { ...body, name, tier: body.tier ?? "free", source: "custom", enabled: true, updatedAt: new Date().toISOString() } });
  return request<{ skill: SkillDetail }>(`/skills/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteSkill(name: string): Promise<{ ok: true }> {
  if (IS_MOCK) return delay({ ok: true });
  return request<{ ok: true }>(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function setSkillEnabled(name: string, enabled: boolean): Promise<{ skill: SkillItem }> {
  if (IS_MOCK) {
    const item = fixtures.demoSkills.skills.find((s) => s.name === name);
    return delay({ skill: { ...(item as SkillItem), enabled } });
  }
  return request<{ skill: SkillItem }>(`/skills/${encodeURIComponent(name)}/enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

// ---------- Design manifests ----------
export function getDesignManifests(): Promise<DesignManifestsResponse> {
  if (IS_MOCK) return delay({ manifests: [] });
  return request<DesignManifestsResponse>("/design/manifests");
}

export function getDesignManifest(id: string): Promise<DesignManifestDetail | Record<string, never>> {
  if (IS_MOCK) return delay({});
  return request(`/design/manifests/${encodeURIComponent(id)}`);
}

export function getActiveDesignManifest(): Promise<DesignManifestDetail | Record<string, never>> {
  if (IS_MOCK) return delay({});
  return request(`/design/manifests/active`);
}

export function extractDesignManifest(themeId?: string): Promise<{ manifest: Record<string, unknown>; record: DesignManifestDetail }> {
  if (IS_MOCK) return Promise.reject(new ApiError({ code: "UNAVAILABLE", message: "Not available in demo mode", status: 400 }));
  return request(`/design/manifests/extract`, { method: "POST", body: JSON.stringify({ themeId }) });
}

export function createDesignManifest(name: string, manifest: Record<string, unknown>): Promise<DesignManifestDetail> {
  return request(`/design/manifests`, { method: "POST", body: JSON.stringify({ name, manifest }) });
}

export function activateDesignManifest(id: string): Promise<DesignManifestDetail> {
  return request(`/design/manifests/${encodeURIComponent(id)}/activate`, { method: "POST" });
}

export function validateDesignManifest(manifest: Record<string, unknown>): Promise<DesignManifestValidationResponse> {
  return request(`/design/manifests/validate`, { method: "POST", body: JSON.stringify({ manifest }) });
}

export function runAntiGenericAudit(themeId?: string): Promise<AntiGenericAuditResponse> {
  if (IS_MOCK) return Promise.reject(new ApiError({ code: "UNAVAILABLE", message: "Not available in demo mode", status: 400 }));
  return request(`/design/anti-generic`, { method: "POST", body: JSON.stringify({ themeId }) });
}

export async function exportDesignMarkdown(manifestId: string): Promise<{ manifestId: string; name: string; markdown: string }> {
  if (IS_MOCK) return delay({ manifestId, name: "Demo direction", markdown: "# Design: Demo direction\n\n## Color\n- primary: #111111\n" });
  return request(`/design/manifests/${encodeURIComponent(manifestId)}/markdown`);
}

export async function importDesignMarkdown(body: { markdown: string; name?: string; activate?: boolean }): Promise<{ manifestId: string | null; name: string; written: boolean }> {
  if (IS_MOCK) return delay({ manifestId: `dm_${Date.now()}`, name: body.name ?? "Imported", written: true });
  return request(`/design/manifests/import`, { method: "POST", body: JSON.stringify(body) });
}

// ---------- Entitlement (Freemius) ----------
export function getEntitlement(): Promise<EntitlementResponse> {
  if (IS_MOCK) {
    return delay({
      state: "FREE",
      plan: "free",
      entitlements: ["free.core", "free.theme", "free.catalog", "free.seo_basic", "free.visual_capture"],
      upgradeUrl: "https://shopmanagerai.com/upgrade",
      activationUrl: "https://shopmanagerai.com/activate",
    });
  }
  return request<EntitlementResponse>("/entitlement");
}

export function activateLicense(licenseKey: string): Promise<{ ok: boolean; state?: string; plan?: string; message?: string }> {
  if (IS_MOCK) return delay({ ok: true, state: "PRO_ACTIVE", plan: "pro" });
  return request(`/entitlement/activate`, { method: "POST", body: JSON.stringify({ licenseKey }) });
}

export function deactivateLicense(): Promise<{ ok: true }> {
  if (IS_MOCK) return delay({ ok: true });
  return request(`/entitlement/deactivate`, { method: "POST" });
}

// ---------- Store orchestration jobs / reports ----------
export function getJobs(): Promise<JobsResponse> {
  if (IS_MOCK) return delay({ jobs: [] });
  return request<JobsResponse>("/jobs");
}

export function getJob(jobId: string): Promise<JobDetailResponse> {
  if (IS_MOCK) return Promise.reject(new ApiError({ code: "NOT_FOUND", message: "Not available in demo mode", status: 404 }));
  return request<JobDetailResponse>(`/jobs/${encodeURIComponent(jobId)}`);
}

/** Report export can return Markdown (text) or JSON depending on `format`, so it bypasses `request<T>`'s JSON-only parsing. */
export async function exportReport(jobId: string, format: "json" | "markdown" = "json"): Promise<string | Record<string, unknown>> {
  if (IS_MOCK) return Promise.reject(new ApiError({ code: "NOT_FOUND", message: "Not available in demo mode", status: 404 }));
  const headers = await authHeaders();
  const res = await fetch(`/api/admin/reports/${encodeURIComponent(jobId)}/export?format=${format}`, { headers });
  if (!res.ok) {
    const err = new ApiError({ code: "REQUEST_FAILED", message: `Export failed (${res.status})`, status: res.status });
    globalErrorHandler?.(err);
    throw err;
  }
  return format === "markdown" ? res.text() : res.json();
}

// ---------- Connections (the original WordPress plugin includes/connections.php port) ----------
export function getConnections(): Promise<ConnectionsResponse> {
  if (IS_MOCK) return delay(fixtures.demoConnections);
  return request<ConnectionsResponse>("/connections");
}

export function forgetConnection(id: string): Promise<{ ok: true }> {
  if (IS_MOCK) return delay({ ok: true });
  return request<{ ok: true }>(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function forgetStaleConnections(): Promise<{ removed: number }> {
  if (IS_MOCK) return delay({ removed: 0 });
  return request<{ removed: number }>("/connections/forget-stale", { method: "POST" });
}

// ---------- Memory (the original Pro plugin original-plugin-memory port) ----------
export function getMemories(type?: MemoryType): Promise<MemoriesResponse> {
  if (IS_MOCK) return delay(type ? { memories: fixtures.demoMemories.memories.filter((m) => m.type === type) } : fixtures.demoMemories);
  const qs = type ? `?type=${encodeURIComponent(type)}` : "";
  return request<MemoriesResponse>(`/memory${qs}`);
}

export function createMemory(body: MemoryWriteRequest): Promise<{ memory: MemoryRecord }> {
  if (IS_MOCK) {
    const now = new Date().toISOString();
    return delay({ memory: { id: `mem_${Date.now()}`, ...body, enabled: true, createdBy: "admin_ui", createdAt: now, updatedAt: now, version: 1 } });
  }
  return request<{ memory: MemoryRecord }>("/memory", { method: "POST", body: JSON.stringify(body) });
}

export function updateMemory(id: string, body: MemoryWriteRequest): Promise<{ memory: MemoryRecord }> {
  if (IS_MOCK) {
    const existing = fixtures.demoMemories.memories.find((m) => m.id === id);
    const now = new Date().toISOString();
    return delay({ memory: { ...(existing as MemoryRecord), ...body, updatedAt: now, version: (existing?.version ?? 0) + 1 } });
  }
  return request<{ memory: MemoryRecord }>(`/memory/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteMemory(id: string): Promise<{ ok: boolean }> {
  if (IS_MOCK) return delay({ ok: true });
  return request<{ ok: boolean }>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getMemoryVersions(id: string): Promise<MemoryVersionsResponse> {
  if (IS_MOCK) return delay(fixtures.demoMemoryVersions[id] ?? { versions: [] });
  return request<MemoryVersionsResponse>(`/memory/${encodeURIComponent(id)}/versions`);
}

export function restoreMemory(id: string, version: number): Promise<{ memory: MemoryRecord }> {
  if (IS_MOCK) {
    const existing = fixtures.demoMemories.memories.find((m) => m.id === id);
    return delay({ memory: { ...(existing as MemoryRecord), version: (existing?.version ?? 0) + 1 } });
  }
  return request<{ memory: MemoryRecord }>(`/memory/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ version }) });
}

export function getMemorySettings(): Promise<MemorySettingsResponse> {
  if (IS_MOCK) return delay({ enabled: true });
  return request<MemorySettingsResponse>("/memory/settings");
}

export function setMemorySettings(enabled: boolean): Promise<MemorySettingsResponse> {
  if (IS_MOCK) return delay({ enabled });
  return request<MemorySettingsResponse>("/memory/settings", { method: "PUT", body: JSON.stringify({ enabled }) });
}

export type { ClientConfigs, ToolCard };
