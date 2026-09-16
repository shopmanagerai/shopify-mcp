/**
 * commerce.settings.*, per-shop settings that live outside the theme.
 *
 * `storefront_password` stores the Online Store password (encrypted at rest via the
 * server's SecretStore) so every screenshot/visual tool can get past the password
 * page without the client pasting the password into every call.
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { STOREFRONT_PASSWORD_SERVICE_KEY, type StorefrontPasswordService } from "../services.js";

function requireService(ctx: { services: Map<string, unknown> }): StorefrontPasswordService | null {
  return (ctx.services.get(STOREFRONT_PASSWORD_SERVICE_KEY) as StorefrontPasswordService | undefined) ?? null;
}

export const settingsStorefrontPasswordTool: ToolDefinition = defineTool({
  name: "commerce.settings.storefront_password",
  description: "Stores (or clears) the storefront password for this shop, encrypted at rest, so visual capture, audits and the design loop can screenshot a password-protected storefront without the password being passed on every call. The password is never returned.",
  tier: "free",
  category: "system",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({
    password: z.string().min(1).max(200).optional(),
    clear: z.boolean().optional(),
  }).refine((v) => !!v.password || v.clear === true, { message: "Pass password, or clear:true." }),
  outputSchema: z.object({ stored: z.boolean() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: ["shop settings"], stores: ["storefront password (encrypted)"], returnsToClient: ["stored flag"] },
  docs: {
    examples: [
      { title: "Store the storefront password", input: { password: "winter-26" } },
      { title: "Forget it", input: { clear: true } },
    ],
    failureModes: [{ code: "CAPABILITY_MISSING", meaning: "The server has no secret store configured (demo mode)." }],
    limitations: ["Only the Online Store password page is handled; B2B/customer-account gates are not."],
  },
  handler: async (ctx, input) => {
    const svc = requireService(ctx);
    if (!svc) {
      return fail({ operationId: ctx.operationId }, settingsStorefrontPasswordTool, { code: "CAPABILITY_MISSING", message: "No secret store is configured for this server.", retryable: false });
    }
    if (input.clear) {
      await svc.clear(ctx.shop.shopId);
      return ok({ operationId: ctx.operationId }, settingsStorefrontPasswordTool, { summary: "Storefront password cleared", data: { stored: false } });
    }
    await svc.set(ctx.shop.shopId, input.password!);
    return ok({ operationId: ctx.operationId }, settingsStorefrontPasswordTool, {
      summary: "Storefront password stored (encrypted). Visual tools will use it automatically.",
      data: { stored: true },
      nextActions: [{ tool: "shopify.visual.capture_page", reason: "Verify the password works by capturing the home page.", input: { url: "/" } }],
    });
  },
});

export function registerSettingsTools(registry: ToolRegistry): void {
  registry.register(settingsStorefrontPasswordTool);
}
