/**
 * Phase 6 advanced tools: webhook subscriptions (list/create/update/delete/health/test),
 * tracking doctor + web pixel + legacy script tags, analytics (ShopifyQL with an
 * orders-based fallback), Shopify Functions (list/scaffold/attach), checkout
 * (audit/profiles/extension scaffold), admin UI + Flow extensions (scaffold/trigger)
 * and commerce.diagnostics.* (api/permissions/webhooks/extensions/tracking) with
 * AUTO_FIX_SAFE / NEEDS_REVIEW / MANUAL classification.
 *
 * Extension projects (pixels, functions, checkout/admin UI, Flow) are generated as
 * files for the client to write into an app repo; `shopify app deploy` needs the
 * Shopify CLI + Partners auth and is returned as a plan, never run here.
 */
import { z } from "zod";
import type { ToolDefinition, ToolCategory, RiskClass, Finding } from "@shopmanagerai/shared";
import { defineTool, ok } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { KNOWN_APPS } from "@shopmanagerai/app-detector";
import { getCurrentAppInstallation, listWebhookSubscriptions, webhookTopicEnum, getWebPixel, listScriptTags, listShopifyFunctions, listCheckoutProfiles } from "@shopmanagerai/shopify-admin";
import { requireAdmin } from "../admin-helpers.js";
import { loadThemeFileSet } from "../theme-loader.js";
import { APP_INFO_SERVICE_KEY, type AppInfoService } from "../services.js";

const appInfo = (ctx: { services: Map<string, unknown> }) => ctx.services.get(APP_INFO_SERVICE_KEY) as AppInfoService | undefined;

export type FixClass = "AUTO_FIX_SAFE" | "NEEDS_REVIEW" | "MANUAL";
export type DiagFinding = Finding & { fixClass: FixClass; fix?: { tool: string; input: Record<string, unknown> } | { instructions: string } };
let seq = 0;
const diag = (category: string, severity: Finding["severity"], title: string, detail: string, fixClass: FixClass, fix?: DiagFinding["fix"], confidence = 0.9): DiagFinding => ({ id: `${category}_${++seq}`, severity, category, title, detail, evidence: [], confidence, fixClass, fix, suggestedFix: fix && "tool" in fix ? fix.tool : fix && "instructions" in fix ? fix.instructions : undefined });

const EXAMPLES: Record<string, Record<string, unknown>> = {
  "shopify.webhooks.list": {},
  "shopify.webhooks.create": { topic: "orders/create", uri: "https://example.com/webhooks/orders-create" },
  "shopify.webhooks.update": { id: "gid://shopify/WebhookSubscription/1", includeFields: ["id", "tags"] },
  "shopify.webhooks.delete": { id: "gid://shopify/WebhookSubscription/1", confirm: true },
  "shopify.webhooks.health": {},
  "shopify.webhooks.test": { topic: "shop/update" },
  "shopify.pixels.get": {},
  "shopify.pixels.configure": { settings: { accountID: "G-XXXX" } },
  "shopify.pixels.delete": { confirm: true },
  "shopify.pixels.scaffold": { name: "analytics-pixel", settings: [{ key: "accountID", name: "Account ID" }], events: ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_completed"] },
  "shopify.script_tags.list": {},
  "shopify.script_tags.delete": { id: "gid://shopify/ScriptTag/1", confirm: true },
  "shopify.tracking.audit": {},
  "shopify.analytics.query": { query: "FROM sales SHOW total_sales, orders GROUP BY day SINCE -30d ORDER BY day" },
  "shopify.analytics.sales_summary": { days: 30 },
  "shopify.analytics.top_products": { days: 30, limit: 10 },
  "shopify.functions.list": {},
  "shopify.functions.scaffold": { kind: "discount", name: "volume-discount" },
  "shopify.functions.attach": { kind: "discount", functionId: "gid://shopify/ShopifyFunction/1", title: "Volume discount", configuration: { percentage: 10, minimumQuantity: 3 } },
  "shopify.checkout.audit": {},
  "shopify.checkout.profiles": {},
  "shopify.checkout.extension.scaffold": { name: "delivery-note", target: "purchase.checkout.block.render" },
  "shopify.admin_extension.scaffold": { name: "product-seo-panel", target: "admin.product-details.block.render" },
  "shopify.flow.scaffold": { kind: "trigger", name: "low-stock-alert", fields: [{ key: "sku", type: "single_line_text_field" }] },
  "shopify.flow.trigger": { handle: "low-stock-alert", payload: { sku: "ABC-1", product_id: 1 } },
  "commerce.diagnostics.api": {},
  "commerce.diagnostics.permissions": {},
  "commerce.diagnostics.webhooks": {},
  "commerce.diagnostics.extensions": {},
  "commerce.diagnostics.tracking": {},
};
type Opts = { name: string; category: ToolCategory; riskClass: RiskClass; scopes: string[]; protected?: boolean; rollback?: "none" | "inverse_operation"; dryRun?: boolean; plane?: "shopify_admin" | "server" | "theme_engine"; caps?: Array<"admin.read" | "admin.write" | "theme.read">; plan?: "plus" };
function base(o: Opts) {
  const write = o.riskClass !== "read";
  return {
    tier: "pro" as const,
    category: o.category,
    riskClass: o.riskClass,
    executionPlane: o.plane ?? "shopify_admin",
    requiredEntitlements: [] as never[],
    requiredShopifyScopes: o.scopes,
    requiredStoreCapabilities: (o.caps ?? (o.plane === "server" ? [] : write ? ["admin.write"] : ["admin.read"])) as Array<"admin.read" | "admin.write" | "theme.read">,
    taskMode: "sync" as const,
    approval: "none" as const,
    supportsDryRun: o.dryRun ?? write,
    rollback: (o.rollback ?? "none") as "none" | "inverse_operation",
    protectedCustomerData: o.protected ?? false,
    planRequirement: o.plan,
    dataCategories: { reads: [] as string[], writes: [] as string[], stores: [] as string[], returnsToClient: [] as string[] },
    docs: { examples: [{ title: "Example", input: EXAMPLES[o.name] ?? {} }], failureModes: [{ code: "SCOPE_MISSING", meaning: "The app was installed without this scope; reconnect with the scope set in shopify.auth.connect." }], limitations: [] as string[] },
  };
}
const EXPECTED_TOPICS_FALLBACK = ["app/uninstalled", "app/scopes_update", "shop/update", "themes/publish", "themes/update", "customers/data_request", "customers/redact", "shop/redact"];

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export const webhooksListTool: ToolDefinition = defineTool({
  name: "shopify.webhooks.list",
  description: "Lists this app's webhook subscriptions: topic, delivery uri (HTTPS / Pub/Sub / EventBridge), format, includeFields, filter, API version. Only subscriptions created by this app are visible (Shopify scopes webhooks per app).",
  ...base({ name: "shopify.webhooks.list", category: "webhooks", riskClass: "read", scopes: [] }),
  inputSchema: z.object({ topics: z.array(z.string()).optional(), first: z.number().int().min(1).max(250).optional(), after: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  handler: async (ctx, input) => {
    const page = await listWebhookSubscriptions(requireAdmin(ctx.admin), { ...input, topics: input.topics?.map(webhookTopicEnum) });
    return ok({ operationId: ctx.operationId }, webhooksListTool, { summary: `${page.items.length} webhook subscription(s)`, data: page });
  },
});

async function webhookHealth(ctx: Parameters<ToolDefinition["handler"]>[0]) {
  const admin = requireAdmin(ctx.admin);
  const info = appInfo(ctx);
  const subs = (await listWebhookSubscriptions(admin, { first: 250 })).items;
  const expected = info?.expectedWebhookTopics ?? EXPECTED_TOPICS_FALLBACK;
  seq = 0;
  const findings: DiagFinding[] = [];
  const byTopic = new Map<string, typeof subs>();
  for (const s of subs) byTopic.set(s.topic, [...(byTopic.get(s.topic) ?? []), s]);
  const receipts: Record<string, { receivedAt: string } | null> = {};
  for (const topic of expected) {
    const en = webhookTopicEnum(topic);
    const have = byTopic.get(en) ?? [];
    if (info) receipts[topic] = await info.lastWebhookReceipt(ctx.shop.shopId, topic);
    const compliance = /^(customers\/data_request|customers\/redact|shop\/redact)$/.test(topic);
    if (!have.length && compliance) findings.push(diag("webhook_compliance_manual", "LOW", `Compliance topic ${topic} is not visible via the API`, "Mandatory GDPR/compliance webhooks cannot be subscribed through the Admin API (Shopify rejects webhookSubscriptionCreate for them); they are configured in the Partner Dashboard / shopify.app.toml [webhooks] and do not appear in webhookSubscriptions. Verify they point at " + (info ? `${info.appUrl}/webhooks/${topic.replace("/", "-")}` : "the app receiver") + ".", "MANUAL", { instructions: "Partner Dashboard → App setup → Compliance webhooks (or [[webhooks.subscriptions]] with compliance_topics in shopify.app.toml)." }, 0.6));
    else if (!have.length) findings.push(diag("webhook_missing", /uninstalled/.test(topic) ? "HIGH" : "MEDIUM", `Missing subscription: ${topic}`, "The app expects this topic for cache invalidation / lifecycle.", "AUTO_FIX_SAFE", info ? { tool: "shopify.webhooks.create", input: { topic, uri: `${info.appUrl}/webhooks/${topic.replace("/", "-")}` } } : undefined));
    else if (info && !have.some((h) => h.uri.startsWith(info.appUrl))) findings.push(diag("webhook_wrong_uri", "HIGH", `${topic} points elsewhere`, `Subscribed uri ${have.map((h) => h.uri).join(", ")} does not start with the app URL ${info.appUrl}; deliveries never reach this server.`, "NEEDS_REVIEW", { tool: "shopify.webhooks.update", input: { id: have[0]!.id, uri: `${info.appUrl}/webhooks/${topic.replace("/", "-")}` } }));
    if (have.length > 1) findings.push(diag("webhook_duplicate", "LOW", `Duplicate subscriptions for ${topic}`, `${have.length} subscriptions; each delivery is sent ${have.length} times.`, "NEEDS_REVIEW", { tool: "shopify.webhooks.delete", input: { id: have[have.length - 1]!.id, confirm: true } }));
  }
  for (const s of subs) if (/^http:\/\//.test(s.uri)) findings.push(diag("webhook_insecure", "HIGH", `${s.topic} uses plain HTTP`, s.uri, "NEEDS_REVIEW", { tool: "shopify.webhooks.update", input: { id: s.id, uri: s.uri.replace(/^http:/, "https:") } }));
  const apiVersions = [...new Set(subs.map((s) => s.apiVersion).filter(Boolean))];
  if (info && apiVersions.some((v) => v && v !== info.apiVersion)) findings.push(diag("webhook_api_version", "LOW", "Webhook API version differs from the app's", `Subscriptions on ${apiVersions.join(", ")}, app on ${info.apiVersion}; payload shapes may differ.`, "MANUAL", { instructions: "Webhook API version follows the app configuration (Partners dashboard / shopify.app.toml)." }, 0.7));
  const score = Math.max(0, 100 - findings.filter((f) => f.category !== "webhook_compliance_manual").reduce((s, f) => s + ({ CRITICAL: 30, HIGH: 15, MEDIUM: 8, LOW: 3, OPPORTUNITY: 1 }[f.severity] ?? 3), 0));
  return { subscriptions: subs, expected, receipts, findings, score };
}

// ---------------------------------------------------------------------------
// Tracking doctor, web pixel, script tags
// ---------------------------------------------------------------------------
const TRACKERS: Array<{ id: string; name: string; re: RegExp; dup?: RegExp }> = [
  { id: "ga4", name: "Google Analytics 4 (gtag)", re: /googletagmanager\.com\/gtag\/js|gtag\(\s*['"]config['"]/i, dup: /gtag\(\s*['"]config['"]\s*,\s*['"]G-/gi },
  { id: "gtm", name: "Google Tag Manager", re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i, dup: /GTM-[A-Z0-9]{5,}/g },
  { id: "meta", name: "Meta Pixel", re: /connect\.facebook\.net\/[a-z_]+\/fbevents\.js|fbq\(\s*['"]init['"]/i, dup: /fbq\(\s*['"]init['"]/gi },
  { id: "tiktok", name: "TikTok Pixel", re: /analytics\.tiktok\.com|ttq\.load\(/i },
  { id: "pinterest", name: "Pinterest Tag", re: /s\.pinimg\.com\/ct\/core\.js|pintrk\(/i },
  { id: "hotjar", name: "Hotjar", re: /static\.hotjar\.com|hj\(\s*['"]/i },
  { id: "clarity", name: "Microsoft Clarity", re: /clarity\.ms\/tag/i },
  { id: "klaviyo", name: "Klaviyo onsite", re: /static\.klaviyo\.com\/onsite|klaviyo\.js/i },
  { id: "snap", name: "Snap Pixel", re: /sc-static\.net\/scevent/i },
  { id: "ua", name: "Universal Analytics (dead since 2024-07)", re: /google-analytics\.com\/analytics\.js|ga\(\s*['"]create['"]/i },
];
export async function trackingAudit(ctx: Parameters<ToolDefinition["handler"]>[0], themeId?: string) {
  seq = 0;
  const findings: DiagFinding[] = [];
  const detected: Array<{ id: string; name: string; files: string[]; count: number }> = [];
  let themeFiles = 0;
  if (ctx.theme) {
    try {
      const { fileSet } = await loadThemeFileSet(ctx.theme, themeId!);
      const files = fileSet.all().filter((f) => /\.(liquid|js)$/.test(f.key) && f.content);
      themeFiles = files.length;
      const text = files.map((f) => f.content!).join("\n");
      for (const t of TRACKERS) {
        const hits = files.filter((f) => t.re.test(f.content!));
        if (!hits.length) continue;
        const count = t.dup ? (text.match(t.dup) ?? []).length : hits.length;
        detected.push({ id: t.id, name: t.name, files: hits.map((f) => f.key), count });
        if (t.id === "ua") findings.push(diag("tracking_dead", "HIGH", "Universal Analytics code still loads", `${hits.map((f) => f.key).join(", ")}: UA stopped processing data in July 2024; the script is dead weight.`, "NEEDS_REVIEW", { instructions: "Remove the analytics.js snippet and keep GA4 (gtag) or a web pixel." }));
        if (t.dup && count > 1) findings.push(diag("tracking_duplicate", "HIGH", `${t.name} initialised ${count} times`, `${hits.map((f) => f.key).join(", ")}: duplicate inits double-count sessions/purchases.`, "NEEDS_REVIEW", { instructions: "Keep one init (theme settings OR a snippet OR the Google & YouTube channel), remove the others." }));
        if (hits.some((f) => /^sections\/|^snippets\//.test(f.key) && !/^layout\//.test(f.key))) findings.push(diag("tracking_placement", "LOW", `${t.name} loaded from a section/snippet`, "Tracking loaded outside layout/theme.liquid can miss pages that do not render that section.", "MANUAL", { instructions: "Move the loader to layout/theme.liquid or, better, a web pixel." }, 0.6));
      }
      if (detected.length && !/Shopify\.customerPrivacy|customerPrivacy|consent-tracking-api|shopify\.customerPrivacy/i.test(text)) findings.push(diag("tracking_consent", "MEDIUM", "Theme-level tracking ignores customer consent", "No Customer Privacy API usage found; scripts fire before consent, which violates GDPR/CCPA where consent is required.", "NEEDS_REVIEW", { instructions: "Gate theme scripts with Shopify.customerPrivacy (loadFeatures 'consent-tracking-api') or migrate to a web pixel, which honours consent automatically." }));
      if (detected.length) findings.push(diag("tracking_checkout_gap", "MEDIUM", "Theme scripts never run in checkout", `${detected.map((d) => d.name).join(", ")} load from theme files; checkout, thank-you and order-status pages do not render theme Liquid, so purchases are not tracked there.`, "MANUAL", { instructions: "Use shopify.pixels.scaffold to build a web pixel (fires on checkout_completed) or the official Google & YouTube / Meta channel apps." }, 0.8));
    } catch (e) {
      findings.push(diag("tracking_theme_unavailable", "LOW", "Theme not scanned", e instanceof Error ? e.message : String(e), "MANUAL", undefined, 0.5));
    }
  }
  let scriptTags: Array<{ id: string; src: string; displayScope: string }> = [];
  let pixel: { id: string; settings: string } | null = null;
  if (ctx.admin) {
    try {
      scriptTags = (await listScriptTags(ctx.admin)).items;
      for (const t of scriptTags) findings.push(diag("tracking_script_tag", "MEDIUM", `Legacy ScriptTag: ${new URL(t.src).host}`, `${t.src} (${t.displayScope}). ScriptTags are deprecated and stop loading on 2027-03-01; ${t.displayScope === "ORDER_STATUS" ? "order-status scripts are already replaced by web pixels." : "the app owning it should move to an app embed or web pixel."}`, "MANUAL", { instructions: `Ask the app that installed ${new URL(t.src).host} to migrate; delete with shopify.script_tags.delete only if the app is gone.` }));
    } catch { /* scope missing: reported by diagnostics.permissions */ }
    try { pixel = await getWebPixel(ctx.admin); } catch { /* scope missing */ }
  }
  if (!pixel && ctx.admin) findings.push(diag("tracking_no_pixel", "LOW", "This app has no web pixel configured", "A web pixel is the supported, consent-aware way to track storefront + checkout events.", "MANUAL", { tool: "shopify.pixels.scaffold", input: { name: "analytics-pixel" } }, 0.7));
  return { detected, scriptTags, pixel, findings, themeFiles };
}

export const pixelsGetTool: ToolDefinition = defineTool({
  name: "shopify.pixels.get",
  aliases: ["shopify.pixels.list"],
  description: "Reads this app's web pixel (an app can have exactly one, backed by a web_pixel_extension) and its settings JSON.",
  ...base({ name: "shopify.pixels.get", category: "extensions", riskClass: "read", scopes: ["read_pixels"] }),
  inputSchema: z.object({}),
  outputSchema: z.object({ pixel: z.unknown() }),
  handler: async (ctx) => {
    const pixel = await getWebPixel(requireAdmin(ctx.admin));
    return ok({ operationId: ctx.operationId }, pixelsGetTool, { summary: pixel ? `Web pixel ${pixel.id}` : "No web pixel configured for this app", data: { pixel } });
  },
});

export const scriptTagsListTool: ToolDefinition = defineTool({
  name: "shopify.script_tags.list",
  description: "Lists legacy ScriptTags installed on the store (src, display scope). ScriptTags are deprecated and stop loading on 2027-03-01; each one is an app that has not migrated to app embeds / web pixels.",
  ...base({ name: "shopify.script_tags.list", category: "extensions", riskClass: "read", scopes: ["read_script_tags"] }),
  inputSchema: z.object({ first: z.number().int().min(1).max(250).optional(), after: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), hasNextPage: z.boolean(), endCursor: z.string().optional() }),
  handler: async (ctx, input) => {
    const page = await listScriptTags(requireAdmin(ctx.admin), input);
    const known = page.items.map((t) => { let host = t.src; try { host = new URL(t.src).host; } catch { /* keep */ } const app = KNOWN_APPS.find((a) => a.patterns.scriptHosts?.some((re) => re.test(host))); return { ...t, host, app: app ? { handle: app.handle, name: app.name, category: app.category } : undefined }; });
    return ok({ operationId: ctx.operationId }, scriptTagsListTool, { summary: `${page.items.length} script tag(s)`, data: { ...page, items: known } });
  },
});

export const functionsListTool: ToolDefinition = defineTool({
  name: "shopify.functions.list",
  description: "Lists Shopify Functions deployed by this app (id, title, API type, API version, whether merchants configure it in admin). Function ids are needed by functions.attach.",
  ...base({ name: "shopify.functions.list", category: "extensions", riskClass: "read", scopes: [] }),
  inputSchema: z.object({ apiType: z.string().optional() }),
  outputSchema: z.object({ functions: z.array(z.unknown()) }),
  handler: async (ctx, input) => {
    const functions = await listShopifyFunctions(requireAdmin(ctx.admin), input);
    return ok({ operationId: ctx.operationId }, functionsListTool, { summary: `${functions.length} function(s)`, data: { functions } });
  },
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
export const checkoutProfilesTool: ToolDefinition = defineTool({
  name: "shopify.checkout.profiles",
  description: "Lists checkout profiles (published + drafts) and whether the new thank-you / order-status pages are active. Requires access to the checkout editor; Shopify is moving this to checkoutAndAccountsConfigurations.",
  ...base({ name: "shopify.checkout.profiles", category: "checkout", riskClass: "read", scopes: ["read_checkout_branding_settings"] }),
  inputSchema: z.object({}),
  outputSchema: z.object({ profiles: z.array(z.unknown()) }),
  handler: async (ctx) => {
    const profiles = await listCheckoutProfiles(requireAdmin(ctx.admin));
    return ok({ operationId: ctx.operationId }, checkoutProfilesTool, { summary: `${profiles.length} checkout profile(s)${profiles.some((p) => p.isPublished) ? "" : ", none published"}`, data: { profiles } });
  },
});

// ---------------------------------------------------------------------------
// commerce.diagnostics.*
// ---------------------------------------------------------------------------
const diagBase = (name: string) => base({ name, category: "system", riskClass: "read", scopes: [], caps: [] });
export const diagnosticsApiTool: ToolDefinition = defineTool({
  name: "commerce.diagnostics.api",
  description: "Admin API health for this shop: reachable, API version in use vs the app's configured version, granted access scopes (from currentAppInstallation), throttle status from the last call, active app subscriptions. MANUAL findings for version drift.",
  ...diagBase("commerce.diagnostics.api"),
  inputSchema: z.object({}),
  outputSchema: z.object({ reachable: z.boolean(), apiVersion: z.string(), installation: z.unknown(), findings: z.array(z.unknown()) }),
  handler: async (ctx) => {
    seq = 0;
    const info = appInfo(ctx);
    const findings: DiagFinding[] = [];
    if (!ctx.admin) return ok({ operationId: ctx.operationId }, diagnosticsApiTool, { summary: "No Admin API client", data: { reachable: false, apiVersion: info?.apiVersion ?? "unknown", installation: null, findings: [diag("api_unavailable", "CRITICAL", "Admin API client not configured", "Connect the app (shopify.auth.connect) or provide a token.", "MANUAL")] } });
    let installation: unknown = null;
    let reachable = false;
    try { installation = await getCurrentAppInstallation(ctx.admin); reachable = true; } catch (e) { findings.push(diag("api_error", "HIGH", "Admin API call failed", e instanceof Error ? e.message : String(e), "MANUAL")); }
    if (info && ctx.admin.apiVersion !== info.apiVersion) findings.push(diag("api_version_drift", "MEDIUM", "Client API version differs from configuration", `Client ${ctx.admin.apiVersion}, config ${info.apiVersion}.`, "MANUAL"));
    const q = /^\d{4}-(01|04|07|10)$/.exec(ctx.admin.apiVersion);
    if (q) { const [y, m] = ctx.admin.apiVersion.split("-").map(Number); const ageMonths = (new Date().getFullYear() - y!) * 12 + (new Date().getMonth() + 1 - m!); if (ageMonths >= 9) findings.push(diag("api_version_old", ageMonths >= 12 ? "HIGH" : "MEDIUM", `API version ${ctx.admin.apiVersion} is ${ageMonths} months old`, "Shopify supports each version for 12 months; requests to an unsupported version are forwarded to the oldest supported one and may break.", "MANUAL", { instructions: "Bump SHOPIFY_API_VERSION after running commerce.api.capabilities for deprecations." })); }
    return ok({ operationId: ctx.operationId }, diagnosticsApiTool, { summary: `Admin API ${reachable ? "reachable" : "unreachable"} on ${ctx.admin.apiVersion}, ${findings.length} finding(s)`, data: { reachable, apiVersion: ctx.admin.apiVersion, installation, findings } });
  },
});
export const diagnosticsPermissionsTool: ToolDefinition = defineTool({
  name: "commerce.diagnostics.permissions",
  description: "Scope gap analysis: compares the scopes granted to this install (credential + currentAppInstallation) with the app's configured scope list and with every registered tool's requiredShopifyScopes, and lists which tool families are blocked and by which scope. AUTO_FIX_SAFE = reconnect with the configured scope set.",
  ...diagBase("commerce.diagnostics.permissions"),
  inputSchema: z.object({}),
  outputSchema: z.object({ granted: z.array(z.string()), configured: z.array(z.string()), missingFromInstall: z.array(z.string()), blockedFamilies: z.array(z.unknown()), findings: z.array(z.unknown()) }),
  handler: async (ctx) => {
    seq = 0;
    const info = appInfo(ctx);
    const registry = ctx.services.get("registry") as { list(): ToolDefinition[] } | undefined;
    let granted = new Set(ctx.credential.scopesGranted);
    if (ctx.admin) { try { for (const s of (await getCurrentAppInstallation(ctx.admin)).accessScopes) granted.add(s); } catch { /* keep credential scopes */ } }
    granted = new Set([...granted].flatMap((s) => (s.startsWith("write_") ? [s, `read_${s.slice(6)}`] : [s])));
    const configured = info?.configuredScopes ?? [];
    const missingFromInstall = configured.filter((s) => !granted.has(s));
    const families = new Map<string, { tools: number; blockedBy: Set<string> }>();
    for (const def of registry?.list() ?? []) {
      const fam = def.name.split(".").slice(0, 2).join(".");
      const missing = def.requiredShopifyScopes.filter((s) => !granted.has(s));
      if (!missing.length) continue;
      const cur = families.get(fam) ?? { tools: 0, blockedBy: new Set<string>() };
      cur.tools++;
      for (const m of missing) cur.blockedBy.add(m);
      families.set(fam, cur);
    }
    const blockedFamilies = [...families.entries()].map(([family, v]) => ({ family, tools: v.tools, blockedBy: [...v.blockedBy] })).sort((a, b) => b.tools - a.tools);
    const findings: DiagFinding[] = [];
    if (missingFromInstall.length) findings.push(diag("scopes_not_granted", "HIGH", `${missingFromInstall.length} configured scope(s) not granted`, missingFromInstall.join(", "), "AUTO_FIX_SAFE", { tool: "shopify.auth.connect", input: {} }));
    const unconfigured = [...new Set(blockedFamilies.flatMap((f) => f.blockedBy))].filter((s) => !configured.includes(s));
    if (unconfigured.length) findings.push(diag("scopes_not_configured", "MEDIUM", `${unconfigured.length} scope(s) used by tools are not in SHOPIFY_SCOPES`, unconfigured.join(", "), "MANUAL", { instructions: "Add them to SHOPIFY_SCOPES in .env (see .env.example) and reinstall the app." }));
    return ok({ operationId: ctx.operationId }, diagnosticsPermissionsTool, { summary: `${granted.size} scope(s) granted, ${blockedFamilies.length} tool famil${blockedFamilies.length === 1 ? "y" : "ies"} blocked`, data: { granted: [...granted].sort(), configured, missingFromInstall, blockedFamilies, findings } });
  },
});
export const diagnosticsWebhooksTool: ToolDefinition = defineTool({
  name: "commerce.diagnostics.webhooks",
  description: "Alias of shopify.webhooks.health inside the diagnostics family.",
  ...diagBase("commerce.diagnostics.webhooks"),
  inputSchema: z.object({}),
  outputSchema: z.object({ subscriptions: z.array(z.unknown()), expected: z.array(z.string()), receipts: z.record(z.unknown()), findings: z.array(z.unknown()), score: z.number() }),
  handler: async (ctx) => {
    const data = await webhookHealth(ctx);
    return ok({ operationId: ctx.operationId }, diagnosticsWebhooksTool, { summary: `Webhook health ${data.score}/100, ${data.findings.length} finding(s)`, data });
  },
});
export const diagnosticsExtensionsTool: ToolDefinition = defineTool({
  name: "commerce.diagnostics.extensions",
  description: "What this app has deployed on the store: web pixel (and settings), Shopify Functions with what they are attached to (discount/transform/validation via the admin), checkout profiles, plus recommendations (no pixel → scaffold, no functions → what would help).",
  ...diagBase("commerce.diagnostics.extensions"),
  inputSchema: z.object({}),
  outputSchema: z.object({ pixel: z.unknown(), functions: z.array(z.unknown()), checkoutProfiles: z.array(z.unknown()), findings: z.array(z.unknown()) }),
  handler: async (ctx) => {
    seq = 0;
    const findings: DiagFinding[] = [];
    let pixel: unknown = null;
    let functions: unknown[] = [];
    let checkoutProfiles: unknown[] = [];
    const scopeless: string[] = [];
    if (ctx.admin) {
      try { pixel = await getWebPixel(ctx.admin); } catch { scopeless.push("read_pixels"); }
      try { functions = await listShopifyFunctions(ctx.admin); } catch (e) { findings.push(diag("functions_query_failed", "LOW", "Could not list functions", e instanceof Error ? e.message : String(e), "MANUAL", undefined, 0.5)); }
      try { checkoutProfiles = await listCheckoutProfiles(ctx.admin); } catch { scopeless.push("read_checkout_branding_settings"); }
    }
    if (!pixel) findings.push(diag("no_pixel", "LOW", "No web pixel deployed for this app", "Storefront + checkout events are not being collected by the app.", "MANUAL", { tool: "shopify.pixels.scaffold", input: { name: "analytics-pixel" } }, 0.7));
    if (!functions.length) findings.push(diag("no_functions", "OPPORTUNITY", "No Shopify Functions deployed", "Volume discounts, bundles (cart transform), checkout validation and delivery/payment rules are Function-based.", "MANUAL", { tool: "shopify.functions.scaffold", input: { kind: "discount", name: "volume-discount" } }, 0.6));
    if (scopeless.length) findings.push(diag("extensions_scopes", "LOW", "Some extension queries need scopes", scopeless.join(", "), "AUTO_FIX_SAFE", { tool: "shopify.auth.connect", input: {} }, 0.6));
    return ok({ operationId: ctx.operationId }, diagnosticsExtensionsTool, { summary: `${pixel ? "pixel, " : ""}${functions.length} function(s), ${checkoutProfiles.length} checkout profile(s), ${findings.length} finding(s)`, data: { pixel, functions, checkoutProfiles, findings } });
  },
});
export const diagnosticsTrackingTool: ToolDefinition = defineTool({
  name: "commerce.diagnostics.tracking",
  description: "Alias of shopify.tracking.audit inside the diagnostics family (theme trackers, duplicates, consent, script tags, pixel).",
  ...base({ name: "commerce.diagnostics.tracking", category: "system", riskClass: "read", scopes: [], plane: "theme_engine", caps: ["theme.read"] }),
  inputSchema: z.object({ themeId: z.string().optional() }),
  outputSchema: z.object({ detected: z.array(z.unknown()), scriptTags: z.array(z.unknown()), pixel: z.unknown(), findings: z.array(z.unknown()), themeFiles: z.number() }),
  handler: async (ctx, input) => {
    const data = await trackingAudit(ctx, input.themeId);
    return ok({ operationId: ctx.operationId }, diagnosticsTrackingTool, { summary: `${data.detected.length} tracker(s), ${data.findings.length} finding(s)`, data });
  },
});

export const ADVANCED_TOOLS: ToolDefinition[] = [
  webhooksListTool,
  pixelsGetTool,
  scriptTagsListTool,
  functionsListTool,
  checkoutProfilesTool,
  diagnosticsApiTool,
  diagnosticsPermissionsTool,
  diagnosticsWebhooksTool,
  diagnosticsExtensionsTool,
  diagnosticsTrackingTool,
];
export function registerAdvancedTools(registry: ToolRegistry): void {
  for (const t of ADVANCED_TOOLS) registry.register(t);
}
