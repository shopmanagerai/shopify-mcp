/**
 * Fake handlers for operations/advanced.ts (Phase 6): webhooks, web pixel,
 * script tags, ShopifyQL, functions, checkout profiles, flow triggers, app
 * installation. State lives in `store.advanced`.
 */
import type { FakeAdminStore } from "./fake.js";

export interface FakeAdvancedStore {
  accessScopes: string[];
  webhooks: Map<string, { id: string; topic: string; uri: string; format: string; includeFields: string[]; metafieldNamespaces: string[]; filter?: string | null; createdAt: string; updatedAt: string }>;
  webPixel: { id: string; settings: string } | null;
  scriptTags: Array<{ id: string; src: string; displayScope: string; cache: boolean; createdAt: string; updatedAt: string }>;
  functions: Array<{ id: string; title: string; apiType: string; apiVersion: string; useCreationUi: boolean; appTitle: string }>;
  attached: Array<{ kind: string; id: string; functionId: string; title: string }>;
  checkoutProfiles: Array<{ id: string; name: string; isPublished: boolean; typOspPagesActive: boolean; editedAt: string }>;
  flowTriggers: Array<{ handle: string; payload: Record<string, unknown> }>;
  /** ShopifyQL tables derived on demand from store.commerce.orders. */
  shopifyqlEnabled: boolean;
}
export function emptyAdvancedStore(): FakeAdvancedStore {
  return { accessScopes: ["read_products", "write_products", "read_themes", "write_themes", "read_script_tags", "read_locales", "read_markets"], webhooks: new Map(), webPixel: null, scriptTags: [], functions: [], attached: [], checkoutProfiles: [], flowTriggers: [], shopifyqlEnabled: true };
}
const gid = (type: string, id: string) => `gid://shopify/${type}/${id}`;
function nextId(store: FakeAdminStore, kind: string): string {
  const n = (store.counters[kind] ?? 0) + 1;
  store.counters[kind] = n;
  return String(n);
}

export function seedDemoAdvanced(store: FakeAdminStore): void {
  const a = store.advanced;
  const now = "2026-01-01T00:00:00.000Z";
  for (const topic of ["APP_UNINSTALLED", "SHOP_UPDATE", "THEMES_PUBLISH"]) {
    const id = gid("WebhookSubscription", nextId(store, "webhook"));
    a.webhooks.set(id, { id, topic, uri: `https://app.example.com/webhooks/${topic.toLowerCase().replace("_", "-")}`, format: "JSON", includeFields: [], metafieldNamespaces: [], filter: null, createdAt: now, updatedAt: now });
  }
  a.scriptTags.push({ id: gid("ScriptTag", nextId(store, "scriptTag")), src: "https://cdn.legacy-reviews.example/widget.js", displayScope: "ONLINE_STORE", cache: false, createdAt: now, updatedAt: now });
  a.functions.push({ id: gid("ShopifyFunction", nextId(store, "function")), title: "Volume discount", apiType: "discount", apiVersion: "2026-07", useCreationUi: false, appTitle: "Demo Functions" });
  a.checkoutProfiles.push({ id: gid("CheckoutProfile", "1"), name: "Default", isPublished: true, typOspPagesActive: true, editedAt: now });
}

const webhookOut = (w: NonNullable<ReturnType<FakeAdvancedStore["webhooks"]["get"]>>) => ({ ...w, apiVersion: { handle: "2026-07" } });
const page = <T>(all: T[], vars: { first?: number; after?: string }) => {
  const start = vars.after ? Number(vars.after) : 0;
  const items = all.slice(start, start + (vars.first ?? 50));
  const end = start + items.length;
  return { nodes: items, pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null } };
};

export function dispatchAdvanced(s: FakeAdminStore, name: string, vars: Record<string, any>): unknown | undefined {
  const a = s.advanced;
  switch (name) {
    case "CurrentAppInstallation":
      return { currentAppInstallation: { launchUrl: "https://app.example.com/launch", app: { id: gid("App", "1"), title: "ShopManager AI", handle: "shopmanager-ai", apiKey: "demo-key" }, accessScopes: a.accessScopes.map((handle) => ({ handle })), activeSubscriptions: [] } };
    case "WebhookSubscriptionsList": {
      const all = [...a.webhooks.values()].filter((w) => !vars.topics || (vars.topics as string[]).includes(w.topic)).map(webhookOut);
      return { webhookSubscriptions: page(all, vars) };
    }
    case "WebhookSubscriptionCreate": {
      const i = vars.webhookSubscription;
      if (!/^https:\/\/|^pubsub:\/\/|^arn:aws:events:/.test(i.uri)) return { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ["uri"], message: "Address must be a valid HTTPS URL, Pub/Sub topic or EventBridge ARN." }] } };
      if ([...a.webhooks.values()].some((w) => w.topic === vars.topic && w.uri === i.uri)) return { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ["topic"], message: "Address for this topic has already been taken" }] } };
      const id = gid("WebhookSubscription", nextId(s, "webhook"));
      const now = new Date().toISOString();
      const w = { id, topic: vars.topic, uri: i.uri, format: i.format ?? "JSON", includeFields: i.includeFields ?? [], metafieldNamespaces: i.metafieldNamespaces ?? [], filter: i.filter ?? null, createdAt: now, updatedAt: now };
      a.webhooks.set(id, w);
      return { webhookSubscriptionCreate: { webhookSubscription: webhookOut(w), userErrors: [] } };
    }
    case "WebhookSubscriptionUpdate": {
      const w = a.webhooks.get(vars.id);
      if (!w) return { webhookSubscriptionUpdate: { webhookSubscription: null, userErrors: [{ field: ["id"], message: "Webhook subscription not found." }] } };
      Object.assign(w, Object.fromEntries(Object.entries(vars.webhookSubscription).filter(([, v]) => v !== undefined)), { updatedAt: new Date().toISOString() });
      return { webhookSubscriptionUpdate: { webhookSubscription: webhookOut(w), userErrors: [] } };
    }
    case "WebhookSubscriptionDelete": {
      if (!a.webhooks.delete(vars.id)) return { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: null, userErrors: [{ field: ["id"], message: "Webhook subscription not found." }] } };
      return { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: vars.id, userErrors: [] } };
    }
    case "WebPixelGet":
      return { webPixel: a.webPixel };
    case "WebPixelCreate": {
      if (a.webPixel) return { webPixelCreate: { webPixel: null, userErrors: [{ field: ["settings"], message: "A web pixel already exists for this app.", code: "TAKEN" }] } };
      let parsed: unknown;
      try { parsed = JSON.parse(vars.webPixel.settings); } catch { parsed = null; }
      if (!parsed || typeof parsed !== "object") return { webPixelCreate: { webPixel: null, userErrors: [{ field: ["settings"], message: "Settings must be a JSON object matching the extension schema.", code: "INVALID_SETTINGS" }] } };
      a.webPixel = { id: gid("WebPixel", nextId(s, "webPixel")), settings: vars.webPixel.settings };
      return { webPixelCreate: { webPixel: a.webPixel, userErrors: [] } };
    }
    case "WebPixelUpdate": {
      if (!a.webPixel || a.webPixel.id !== vars.id) return { webPixelUpdate: { webPixel: null, userErrors: [{ field: ["id"], message: "Web pixel not found.", code: "NOT_FOUND" }] } };
      a.webPixel.settings = vars.webPixel.settings;
      return { webPixelUpdate: { webPixel: a.webPixel, userErrors: [] } };
    }
    case "WebPixelDelete": {
      if (!a.webPixel || a.webPixel.id !== vars.id) return { webPixelDelete: { deletedWebPixelId: null, userErrors: [{ field: ["id"], message: "Web pixel not found.", code: "NOT_FOUND" }] } };
      a.webPixel = null;
      return { webPixelDelete: { deletedWebPixelId: vars.id, userErrors: [] } };
    }
    case "ScriptTagsList":
      return { scriptTags: page(a.scriptTags, vars) };
    case "ScriptTagDelete": {
      const before = a.scriptTags.length;
      a.scriptTags = a.scriptTags.filter((t) => t.id !== vars.id);
      if (a.scriptTags.length === before) return { scriptTagDelete: { deletedScriptTagId: null, userErrors: [{ field: ["id"], message: "Script tag not found." }] } };
      return { scriptTagDelete: { deletedScriptTagId: vars.id, userErrors: [] } };
    }
    case "ShopifyqlQuery": {
      const q: string = String(vars.query);
      if (!a.shopifyqlEnabled) return { shopifyqlQuery: { parseErrors: ["ShopifyQL is not available for this shop."] } };
      if (!/^\s*FROM\s+\w+\s+SHOW\s+/i.test(q)) return { shopifyqlQuery: { parseErrors: ["Expected FROM <table> SHOW <columns>."] } };
      const orders = [...s.commerce.orders.values()];
      const byDay = new Map<string, { total_sales: number; orders: number }>();
      for (const o of orders) { const day = o.createdAt.slice(0, 10); const cur = byDay.get(day) ?? { total_sales: 0, orders: 0 }; cur.total_sales += Number(o.total); cur.orders += 1; byDay.set(day, cur); }
      if (/FROM\s+products/i.test(q)) {
        const byProduct = new Map<string, { title: string; qty: number; sales: number }>();
        for (const o of orders) for (const l of o.lineItems) { const cur = byProduct.get(l.title) ?? { title: l.title, qty: 0, sales: 0 }; cur.qty += l.quantity; cur.sales += Number(l.price) * l.quantity; byProduct.set(l.title, cur); }
        return { shopifyqlQuery: { tableData: { columns: [{ name: "product_title", dataType: "string" }, { name: "net_items_sold", dataType: "number" }, { name: "total_sales", dataType: "money" }], rows: [...byProduct.values()].sort((x, y) => y.sales - x.sales).map((p) => [p.title, p.qty, p.sales.toFixed(2)]) }, parseErrors: [] } };
      }
      return { shopifyqlQuery: { tableData: { columns: [{ name: "day", dataType: "date" }, { name: "total_sales", dataType: "money" }, { name: "orders", dataType: "number" }], rows: [...byDay.entries()].sort().map(([day, v]) => [day, v.total_sales.toFixed(2), v.orders]) }, parseErrors: [] } };
    }
    case "ShopifyFunctionsList":
      return { shopifyFunctions: { nodes: a.functions.filter((f) => !vars.apiType || f.apiType === vars.apiType).map((f) => ({ id: f.id, title: f.title, apiType: f.apiType, apiVersion: f.apiVersion, useCreationUi: f.useCreationUi, app: { title: f.appTitle } })) } };
    case "DiscountAutomaticAppCreate":
    case "CartTransformCreate":
    case "ValidationCreate":
    case "DeliveryCustomizationCreate":
    case "PaymentCustomizationCreate": {
      const key = name[0]!.toLowerCase() + name.slice(1);
      const fnId = vars.automaticAppDiscount?.functionId ?? vars.functionId ?? vars.validation?.functionId ?? vars.input?.functionId;
      const fn = a.functions.find((f) => f.id === fnId);
      const field = { DiscountAutomaticAppCreate: "automaticAppDiscount", CartTransformCreate: "cartTransform", ValidationCreate: "validation", DeliveryCustomizationCreate: "deliveryCustomization", PaymentCustomizationCreate: "paymentCustomization" }[name]!;
      if (!fn) return { [key]: { [field]: null, userErrors: [{ field: ["functionId"], message: "Function not found or not owned by this app.", code: "NOT_FOUND" }] } };
      const id = gid(field[0]!.toUpperCase() + field.slice(1), nextId(s, "attached"));
      const title = vars.automaticAppDiscount?.title ?? vars.validation?.title ?? vars.input?.title ?? fn.title;
      a.attached.push({ kind: field, id, functionId: fn.id, title });
      const node = name === "DiscountAutomaticAppCreate" ? { discountId: id, title, status: "ACTIVE" } : name === "CartTransformCreate" ? { id, functionId: fn.id, blockOnFailure: !!vars.blockOnFailure } : { id, title, enabled: true };
      return { [key]: { [field]: node, userErrors: [] } };
    }
    case "CheckoutProfilesList":
      return { checkoutProfiles: { nodes: a.checkoutProfiles } };
    case "FlowTriggerReceive": {
      if (!/^[a-z0-9-]+$/.test(String(vars.handle))) return { flowTriggerReceive: { userErrors: [{ field: ["handle"], message: "Trigger handle not found for this app." }] } };
      a.flowTriggers.push({ handle: vars.handle, payload: vars.payload });
      return { flowTriggerReceive: { userErrors: [] } };
    }
    default:
      return undefined;
  }
}
