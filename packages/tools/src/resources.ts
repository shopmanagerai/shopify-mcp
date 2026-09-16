/**
 * MCP resources: read-only, URI-addressed views built by executing the
 * corresponding tool and returning its data as JSON text.
 */
import { ShopManagerAIError, newId, type ToolContext } from "@shopmanagerai/shared";
import { capabilitiesTool } from "./tools/system.js";
import { entitlementsTool } from "./tools/system.js";
import { environmentTool } from "./tools/system.js";
import { storeSummaryTool } from "./tools/store.js";
import { themeArchitectureTool, resolveDefaultThemeId } from "./tools/theme.js";

import { memoryListTool } from "./tools/memory.js";
import { MEMORY_SERVICE_KEY, type MemoryService } from "./services.js";

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_URIS = [
  "commerce://capabilities",
  "commerce://entitlements",
  "commerce://environment",
  "shopify://store/summary",
  "shopify://theme/architecture",
  "commerce://memory/index",
] as const;

export async function listResources(ctx: ToolContext): Promise<McpResourceDescriptor[]> {
  const memorySvc = ctx.services.get(MEMORY_SERVICE_KEY) as MemoryService | undefined;
  const memoryEnabled = memorySvc ? await memorySvc.isEnabled(ctx.shop.shopId) : false;
  return [
    { uri: "commerce://capabilities", name: "Capabilities", description: "Store capabilities and registered tool counts.", mimeType: "application/json" },
    { uri: "commerce://entitlements", name: "Entitlements", description: "This shop's entitlement state and plan.", mimeType: "application/json" },
    { uri: "commerce://environment", name: "Environment", description: "API version, demo flag, and execution era.", mimeType: "application/json" },
    { uri: "shopify://store/summary", name: "Store summary", description: "Basic store facts.", mimeType: "application/json" },
    { uri: "shopify://theme/architecture", name: "Theme architecture", description: "Static architecture of the working (or live) theme.", mimeType: "application/json" },
    ...(memoryEnabled
      ? [{ uri: "commerce://memory/index", name: "Memory index", description: "Index (id, name, description, type) of this shop's stored memories.", mimeType: "application/json" }]
      : []),
  ];
}

async function runFreshOperation<T>(ctx: ToolContext, run: (ctx: ToolContext) => Promise<T>): Promise<T> {
  const opCtx: ToolContext = { ...ctx, operationId: newId("op") };
  return run(opCtx);
}

export async function readResource(ctx: ToolContext, uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
  const result = await runFreshOperation(ctx, async (opCtx) => {
    switch (uri) {
      case "commerce://capabilities":
        return capabilitiesTool.handler(opCtx, {});
      case "commerce://entitlements":
        return entitlementsTool.handler(opCtx, {});
      case "commerce://environment":
        return environmentTool.handler(opCtx, {});
      case "shopify://store/summary":
        return storeSummaryTool.handler(opCtx, {});
      case "shopify://theme/architecture": {
        const themeId = await resolveDefaultThemeId(opCtx);
        return themeArchitectureTool.handler(opCtx, { themeId });
      }

      case "commerce://memory/index":
        return memoryListTool.handler(opCtx, {});
      default:
        throw new ShopManagerAIError("NOT_FOUND", `No resource with uri "${uri}".`, { retryable: false });
    }
  });

  return { uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) };
}
