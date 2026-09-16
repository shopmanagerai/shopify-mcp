import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Auth and capability-probe tools (category "auth"). Never accept or return
 * secrets, `shopify.auth.connect` only returns an admin URL to complete
 * install/reconnect elsewhere; `shopify.auth.disconnect` is admin-UI only.
 */
import { z } from "zod";
import { BRAND } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";

export const authStatusTool: ToolDefinition = defineTool({
  name: "shopify.auth.status",
  description: "Reports what kinds of access this credential has (admin, theme write) and the scopes granted, without ever revealing secrets.",
  tier: "free",
  category: "auth",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({
    kind: z.string(),
    profile: z.string(),
    scopesGranted: z.array(z.string()),
    themeWriteAvailable: z.boolean(),
    adminAvailable: z.boolean(),
  }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["credential metadata"], writes: [], stores: [], returnsToClient: ["auth status (no secrets)"] },
  docs: { examples: [{ title: "Check auth status", input: {} }], failureModes: [], limitations: ["Never returns tokens or secrets."] },
  handler: async (ctx, _input) => {
    return ok({ operationId: ctx.operationId }, authStatusTool, {
      summary: `Connected as ${ctx.credential.kind} (${ctx.credential.profile})`,
      data: {
        kind: ctx.credential.kind,
        profile: ctx.credential.profile,
        scopesGranted: ctx.credential.scopesGranted,
        themeWriteAvailable: ctx.capabilities.has("theme.write"),
        adminAvailable: ctx.capabilities.has("admin.read"),
      },
    });
  },
});

export const authPermissionsTool: ToolDefinition = defineTool({
  name: "shopify.auth.permissions",
  description: "Returns the full set of Shopify scopes and store capabilities available to this credential.",
  tier: "free",
  category: "auth",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ scopesGranted: z.array(z.string()), capabilities: z.array(z.string()), policy: z.record(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["credential metadata"], writes: [], stores: [], returnsToClient: ["permission list"] },
  docs: { examples: [{ title: "List permissions", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, _input) => {
    return ok({ operationId: ctx.operationId }, authPermissionsTool, {
      summary: `${ctx.credential.scopesGranted.length} scope(s), ${ctx.capabilities.size} capability(ies)`,
      data: { scopesGranted: ctx.credential.scopesGranted, capabilities: [...ctx.capabilities].sort(), policy: ctx.credential.policy },
    });
  },
});

export const authValidateTool: ToolDefinition = defineTool({
  name: "shopify.auth.validate",
  description: "Probes the theme engine (list themes) and admin API (shop query) to confirm the credential actually works.",
  tier: "free",
  category: "auth",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ themeProbeOk: z.boolean(), adminProbeOk: z.boolean(), errors: z.array(z.string()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["connectivity"], writes: [], stores: [], returnsToClient: ["probe results"] },
  docs: { examples: [{ title: "Validate credential", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, _input) => {
    const errors: string[] = [];
    let themeProbeOk = false;
    let adminProbeOk = false;
    if (ctx.theme) {
      try {
        await ctx.theme.listThemes();
        themeProbeOk = true;
      } catch (e) {
        errors.push(`theme probe: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (ctx.admin) {
      try {
        await ctx.admin.query("query { shop { name } }", undefined, { cost: 1 });
        adminProbeOk = true;
      } catch (e) {
        errors.push(`admin probe: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return ok({ operationId: ctx.operationId }, authValidateTool, {
      summary: `theme=${themeProbeOk} admin=${adminProbeOk}`,
      data: { themeProbeOk, adminProbeOk, errors },
      warnings: errors,
    });
  },
});

export const authDoctorTool: ToolDefinition = defineTool({
  name: "shopify.auth.doctor",
  description: "Actionable checklist of what's wrong with this credential's setup and what to do about it.",
  tier: "free",
  category: "auth",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ issues: z.array(z.object({ issue: z.string(), fix: z.string() })) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["credential metadata", "connectivity"], writes: [], stores: [], returnsToClient: ["diagnostic checklist"] },
  docs: { examples: [{ title: "Diagnose auth issues", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, _input) => {
    const issues: Array<{ issue: string; fix: string }> = [];
    if (!ctx.theme) issues.push({ issue: "No theme engine configured.", fix: "Connect a Theme Access token or reinstall the app." });
    if (!ctx.admin) issues.push({ issue: "No Admin GraphQL client configured.", fix: "Reconnect via OAuth to grant admin API access." });
    if (!ctx.capabilities.has("theme.write")) issues.push({ issue: "Theme write capability unavailable.", fix: "Grant theme write access via shopify.auth.connect." });
    return ok({ operationId: ctx.operationId }, authDoctorTool, {
      summary: issues.length === 0 ? "No issues found" : `${issues.length} issue(s) found`,
      data: { issues },
    });
  },
});

export const authConnectTool: ToolDefinition = defineTool({
  name: "shopify.auth.connect",
  description: "Returns an admin URL to complete or extend the store's connection to ShopManager AI. Never accepts secrets as input.",
  tier: "free",
  category: "auth",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ adminUrl: z.string() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: [], returnsToClient: ["admin connect URL"] },
  docs: {
    examples: [{ title: "Get connect URL", input: {} }],
    failureModes: [],
    limitations: ["Never accepts or returns credentials; the user completes the flow in the browser."],
  },
  handler: async (ctx, _input) => {
    const adminUrl = `https://${ctx.shop.domain}/admin/oauth/authorize?client_id=${BRAND.slug}`;
    return ok({ operationId: ctx.operationId }, authConnectTool, { summary: "Open this URL to complete connection", data: { adminUrl } });
  },
});

export const authDisconnectTool: ToolDefinition = defineTool({
  name: "shopify.auth.disconnect",
  description: "Disconnecting is only available from the Shopify admin UI, not through MCP.",
  tier: "free",
  category: "auth",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: [], returnsToClient: [] },
  docs: {
    examples: [{ title: "Attempt disconnect", input: {} }],
    failureModes: [{ code: "NOT_SUPPORTED", meaning: "Always returned; disconnect only via the Shopify admin UI." }],
    limitations: ["Never supported through MCP by design."],
  },
  handler: async (ctx, _input) => {
    return fail({ operationId: ctx.operationId }, authDisconnectTool, {
      code: "NOT_SUPPORTED",
      message: "Disconnecting is only available from the Shopify admin UI (uninstall or revoke the app), not through MCP.",
      retryable: false,
    });
  },
});

function capabilitiesOutput() {
  return z.object({ capabilities: z.array(z.string()) });
}

/**
 * Everything the four capability tools have in common. They used to spread the
 * broadest one, which tied the Free `shopify.store.capabilities` to a Pro
 * sibling; a plain base object keeps them independent.
 */
const capabilitiesCommon = {
  tier: "free" as const,
  category: "auth" as const,
  riskClass: "read" as const,
  executionPlane: "server" as const,
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: capabilitiesOutput(),
  supportsDryRun: false,
  rollback: "none" as const,
  taskMode: "sync" as const,
  approval: "none" as const,
  dataCategories: { reads: ["store capability probes"], writes: [], stores: [], returnsToClient: ["capability list"] },
  docs: { examples: [{ title: "List all capabilities", input: {} }], failureModes: [], limitations: [] },
};



export const storeCapabilitiesTool: ToolDefinition = defineTool({
  ...capabilitiesCommon,
  name: "shopify.store.capabilities",
  description: "Store-level capabilities only (admin.read/write).",
  handler: async (ctx, _input) => ok({ operationId: ctx.operationId }, storeCapabilitiesTool, {
    summary: "Store capabilities",
    data: { capabilities: [...ctx.capabilities].filter((c) => c.startsWith("admin.")).sort() },
  }),
});





export function registerAuthTools(registry: ToolRegistry): void {
  registry.register(authStatusTool);
  registry.register(authPermissionsTool);
  registry.register(authValidateTool);
  registry.register(authDoctorTool);
  registry.register(authConnectTool);
  registry.register(authDisconnectTool);
  registry.register(storeCapabilitiesTool);
}
