import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * System tools (category "system"): version/health/capabilities/entitlements/
 * environment/diagnostics/privacy/connections/config. Read-only, no theme or
 * admin scope requirements beyond what each probe needs.
 */
import { z } from "zod";
import { BRAND, PRODUCT_VERSION } from "@shopmanagerai/shared";
import { defineTool } from "@shopmanagerai/tool-registry";
import { ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { API_VERSION_SERVICE_KEY, CONNECTIONS_SERVICE_KEY, REGISTRY_SERVICE_KEY, SETTINGS_SERVICE_KEY, type ConnectionsService, type SettingsService } from "../services.js";

const MCP_PROTOCOL_VERSIONS = ["2025-06-18"];

export const versionTool: ToolDefinition = defineTool({
  name: "commerce.version",
  description: "Returns the product brand, product version, and supported MCP protocol versions.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ brand: z.string(), productVersion: z.string(), mcpProtocolVersions: z.array(z.string()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: [], returnsToClient: ["product version"] },
  docs: {
    examples: [{ title: "Get version", input: {} }],
    failureModes: [],
    limitations: ["Static, no network calls."],
  },
  handler: async (ctx, _input) => {
    return ok({ operationId: ctx.operationId }, versionTool, {
      summary: `${BRAND.name} ${PRODUCT_VERSION}`,
      data: { brand: BRAND.name, productVersion: PRODUCT_VERSION, mcpProtocolVersions: MCP_PROTOCOL_VERSIONS },
    });
  },
});

export const healthTool: ToolDefinition = defineTool({
  name: "commerce.health",
  description: "Runs cheap reachability checks: theme engine, admin API, browser plane, ledger writability.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
    healthy: z.boolean(),
  }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["connectivity"], writes: [], stores: [], returnsToClient: ["health checks"] },
  docs: {
    examples: [{ title: "Health check", input: {} }],
    failureModes: [],
    limitations: ["Checks are best-effort and may themselves fail without failing the overall tool call."],
  },
  handler: async (ctx, _input) => {
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

    if (ctx.theme) {
      try {
        await ctx.theme.listThemes();
        checks.push({ name: "theme_engine", ok: true });
      } catch (e) {
        checks.push({ name: "theme_engine", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    } else {
      checks.push({ name: "theme_engine", ok: false, detail: "not configured" });
    }

    if (ctx.admin) {
      try {
        await ctx.admin.query("query { shop { name } }", undefined, { cost: 1 });
        checks.push({ name: "admin_graphql", ok: true });
      } catch (e) {
        checks.push({ name: "admin_graphql", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    } else {
      checks.push({ name: "admin_graphql", ok: false, detail: "not configured" });
    }

    checks.push({ name: "browser", ok: !!ctx.browser, detail: ctx.browser ? undefined : "not configured" });

    try {
      await ctx.ledger.list(ctx.shop.shopId, { limit: 1 });
      checks.push({ name: "ledger", ok: true });
    } catch (e) {
      checks.push({ name: "ledger", ok: false, detail: e instanceof Error ? e.message : String(e) });
    }

    const healthy = checks.filter((c) => c.name !== "browser").every((c) => c.ok) || checks.some((c) => c.ok);
    return ok({ operationId: ctx.operationId }, healthTool, {
      summary: `${checks.filter((c) => c.ok).length}/${checks.length} checks passed`,
      data: { checks, healthy },
      warnings: checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? "unavailable"}`),
    });
  },
});

export const capabilitiesTool: ToolDefinition = defineTool({
  name: "commerce.capabilities",
  description: "Returns the store capabilities discovered for this credential, plus registered tool counts by availability.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({
    capabilities: z.array(z.string()),
    engineKind: z.string().nullable(),
    toolCount: z.number(),
  }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["store capability probes"], writes: [], stores: [], returnsToClient: ["capability list"] },
  docs: {
    examples: [{ title: "List capabilities", input: {} }],
    failureModes: [],
    limitations: ["Registered tool count reflects this process's registry, not per-credential availability."],
  },
  handler: async (ctx, _input) => {
    const registry = ctx.services.get(REGISTRY_SERVICE_KEY) as ToolRegistry | undefined;
    return ok({ operationId: ctx.operationId }, capabilitiesTool, {
      summary: `${ctx.capabilities.size} store capabilities available`,
      data: {
        capabilities: [...ctx.capabilities].sort(),
        engineKind: ctx.theme?.kind ?? null,
        toolCount: registry?.size ?? 0,
      },
    });
  },
});

export const entitlementsTool: ToolDefinition = defineTool({
  name: "commerce.entitlements",
  description: "Returns this shop's entitlement state (FREE/TRIAL/PRO_ACTIVE/...), plan, and entitlement list.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({
    state: z.string(),
    plan: z.string().optional(),
    entitlements: z.array(z.string()),
    upgradeUrl: z.string(),
  }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["entitlement state"], writes: [], stores: [], returnsToClient: ["entitlement state"] },
  docs: { examples: [{ title: "Get entitlements", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, _input) => {
    const state = await ctx.entitlements.getState(ctx.shop.shopId);
    return ok({ operationId: ctx.operationId }, entitlementsTool, {
      summary: `Entitlement state: ${state.state}`,
      data: { state: state.state, plan: state.plan, entitlements: state.entitlements, upgradeUrl: state.upgradeUrl },
    });
  },
});

export const environmentTool: ToolDefinition = defineTool({
  name: "commerce.environment",
  description: "Returns the configured Shopify Admin API version, demo-mode flag, and execution era.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ apiVersion: z.string().nullable(), demo: z.boolean(), era: z.string() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: [], returnsToClient: ["environment info"] },
  docs: { examples: [{ title: "Get environment", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, _input) => {
    const apiVersion = (ctx.services.get(API_VERSION_SERVICE_KEY) as string | undefined) ?? null;
    return ok({ operationId: ctx.operationId }, environmentTool, {
      summary: `era=${ctx.era}`,
      data: { apiVersion, demo: ctx.theme?.kind === "fake", era: ctx.era },
    });
  },
});

export const diagnosticsTool: ToolDefinition = defineTool({
  name: "commerce.diagnostics",
  description: "Aggregates health, capabilities, and entitlement state into a single diagnostics report.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({
    healthy: z.boolean(),
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
    capabilities: z.array(z.string()),
    entitlementState: z.string(),
  }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["connectivity", "store capability probes", "entitlement state"], writes: [], stores: [], returnsToClient: ["diagnostics report"] },
  docs: { examples: [{ title: "Run diagnostics", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const healthResult = await healthTool.handler(ctx, input);
    const state = await ctx.entitlements.getState(ctx.shop.shopId);
    const checks = healthResult.ok ? healthResult.data.checks : [];
    const healthy = healthResult.ok ? healthResult.data.healthy : false;
    return ok({ operationId: ctx.operationId }, diagnosticsTool, {
      summary: `healthy=${healthy}, entitlement=${state.state}`,
      data: { healthy, checks, capabilities: [...ctx.capabilities].sort(), entitlementState: state.state },
      warnings: healthResult.ok ? healthResult.warnings : [],
    });
  },
});

export const privacyExplainTool: ToolDefinition = defineTool({
  name: "commerce.privacy.explain",
  description: "Explains what data a given tool reads, writes, stores, and returns to the client.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ tool: z.string() }),
  outputSchema: z.object({
    tool: z.string(),
    dataCategories: z.object({ reads: z.array(z.string()), writes: z.array(z.string()), stores: z.array(z.string()), returnsToClient: z.array(z.string()) }),
  }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["tool registry"], writes: [], stores: [], returnsToClient: ["data category declaration"] },
  docs: {
    examples: [{ title: "Explain a tool's data use", input: { tool: "shopify.theme_file.read" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "No tool with that name is registered." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    const registry = ctx.services.get(REGISTRY_SERVICE_KEY) as ToolRegistry | undefined;
    const def = registry?.get(input.tool);
    if (!def) {
      return fail({ operationId: ctx.operationId }, privacyExplainTool, { code: "NOT_FOUND", message: `No tool named "${input.tool}" is registered.` });
    }
    return ok({ operationId: ctx.operationId }, privacyExplainTool, {
      summary: `Data categories for ${def.name}`,
      data: { tool: def.name, dataCategories: def.dataCategories },
    });
  },
});

const ConnectionItemSchema = z.object({
  id: z.string(),
  credentialId: z.string(),
  label: z.string(),
  kind: z.string(),
  client: z.string(),
  clientKey: z.string(),
  version: z.string(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  requests: z.number(),
});

export const connectionsTool: ToolDefinition = defineTool({
  name: "commerce.connections",
  description:
    "Lists which AI clients (Claude Code, Cursor, Codex, etc.) have actually reached the MCP endpoint for this shop, and how much. One row per credential+client pair. Never returns secrets, tokens, or IPs.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ connections: z.array(ConnectionItemSchema) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["connection metadata"], writes: [], stores: [], returnsToClient: ["connection list (no secrets)"] },
  docs: { examples: [{ title: "List connections", input: {} }], failureModes: [], limitations: ["Never returns secrets, tokens, or IP addresses.", "Only reflects requests recorded through the MCP endpoint, not the admin UI."] },
  handler: async (ctx, _input) => {
    const svc = ctx.services.get(CONNECTIONS_SERVICE_KEY) as ConnectionsService | undefined;
    if (!svc) {
      return ok({ operationId: ctx.operationId }, connectionsTool, {
        summary: "No connections service configured",
        data: { connections: [] },
        warnings: ["No connections service wired up in ctx.services; returning an empty list."],
      });
    }
    const rows = await svc.list(ctx.shop.shopId);
    return ok({ operationId: ctx.operationId }, connectionsTool, {
      summary: `${rows.length} connection(s)`,
      data: {
        connections: rows.map((r) => ({
          id: r.id,
          credentialId: r.credentialId,
          label: r.credentialLabel,
          kind: r.kind,
          client: r.clientName,
          clientKey: r.clientKey,
          version: r.clientVersion,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
          requests: r.requestCount,
        })),
      },
    });
  },
});

export const configGetTool: ToolDefinition = defineTool({
  name: "commerce.config.get",
  description: "Returns this shop's stored configuration/settings, if a settings service is wired up.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ settings: z.record(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["shop configuration"], writes: [], stores: [], returnsToClient: ["shop configuration"] },
  docs: { examples: [{ title: "Get config", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, _input) => {
    const svc = ctx.services.get(SETTINGS_SERVICE_KEY) as SettingsService | undefined;
    if (!svc) {
      return ok({ operationId: ctx.operationId }, configGetTool, {
        summary: "No settings service configured",
        data: { settings: {} },
        warnings: ["No settings service wired up in ctx.services."],
      });
    }
    const settings = await svc.get(ctx.shop.shopId);
    return ok({ operationId: ctx.operationId }, configGetTool, { summary: "Loaded shop configuration", data: { settings } });
  },
});

export const configValidateTool: ToolDefinition = defineTool({
  name: "commerce.config.validate",
  description: "Validates a proposed configuration patch without applying it.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ patch: z.record(z.unknown()) }),
  outputSchema: z.object({ valid: z.boolean(), errors: z.array(z.string()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["shop configuration"], writes: [], stores: [], returnsToClient: ["validation result"] },
  docs: { examples: [{ title: "Validate a config patch", input: { patch: { theme_write_enabled: true } } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const svc = ctx.services.get(SETTINGS_SERVICE_KEY) as SettingsService | undefined;
    if (!svc) {
      return ok({ operationId: ctx.operationId }, configValidateTool, {
        summary: "No settings service configured; nothing to validate against",
        data: { valid: true, errors: [] },
        warnings: ["No settings service wired up in ctx.services."],
      });
    }
    const result = await svc.validate(ctx.shop.shopId, input.patch);
    return ok({ operationId: ctx.operationId }, configValidateTool, {
      summary: result.valid ? "Patch is valid" : `Patch has ${result.errors.length} error(s)`,
      data: result,
    });
  },
});

export function registerSystemTools(registry: ToolRegistry): void {
  registry.register(versionTool);
  registry.register(healthTool);
  registry.register(capabilitiesTool);
  registry.register(entitlementsTool);
  registry.register(environmentTool);
  registry.register(diagnosticsTool);
  registry.register(privacyExplainTool);
  registry.register(connectionsTool);
  registry.register(configGetTool);
  registry.register(configValidateTool);
}
