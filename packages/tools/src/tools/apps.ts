/**
 * App detection tools (category "apps"): scan + manifest, built on
 * @shopmanagerai/app-detector reconstructing "installed apps" from theme
 * evidence (never authoritative, see detect.ts doc comment).
 */
import { z } from "zod";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolDefinition } from "@shopmanagerai/shared";

import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { buildArchitecture } from "@shopmanagerai/theme-intelligence";
import { detectApps, findKnownAppByHandle, KNOWN_APPS } from "@shopmanagerai/app-detector";
import { loadThemeFileSet } from "../theme-loader.js";

















export const appInspectTool: ToolDefinition = defineTool({
  name: "shopify.app.inspect",
  description: "Looks up a known app by handle and reports its theme-detected evidence, if any.",
  tier: "free",
  category: "apps",
  riskClass: "read",
  executionPlane: "theme_engine",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), handle: z.string() }),
  outputSchema: z.object({ known: z.unknown(), detected: z.unknown().optional() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files", "known app registry"], writes: [], stores: [], returnsToClient: ["app inspection result"] },
  docs: {
    examples: [{ title: "Inspect an app by handle", input: { themeId: "123", handle: "judge-me-reviews" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "handle is not in the known-app registry." }],
    limitations: [`Known-app registry currently has ${KNOWN_APPS.length} entries; unrecognized apps return NOT_FOUND even if theme evidence exists.`],
  },
  handler: async (ctx, input) => {
    const known = findKnownAppByHandle(input.handle);
    if (!known) {
      return fail({ operationId: ctx.operationId }, appInspectTool, { code: "NOT_FOUND", message: `No known app with handle "${input.handle}".`, retryable: false });
    }
    const { fileSet } = await loadThemeFileSet(ctx.theme, input.themeId!);
    const architecture = buildArchitecture(fileSet);
    const apps = detectApps({ fileSet, architecture });
    const detected = apps.find((a) => a.id === input.handle);
    return ok({ operationId: ctx.operationId }, appInspectTool, { summary: detected ? `"${input.handle}" detected in theme ${input.themeId!}` : `"${input.handle}" known but not detected in theme ${input.themeId!}`, data: { known, detected } });
  },
});



export function registerAppsTools(registry: ToolRegistry): void {
  registry.register(appInspectTool);
}
