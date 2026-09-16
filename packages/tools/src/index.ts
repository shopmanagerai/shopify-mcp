/**
 * @shopmanagerai/tools - the Free tool catalog.
 *
 * This file is generated: the private repository holds Free and Pro tools in
 * the same modules, and scripts/build-oss.mjs cuts the Pro definitions out.
 * Edit the source there, not here.
 */
import { ToolRegistry } from "@shopmanagerai/tool-registry";
import { registerSystemTools } from "./tools/system.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerStoreTools } from "./tools/store.js";
import { registerThemeTools } from "./tools/theme.js";
import { registerThemeFileTools } from "./tools/theme-file.js";
import { registerLiquidTools } from "./tools/liquid.js";
import { registerSectionBlockTemplateTools } from "./tools/section-block-template.js";
import { registerThemeCheckTools } from "./tools/theme-check.js";
import { registerAppsTools } from "./tools/apps.js";
import { registerSnapshotTools } from "./tools/snapshots.js";
import { registerOperationsTools } from "./tools/operations.js";
import { registerProductTools } from "./tools/products.js";
import { registerCollectionTools } from "./tools/collections.js";
import { registerPagesBlogsTools } from "./tools/pages-blogs.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerMetafieldTools } from "./tools/metafields.js";
import { registerMetaobjectTools } from "./tools/metaobjects.js";
import { registerMediaTools } from "./tools/media.js";
import { registerRedirectTools } from "./tools/redirects.js";
import { registerPublicationTools } from "./tools/publications.js";
import { registerSkillsTools } from "./tools/skills.js";
import { registerStoreOrchestrationTools } from "./tools/store-orchestration.js";
import { registerMemoryTools } from "./tools/memory.js";

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerSystemTools(registry);
  registerAuthTools(registry);
  registerStoreTools(registry);
  registerThemeTools(registry);
  registerThemeFileTools(registry);
  registerLiquidTools(registry);
  registerSectionBlockTemplateTools(registry);
  registerThemeCheckTools(registry);
  registerAppsTools(registry);
  registerSnapshotTools(registry);
  registerOperationsTools(registry);
  registerProductTools(registry);
  registerCollectionTools(registry);
  registerPagesBlogsTools(registry);
  registerNavigationTools(registry);
  registerMetafieldTools(registry);
  registerMetaobjectTools(registry);
  registerMediaTools(registry);
  registerRedirectTools(registry);
  registerPublicationTools(registry);
  registerSkillsTools(registry);
  registerStoreOrchestrationTools(registry);
  registerMemoryTools(registry);
  registerSettingsTools(registry);
  registerApiCapabilityTools(registry);
  registerChangeTools(registry);
  registerCommerceOpsTools(registry);
  registerAdvancedTools(registry);
  applyTierPolicy(registry);
  return registry;
}

export * from "./services.js";
export * from "./tier-policy.js";
import { registerSettingsTools } from "./tools/settings.js";
import { applyTierPolicy } from "./tier-policy.js";
import { registerApiCapabilityTools } from "./tools/api-capabilities.js";
import { registerChangeTools } from "./tools/change.js";
import { registerCommerceOpsTools } from "./tools/commerce-ops.js";
import { registerAdvancedTools } from "./tools/advanced.js";
export { EXECUTOR_SERVICE_KEY, type ToolExecutorService } from "./tools/change.js";
export * from "./theme-loader.js";
export * from "./skills.js";
export * from "./resources.js";

// Re-export individual tool modules for direct access/testing.
export * from "./tools/system.js";
export * from "./tools/auth.js";
export * from "./tools/store.js";
export * from "./tools/theme.js";
export * from "./tools/theme-file.js";
export * from "./tools/liquid.js";
export * from "./tools/section-block-template.js";
export * from "./tools/theme-check.js";
export * from "./tools/apps.js";
export * from "./tools/snapshots.js";
export * from "./tools/operations.js";
export * from "./tools/products.js";
export * from "./tools/collections.js";
export * from "./tools/pages-blogs.js";
export * from "./tools/navigation.js";
export * from "./tools/metafields.js";
export * from "./tools/metaobjects.js";
export * from "./tools/media.js";
export * from "./tools/redirects.js";
export * from "./tools/publications.js";
export * from "./tools/skills.js";
export * from "./admin-helpers.js";
export * from "./tools/store-orchestration.js";
export * from "./tools/memory.js";
