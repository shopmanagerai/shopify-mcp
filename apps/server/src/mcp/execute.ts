/**
 * Execution pipeline (task brief §8): resolve -> validate -> policy -> ledger
 * begin -> handler -> ledger finish -> envelope.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  ShopManagerAIError,
  ERROR_CODES,
  newId,
  redactValue,
  toShopManagerAIError,
  type Credential,
  type Entitlement,
  type EntitlementState,
  type ShopSummary,
  type Tier,
  type ToolContext,
  type ToolFailure,
  type ToolResult,
} from "@shopmanagerai/shared";
import { evaluate, planHash as computePlanHash } from "@shopmanagerai/policy-engine";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import type { ToolDefinition } from "@shopmanagerai/shared";
import type { Container } from "../container.js";
import type { ShopPlanes } from "../shops/service.js";
import { recordToolTelemetry } from "../telemetry.js";
import { KvVisualAuditService } from "../visual-audits.js";

export interface McpRequestCtx {
  credential: Credential;
  shop: ShopSummary;
  planes: ShopPlanes;
  tier: Tier;
  entitlements: Set<Entitlement>;
  entitlementState: EntitlementState;
  upgradeUrl: string;
  era: "modern" | "legacy";
}

function toolFailure(tool: string, code: keyof typeof ERROR_CODES, message: string, details?: Record<string, unknown>): ToolFailure {
  return {
    ok: false,
    tool,
    code: ERROR_CODES[code],
    message,
    retryable: false,
    risk: "read",
    suggestedActions: [],
    details,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function bulkCountOf(input: unknown): number | undefined {
  if (!input || typeof input !== "object") return undefined;
  const rec = input as Record<string, unknown>;
  if (typeof rec["maxResources"] === "number") return rec["maxResources"];
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) return value.length;
  }
  return undefined;
}

/**
 * Adapts the ledger RollbackService (which needs the request's ThemeEngine)
 * to the small interface @shopmanagerai/tools expects under services.rollback.
 */
function rollbackAdapter(container: Container, reqCtx: McpRequestCtx) {
  return {
    async plan(operationId: string) {
      const p = await container.rollback.plan(operationId);
      return {
        operationId,
        strategy: p.strategy,
        available: p.available,
        reason: p.warnings?.join("; ") || undefined,
        steps: p.steps.map((s) => ({ resource: s.resource, kind: s.action, description: s.note ?? "" })),
      };
    },
    async execute(operationId: string, opts?: { force?: boolean }) {
      const rec = await container.rollback.execute(operationId, {
        theme: reqCtx.planes.theme,
        admin: reqCtx.planes.admin,
        verifyFingerprints: true,
        force: opts?.force ?? false,
        executedBy: reqCtx.credential.label,
      });
      return {
        operationId: rec.operationId,
        executed: rec.status === "succeeded",
        restored: rec.changes.map((c) => c.resource),
        errors: rec.error ? [{ resource: "*", message: rec.error.message }] : [],
      };
    },
  };
}

export function buildToolContext(container: Container, reqCtx: McpRequestCtx, operationId: string): ToolContext {
  return {
    credential: reqCtx.credential,
    shop: reqCtx.shop,
    operationId,
    era: reqCtx.era,
    admin: reqCtx.planes.admin,
    theme: reqCtx.planes.theme,
    browser: reqCtx.planes.browser,
    ledger: container.ledger,
    snapshots: container.snapshots,
    entitlements: container.entitlements,
    capabilities: reqCtx.planes.capabilities,
    approvals: container.approvals,
    clock: { now: () => new Date() },
    log: container.log,
    workingTheme: reqCtx.planes.workingTheme,
    services: new Map<string, unknown>([
      ["registry", container.registry],
      ["apiVersion", container.apiVersion],
      ["rollback", rollbackAdapter(container, reqCtx)],
      [
        "executor",
        {
          // change.* façade: same pipeline as an MCP execute-tool call.
          execute: (name: string, input: unknown) => executeTool(container, reqCtx, name, input),
          validate: (name: string, input: unknown) => validateTool(container, reqCtx, name, input),
          describe: (name: string) => {
            const d = container.registry.get(name);
            return d ? { name: d.name, riskClass: d.riskClass, riskLevel: d.riskLevel ?? "SAFE_WRITE", supportsDryRun: d.supportsDryRun, rollback: d.rollback, approval: d.approval, tier: d.tier } : null;
          },
        },
      ],
      [
        "storefrontPassword",
        {
          set: (shopId: string, password: string) => container.secrets.set(shopId, "storefront_password", password),
          clear: (shopId: string) => container.secrets.delete(shopId, "storefront_password"),
          has: (shopId: string) => container.secrets.has(shopId, "storefront_password"),
        },
      ],
      [
        "credentials",
        {
          // @shopmanagerai/tools CredentialsService: list(shopId) → Credential[] (no secrets).
          list: async (shopId: string) =>
            (await container.credentials.listByShop(shopId))
              .filter((r) => !r.revokedAt)
              .map((r) => ({
                credentialId: r.credentialId,
                shopId: r.shopId,
                shopDomain: reqCtx.shop.domain,
                kind: r.kind,
                label: r.label,
                profile: r.profile,
                policy: r.policy,
                scopesGranted: r.scopes,
              })),
        },
      ],
      [
        "settings",
        {
          // @shopmanagerai/tools SettingsService over the shop row's settings_json.
          get: async (shopId: string) => (await container.shops.getById(shopId))?.settings ?? {},
          validate: async (_shopId: string, patch: Record<string, unknown>) => {
            const errors: string[] = [];
            const known = new Set(["disabledTools", "privacy", "themeAccessLast4", "profileDefaults"]);
            for (const k of Object.keys(patch)) if (!known.has(k)) errors.push(`Unknown setting "${k}".`);
            return { valid: errors.length === 0, errors };
          },
        },
      ],
      [
        "skills",
        {
          // @shopmanagerai/tools SkillsService over storage's SkillRepo.
          list: async (shopId: string) =>
            (await container.skillRepo.list(shopId)).map((r) => ({ name: r.name, title: r.title, description: r.description, tier: r.tier, body: r.body, source: r.source, enabled: r.enabled, updatedAt: r.updatedAt })),
          get: async (shopId: string, name: string) => {
            const r = await container.skillRepo.get(shopId, name);
            return r ? { name: r.name, title: r.title, description: r.description, tier: r.tier, body: r.body, source: r.source, enabled: r.enabled, updatedAt: r.updatedAt } : null;
          },
          upsert: async (shopId: string, input: { name: string; title: string; description: string; tier?: string; body: string }) => {
            const r = await container.skillRepo.upsert({ shopId, ...input, source: "custom" });
            return { name: r.name, title: r.title, description: r.description, tier: r.tier, body: r.body, source: r.source, enabled: r.enabled, updatedAt: r.updatedAt };
          },
          delete: async (shopId: string, name: string) => container.skillRepo.delete(shopId, name),
          setEnabled: async (shopId: string, name: string, enabled: boolean) => {
            const r = await container.skillRepo.setEnabled(shopId, name, enabled);
            return r ? { name: r.name, title: r.title, description: r.description, tier: r.tier, body: r.body, source: r.source, enabled: r.enabled, updatedAt: r.updatedAt } : null;
          },
        },
      ],
      ["designManifests", container.designManifestService],
      [
        "appInfo",
        {
          // @shopmanagerai/tools AppInfoService: what the webhook/diagnostics tools need to know about this app.
          appUrl: container.config.appUrl,
          apiVersion: container.config.shopify.apiVersion,
          configuredScopes: container.config.shopify.scopes,
          expectedWebhookTopics: ["app/uninstalled", "app/scopes_update", "shop/update", "themes/publish", "themes/update", "customers/data_request", "customers/redact", "shop/redact"],
          signWebhookBody: (rawBody: string) => (container.config.shopify.clientSecret ? createHmac("sha256", container.config.shopify.clientSecret).update(rawBody, "utf8").digest("base64") : null),
          lastWebhookReceipt: async (shopId: string, topic: string) => container.kv.get<{ receivedAt: string; webhookId?: string }>(`webhook:last:${shopId}:${topic}`),
        },
      ],
      ["visualAudits", new KvVisualAuditService(container.kv)],
      [
        "kv",
        {
          // @shopmanagerai/tools KvService: a tiny namespaced key/value store (used by
          // Pro diagnostics tools, e.g. conflict-doctor's last-scan cache) over storage's KvRepo.
          get: async <T = unknown>(key: string) => container.kv.get<T>(key),
          set: async (key: string, value: unknown) => container.kv.set(key, value),
          delete: async (key: string) => container.kv.delete(key),
        },
      ],
      [
        "connections",
        {
          // @shopmanagerai/tools ConnectionsService over storage's ConnectionRepo.
          list: async (shopId: string) =>
            (await container.connections.list(shopId)).map((r) => ({
              id: r.id,
              credentialId: r.credentialId,
              credentialLabel: r.credentialLabel,
              kind: r.kind,
              clientKey: r.clientKey,
              clientName: r.clientName,
              clientVersion: r.clientVersion,
              protocolVersion: r.protocolVersion,
              firstSeen: r.firstSeen,
              lastSeen: r.lastSeen,
              requestCount: r.requestCount,
            })),
          forget: async (id: string) => container.connections.forget(id),
          forgetStale: async (shopId: string) => {
            const existingIds = new Set((await container.credentials.listByShop(shopId)).filter((c) => !c.revokedAt).map((c) => c.credentialId));
            return container.connections.forgetStale(shopId, existingIds);
          },
        },
      ],
      [
        "memory",
        {
          // @shopmanagerai/tools MemoryService over storage's MemoryRepo, plus a
          // shop-level enabled flag stored in settings_json under "memory.enabled".
          list: async (shopId: string, type?: string) => (await container.memory.list(shopId, type as never)).map(toMemoryRecord),
          get: async (shopId: string, idOrName: string) => {
            const row = (await container.memory.get(idOrName)) ?? (await container.memory.getByName(shopId, idOrName));
            return row && row.shopId === shopId ? toMemoryRecord(row) : null;
          },
          save: async (shopId: string, input: { id?: string; name: string; description: string; type: string; content: string; createdBy: string }) => {
            const row = await container.memory.save({ memoryId: input.id, shopId, name: input.name, description: input.description, type: input.type as never, content: input.content, createdBy: input.createdBy });
            return toMemoryRecord(row);
          },
          delete: async (shopId: string, id: string) => {
            const row = await container.memory.get(id);
            if (!row || row.shopId !== shopId) return false;
            return container.memory.delete(id);
          },
          versions: async (shopId: string, id: string) => {
            const row = await container.memory.get(id);
            if (!row || row.shopId !== shopId) return [];
            return container.memory.versions(id);
          },
          restore: async (shopId: string, id: string, version: number, restoredBy: string) => {
            const row = await container.memory.get(id);
            if (!row || row.shopId !== shopId) return null;
            const restored = await container.memory.restore(id, version, restoredBy);
            return restored ? toMemoryRecord(restored) : null;
          },
          isEnabled: async (shopId: string) => {
            const settings = (await container.shops.getById(shopId))?.settings as { memory?: { enabled?: boolean } } | null | undefined;
            return settings?.memory?.enabled !== false;
          },
          setEnabled: async (shopId: string, enabled: boolean) => {
            const shop = await container.shops.getById(shopId);
            const settings = (shop?.settings ?? {}) as Record<string, unknown>;
            await container.shops.upsert({ shopId, domain: shop?.domain ?? "", settings: { ...settings, memory: { ...(settings.memory as Record<string, unknown> | undefined), enabled } } });
          },
        },
      ],
    ]),
  };
}

export function toMemoryRecord(row: { memoryId: string; name: string; description: string; type: string; content: string; enabled: boolean; createdBy: string; createdAt: string; updatedAt: string; version: number }) {
  return {
    id: row.memoryId,
    name: row.name,
    description: row.description,
    type: row.type,
    content: row.content,
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/** Runs one tool call through validation, policy, ledger, and the handler. */
/** Facts the policy engine needs for plan / protected-data / version gates. */
export function storeFactsFor(container: Container, reqCtx: McpRequestCtx): { plan?: string; apiVersion: string; distribution: "custom" | "public" } {
  return { plan: reqCtx.shop.plan ?? undefined, apiVersion: container.apiVersion.current(), distribution: "custom" };
}

/**
 * Schema + policy evaluation only (change.validate): says exactly why a call would
 * be refused, or what risk/approval it would carry, without touching Shopify.
 */
export async function validateTool(container: Container, reqCtx: McpRequestCtx, toolName: string, rawInput: unknown): Promise<
  | { ok: true; tool: string; effectiveRisk: string; riskLevel: NonNullable<ToolDefinition["riskLevel"]>; approval?: string; planHash: string }
  | { ok: false; tool: string; code: string; message: string; details?: Record<string, unknown> }
> {
  const def = container.registry.get(toolName);
  if (!def) return { ok: false, tool: toolName, code: ERROR_CODES.TOOL_NOT_FOUND, message: `Unknown tool "${toolName}".` };
  const parsed = def.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error instanceof z.ZodError ? parsed.error.issues : [];
    return { ok: false, tool: def.name, code: ERROR_CODES.INVALID_INPUT, message: issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") || "Input failed schema validation.", details: { issues } };
  }
  const input = parsed.data;
  const hash = computePlanHash(def.name, reqCtx.shop.shopId, input);
  const rawApprovalToken = isPlainObject(rawInput) ? (rawInput as Record<string, unknown>)["approvalToken"] : undefined;
  const policyInput = typeof rawApprovalToken === "string" ? { ...(input as Record<string, unknown>), approvalToken: rawApprovalToken } : input;
  const decision = await evaluate({
    def,
    effectiveName: def.name,
    credential: reqCtx.credential,
    tier: reqCtx.tier,
    entitlements: reqCtx.entitlements,
    capabilities: reqCtx.planes.capabilities,
    input: policyInput,
    bulkCount: bulkCountOf(input),
    planHash: hash,
    approvals: { ...container.approvals, consume: async () => ({ ok: true as const }) } as unknown as typeof container.approvals,
    shopId: reqCtx.shop.shopId,
    storeFacts: storeFactsFor(container, reqCtx),
  });
  if (!decision.allowed) return { ok: false, tool: def.name, code: decision.code, message: decision.message, details: decision.details };
  return { ok: true, tool: def.name, effectiveRisk: decision.effectiveRisk, riskLevel: def.riskLevel ?? "SAFE_WRITE", approval: def.approval, planHash: hash };
}

export async function executeTool(container: Container, reqCtx: McpRequestCtx, toolName: string, rawInput: unknown): Promise<ToolResult> {
  const registry: ToolRegistry = container.registry;
  const def = registry.get(toolName);
  if (!def) {
    return toolFailure(toolName, "TOOL_NOT_FOUND", `Unknown tool "${toolName}".`);
  }
  const effectiveName = def.name;

  const parsed = def.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error instanceof z.ZodError ? parsed.error.issues : [];
    return {
      ok: false,
      tool: effectiveName,
      code: ERROR_CODES.INVALID_INPUT,
      message: "Input failed schema validation.",
      retryable: false,
      risk: def.riskClass,
      suggestedActions: [],
      details: { issues },
    };
  }
  const input = parsed.data;

  const bulkCount = bulkCountOf(input);
  const shopId = reqCtx.shop.shopId;
  // planHash is computed from the tool's own (schema-validated) input only, so it
  // matches whatever an approval was issued against (admin API's /approvals and
  // /theme/publish compute the same hash from {tool, shopId, input} before adding
  // approvalToken). approvalToken itself is an envelope field, not part of any
  // tool's inputSchema, so it would otherwise be stripped by the parse above , 
  // it's read from the raw request body and merged back in only for the policy
  // check (the handler never sees it).
  const hash = computePlanHash(effectiveName, shopId, input);
  const rawApprovalToken = isPlainObject(rawInput) ? (rawInput as Record<string, unknown>)["approvalToken"] : undefined;
  const policyInput = typeof rawApprovalToken === "string" ? { ...(input as Record<string, unknown>), approvalToken: rawApprovalToken } : input;

  const decision = await evaluate({
    def,
    effectiveName,
    credential: reqCtx.credential,
    tier: reqCtx.tier,
    entitlements: reqCtx.entitlements,
    capabilities: reqCtx.planes.capabilities,
    input: policyInput,
    bulkCount,
    planHash: hash,
    approvals: container.approvals,
    shopId,
    storeFacts: storeFactsFor(container, reqCtx),
  });

  if (!decision.allowed) {
    return {
      ok: false,
      tool: effectiveName,
      code: decision.code,
      message: decision.message,
      retryable: false,
      risk: def.riskClass,
      suggestedActions: decision.suggestedActions,
      details: decision.details,
    };
  }

  const operationId = newId("op");
  const toolCtx = buildToolContext(container, reqCtx, operationId);

  let began = false;
  if (def.audit === "always" || def.riskClass !== "read") {
    await container.ledger.begin({
      operationId,
      shopId,
      credentialId: reqCtx.credential.credentialId,
      credentialLabel: reqCtx.credential.label,
      tool: effectiveName,
      tier: def.tier,
      risk: decision.effectiveRisk,
      inputsHash: hash,
      inputsRedacted: redactValue(input),
      resources: [],
      changes: [],
      evidence: [],
      warnings: [],
      approval: decision.approval ? { kind: decision.approval.kind, approvedBy: decision.approval.approvedBy } : undefined,
      rollback: { available: false, strategy: def.rollback },
      era: reqCtx.era,
    });
    began = true;
  }

  const timeoutMs = def.timeoutMs > 0 ? def.timeoutMs : 30000;
  const startedAt = Date.now();
  let result: ToolResult;
  try {
    result = await Promise.race([
      def.handler(toolCtx, input),
      new Promise<ToolResult>((_, reject) => setTimeout(() => reject(new ShopManagerAIError("TIMEOUT", `Tool "${effectiveName}" timed out.`)), timeoutMs)),
    ]);
  } catch (e) {
    const cpError = toShopManagerAIError(e);
    result = cpError.toFailure(effectiveName, def.riskClass, operationId);
  }
  const durationMs = Date.now() - startedAt;

  if (began) {
    if (result.ok) {
      await container.ledger.finish(operationId, {
        status: "succeeded",
        resources: result.changes.map((c) => c.resource),
        changes: result.changes,
        evidence: result.evidence,
        warnings: result.warnings,
        rollback: result.rollback,
      });
    } else {
      await container.ledger.finish(operationId, {
        status: "failed",
        error: { code: result.code, message: result.message },
      });
    }
  }

  {
    // Observability (Phase 8): one structured line per execution with the ids an operator
    // needs to correlate a ledger entry, a rollback and the Shopify API cost it consumed.
    const admin = reqCtx.planes.admin as { getThrottleState?: () => { currentlyAvailable: number; maximumAvailable: number } } | undefined;
    const throttle = admin?.getThrottleState?.();
    const changes = result.ok ? result.changes.length : 0;
    container.log.info("tool.executed", { operationId, tool: effectiveName, shopId, tier: def.tier, riskClass: def.riskClass, riskLevel: def.riskLevel, durationMs, ok: result.ok, code: result.ok ? undefined : result.code, changes, rollbackAvailable: result.ok ? result.rollback?.available ?? false : false, rollbackStrategy: result.ok ? result.rollback?.strategy : undefined, apiCostAvailable: throttle?.currentlyAvailable, apiCostMax: throttle?.maximumAvailable, credential: reqCtx.credential.label });
    container.metrics.inc("shopmanager_tool_executions_total", { tool: effectiveName, ok: String(result.ok), risk: def.riskClass });
    container.metrics.observe("shopmanager_tool_duration_ms", { tool: effectiveName }, durationMs);
    if (changes) container.metrics.inc("shopmanager_changes_total", { tool: effectiveName }, changes);
  }

  void recordToolTelemetry(
    container.telemetry,
    async (shopId) => (await container.shops.getById(shopId))?.settings ?? null,
    { shopId, tool: effectiveName, durationMs, ok: result.ok, code: result.ok ? undefined : result.code, tier: def.tier },
  );

  return result;
}
