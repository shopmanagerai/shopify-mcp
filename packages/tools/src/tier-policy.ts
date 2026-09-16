/**
 * Commercial tier policy (decided 2026-09-10): Free is read-only. It gives an AI client
 * what the Shopify admin already shows (theme files, catalog, content, menus,
 * metafields, Theme Check) plus the product plumbing every plan needs (connect,
 * tokens, ledger/snapshots/rollback history, memory, settings). Every write of any
 * kind (theme files, publish, catalog, content, SEO), every audit/analysis beyond raw
 * inspection, screenshots, design, and orchestration is Pro. Applied once at registry build time so the tier
 * lives in one place instead of in 400 tool definitions.
 */
import type { Entitlement, ToolDefinition } from "@shopmanagerai/shared";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";

/** Exact names or prefix globs (`shopify.theme.*`) that stay on the Free plan. */
export const FREE_TOOLS: readonly string[] = [
  // system / connect / account
  "commerce.*",
  "shopify.auth.*",
  "shopify.store.summary",
  "shopify.store.capabilities",
  "shopify.apps.list",
  "shopify.apps.inspect",
  "shopify.app.inspect",
  // theme: read + inspect only
  "shopify.theme.list_remote",
  "shopify.theme.current",
  "shopify.theme.inspect",
  "shopify.theme.architecture",
  "shopify.theme.preview",
  "shopify.theme.templates",
  "shopify.theme.sections",
  "shopify.theme.blocks",
  "shopify.theme.snippets",
  "shopify.theme.assets",
  "shopify.theme.locales",
  "shopify.theme.config",
  "shopify.theme.settings",
  "shopify.theme.search",
  "shopify.theme.find_reference",
  "shopify.theme.dependencies",
  "shopify.theme.file.read",
  "shopify.theme.file.search",
  "shopify.theme.file.diff",
  "shopify.liquid.parse",
  "shopify.liquid.validate",
  "shopify.liquid.inspect",
  "shopify.theme_check.run",
  "shopify.theme_check.summary",
  "shopify.theme_check.list_checks",
  "shopify.theme_check.inspect_issue",
  "shopify.section.inspect",
  "shopify.section.schema",
  "shopify.block.inspect",
  "shopify.block.schema",
  "shopify.template.inspect",
  "shopify.template.schema",
  // catalog: read only
  "shopify.products.list",
  "shopify.product.get",
  "shopify.collections.list",
  "shopify.collection.get",
  "shopify.pages.list",
  "shopify.page.get",
  "shopify.blogs.list",
  "shopify.blog.get",
  "shopify.articles.list",
  "shopify.article.get",
  "shopify.navigation.list",
  "shopify.navigation.get",
  "shopify.redirects.list",
  "shopify.media.list",
  "shopify.publications.list",
  "shopify.metafields.list",
  "shopify.metafields.definitions",
  "shopify.metaobjects.list",
  "shopify.metaobjects.definitions",
  "shopify.store.job_status",
  // commerce ops: non-protected reads only (orders/customers carry protected customer data and stay Pro)
  "shopify.locations.list",
  "shopify.inventory.get",
  "shopify.markets.list",
  "shopify.markets.get",
  "shopify.locales.list",
  "shopify.translations.get",
  "shopify.translations.list",
  "shopify.catalogs.list",
  "shopify.price_lists.list",
  "shopify.price_lists.prices",
  "shopify.discounts.list",
  "shopify.discounts.get",
  // phase 6 reads
  "shopify.webhooks.list",
  "shopify.pixels.get",
  "shopify.script_tags.list",
  "shopify.functions.list",
  "shopify.checkout.profiles",
];

/** Reserved for regex-shaped Free rules; empty since Free became read-only. */
const FREE_PATTERNS: readonly RegExp[] = [];

/** Which Pro entitlement gates a tool that falls outside FREE_TOOLS. */
function entitlementFor(def: ToolDefinition): Entitlement {
  const n = def.name;
  if (n.startsWith("shopify.seo.") || n.startsWith("shopify.aeo.")) return "pro.seo_advanced";
  if (n.startsWith("shopify.conflicts.")) return "pro.conflict_doctor";
  if (n.startsWith("shopify.performance.") || n.startsWith("shopify.accessibility.") || n.startsWith("shopify.mobile.")) return "pro.perf_a11y";
  if (/^shopify\.(inventory|locations|markets|locales|translations|catalogs|price_lists|discounts|orders|draft_orders|fulfillment|returns|customers)\./.test(n)) return "pro.commerce_ops";
  if (n.startsWith("shopify.analytics.")) return "pro.analytics";
  if (/^shopify\.(webhooks|pixels|script_tags|tracking|functions|checkout|admin_extension|flow)\./.test(n)) return "pro.extensions";
  if (n.startsWith("shopify.merchandising.") || n.startsWith("shopify.search.")) return "pro.content";
  if (n.startsWith("shopify.visual.")) return "pro.visual_ai";
  if (n.startsWith("shopify.store.")) return "pro.orchestration";
  if (n.startsWith("shopify.media.bulk") || def.riskClass === "bulk") return "pro.bulk";
  if (/^shopify\.(product|variant|collection|page|article|navigation|redirects|metafields|metaobject|media)\./.test(n)) return "pro.content";
  if (n === "shopify.theme.install_from_url" || n === "shopify.theme.delete_remote" || n === "shopify.theme.files.apply" || n === "shopify.theme.diff") return "pro.content";
  return "pro.design_ai";
}

export function isFreeTool(name: string): boolean {
  if (FREE_PATTERNS.some((re) => re.test(name))) return true;
  return FREE_TOOLS.some((pattern) => (pattern.endsWith(".*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern));
}

/**
 * Rewrites `tier` / `requiredEntitlements` on every registered tool according to the
 * policy. Agency-tier tools are left alone. Idempotent.
 */
export function applyTierPolicy(registry: ToolRegistry): { free: number; pro: number } {
  let free = 0;
  let pro = 0;
  for (const def of registry.list()) {
    if (def.tier === "agency") continue;
    const mutable = def as { tier: ToolDefinition["tier"]; requiredEntitlements: Entitlement[] };
    if (isFreeTool(def.name)) {
      mutable.tier = "free";
      mutable.requiredEntitlements = def.requiredEntitlements.filter((e) => !e.startsWith("pro."));
      free++;
    } else {
      mutable.tier = "pro";
      const needed = entitlementFor(def);
      if (!def.requiredEntitlements.some((e) => e.startsWith("pro."))) mutable.requiredEntitlements = [...def.requiredEntitlements, needed];
      pro++;
    }
  }
  return { free, pro };
}
