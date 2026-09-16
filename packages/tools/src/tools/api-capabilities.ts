/**
 * commerce.api.capabilities: what the connected store + configured API version can
 * do, per Shopify capability we depend on, with the exact reason when it cannot.
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { ShopifyApiVersionManager, type StoreFacts } from "@shopmanagerai/shopify-admin";
import { API_VERSION_SERVICE_KEY } from "../services.js";

export const apiCapabilitiesTool: ToolDefinition = defineTool({
  name: "commerce.api.capabilities",
  description: "Lists the Shopify Admin API capabilities this server relies on (mutations, queries, platform features) with minimum API version, deprecation/replacement, required scopes, protected-customer-data and plan gating, and whether each is available for the connected store right now, with the exact reason when it is not. Use it before attempting Markets, checkout, Functions, orders or customer work.",
  tier: "free",
  category: "system",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ name: z.string().optional(), onlyUnavailable: z.boolean().optional() }),
  outputSchema: z.object({ apiVersion: z.string(), supportEndsOn: z.string(), deprecations: z.array(z.string()), capabilities: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["granted scopes", "shop plan"], writes: [], stores: [], returnsToClient: ["capability table"] },
  docs: {
    examples: [{ title: "Everything", input: {} }, { title: "One capability", input: { name: "themeFilesUpsert" } }],
    failureModes: [],
    limitations: ["Entries marked verified:\"docs\" come from Shopify documentation and have not been exercised by our live sweeps yet."],
  },
  handler: async (ctx, input) => {
    const svc = ctx.services.get(API_VERSION_SERVICE_KEY) as ShopifyApiVersionManager | { current(): string } | undefined;
    const mgr = svc instanceof ShopifyApiVersionManager ? svc : new ShopifyApiVersionManager({ SHOPIFY_API_VERSION: svc?.current() });
    const facts: StoreFacts = { plan: ctx.shop.plan ?? undefined, scopesGranted: ctx.credential.scopesGranted, distribution: "custom" };
    const window = mgr.supportedWindow(mgr.current());
    const rows = mgr
      .list()
      .filter((c) => !input.name || c.name === input.name)
      .map((c) => {
        const check = mgr.check(c.name, facts);
        return { ...c, available: check.available, reasons: check.reasons, missingScopes: check.missingScopes };
      })
      .filter((r) => !input.onlyUnavailable || !r.available);
    return ok({ operationId: ctx.operationId }, apiCapabilitiesTool, {
      summary: `API ${mgr.current()}: ${rows.filter((r) => r.available).length}/${rows.length} capabilities available for this store`,
      data: { apiVersion: mgr.current(), supportEndsOn: window.endOfSupport.toISOString().slice(0, 10), deprecations: mgr.deprecations().map((d) => d.name), capabilities: rows },
    });
  },
});

export function registerApiCapabilityTools(registry: ToolRegistry): void {
  registry.register(apiCapabilitiesTool);
}
