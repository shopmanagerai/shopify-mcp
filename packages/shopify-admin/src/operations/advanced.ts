/**
 * Phase 6 operations: webhook subscriptions, web pixels, legacy script tags,
 * ShopifyQL analytics, Shopify Functions (list + attach), checkout profiles,
 * Flow triggers and the current app installation. Shapes follow the Admin
 * GraphQL 2026-07 reference (researched 2026-09-11).
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

function unwrap<T>(res: { data?: unknown; errors?: Array<{ message: string }> }, pick: (d: any) => T): T {
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
  return pick(res.data);
}
const userErrors = (x: { userErrors?: UserError[] } | null | undefined): UserError[] => x?.userErrors ?? [];

// ---------------------------------------------------------------------------
// App installation (diagnostics)
// ---------------------------------------------------------------------------
export interface AppInstallationInfo {
  app: { id: string; title: string; handle?: string; apiKey?: string };
  accessScopes: string[];
  activeSubscriptions: Array<{ id: string; name: string; status: string; test?: boolean }>;
  launchUrl?: string;
}
export async function getCurrentAppInstallation(client: AdminClient): Promise<AppInstallationInfo> {
  const res = await client.query(/* GraphQL */ `query CurrentAppInstallation { currentAppInstallation { launchUrl app { id title handle apiKey } accessScopes { handle } activeSubscriptions { id name status test } } }`);
  return unwrap(res, (d) => ({ app: d.currentAppInstallation.app, accessScopes: (d.currentAppInstallation.accessScopes ?? []).map((s: any) => s.handle), activeSubscriptions: d.currentAppInstallation.activeSubscriptions ?? [], launchUrl: d.currentAppInstallation.launchUrl }));
}

// ---------------------------------------------------------------------------
// Webhook subscriptions
// ---------------------------------------------------------------------------
export interface WebhookSubscription {
  id: string;
  topic: string;
  uri: string;
  format: string;
  includeFields: string[];
  metafieldNamespaces: string[];
  filter?: string | null;
  apiVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}
const WEBHOOK_FIELDS = /* GraphQL */ `id topic uri format includeFields metafieldNamespaces filter createdAt updatedAt apiVersion { handle }`;
const toWebhook = (w: any): WebhookSubscription => ({ id: w.id, topic: w.topic, uri: w.uri ?? w.endpoint?.callbackUrl ?? "", format: w.format, includeFields: w.includeFields ?? [], metafieldNamespaces: w.metafieldNamespaces ?? [], filter: w.filter, apiVersion: w.apiVersion?.handle, createdAt: w.createdAt, updatedAt: w.updatedAt });
export async function listWebhookSubscriptions(client: AdminClient, opts: { first?: number; after?: string; topics?: string[] } = {}): Promise<{ items: WebhookSubscription[]; hasNextPage: boolean; endCursor?: string }> {
  const res = await client.query(/* GraphQL */ `query WebhookSubscriptionsList($first: Int!, $after: String, $topics: [WebhookSubscriptionTopic!]) { webhookSubscriptions(first: $first, after: $after, topics: $topics) { nodes { ${WEBHOOK_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { first: opts.first ?? 100, after: opts.after, topics: opts.topics });
  return unwrap(res, (d) => ({ items: (d.webhookSubscriptions?.nodes ?? []).map(toWebhook), hasNextPage: d.webhookSubscriptions?.pageInfo?.hasNextPage ?? false, endCursor: d.webhookSubscriptions?.pageInfo?.endCursor ?? undefined }));
}
export interface WebhookInput {
  uri: string;
  format?: "JSON" | "XML";
  includeFields?: string[];
  metafieldNamespaces?: string[];
  filter?: string;
}
/** Topic in GraphQL enum form, e.g. "orders/create" → "ORDERS_CREATE". */
export const webhookTopicEnum = (topic: string) => topic.toUpperCase().replace(/[/.-]/g, "_");
export const webhookTopicSlug = (topic: string) => topic.toLowerCase().replace(/_/g, "/").replace(/^([a-z]+)\/(.+)$/, (_m, a, b) => `${a}/${String(b).replace(/\//g, "_")}`);
export async function createWebhookSubscription(client: AdminClient, topic: string, input: WebhookInput): Promise<{ subscription?: WebhookSubscription; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { ${WEBHOOK_FIELDS} } userErrors { field message } } }`, { topic: webhookTopicEnum(topic), webhookSubscription: { uri: input.uri, format: input.format ?? "JSON", includeFields: input.includeFields, metafieldNamespaces: input.metafieldNamespaces, filter: input.filter } });
  return unwrap(res, (d) => ({ subscription: d.webhookSubscriptionCreate.webhookSubscription ? toWebhook(d.webhookSubscriptionCreate.webhookSubscription) : undefined, userErrors: userErrors(d.webhookSubscriptionCreate) }));
}
export async function updateWebhookSubscription(client: AdminClient, id: string, input: Partial<WebhookInput>): Promise<{ subscription?: WebhookSubscription; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation WebhookSubscriptionUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) { webhookSubscription { ${WEBHOOK_FIELDS} } userErrors { field message } } }`, { id, webhookSubscription: input });
  return unwrap(res, (d) => ({ subscription: d.webhookSubscriptionUpdate.webhookSubscription ? toWebhook(d.webhookSubscriptionUpdate.webhookSubscription) : undefined, userErrors: userErrors(d.webhookSubscriptionUpdate) }));
}
export async function deleteWebhookSubscription(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation WebhookSubscriptionDelete($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } } }`, { id });
  return unwrap(res, (d) => ({ deletedId: d.webhookSubscriptionDelete.deletedWebhookSubscriptionId ?? undefined, userErrors: userErrors(d.webhookSubscriptionDelete) }));
}

// ---------------------------------------------------------------------------
// Web pixel (this app's) + legacy script tags
// ---------------------------------------------------------------------------
export interface WebPixel {
  id: string;
  settings: string;
}
export async function getWebPixel(client: AdminClient): Promise<WebPixel | null> {
  try {
    const res = await client.query(/* GraphQL */ `query WebPixelGet { webPixel { id settings } }`);
    return unwrap(res, (d) => d.webPixel ?? null);
  } catch (e) {
    const text = e instanceof Error ? `${e.message} ${(e as { technicalMessage?: string }).technicalMessage ?? ""}` : String(e);
    if (/not found|no web pixel|does not exist/i.test(text)) return null;
    throw e;
  }
}
export async function createWebPixel(client: AdminClient, settings: Record<string, unknown>): Promise<{ pixel?: WebPixel; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation WebPixelCreate($webPixel: WebPixelInput!) { webPixelCreate(webPixel: $webPixel) { webPixel { id settings } userErrors { field message code } } }`, { webPixel: { settings: JSON.stringify(settings) } });
  return unwrap(res, (d) => ({ pixel: d.webPixelCreate.webPixel ?? undefined, userErrors: userErrors(d.webPixelCreate) }));
}
export async function updateWebPixel(client: AdminClient, id: string, settings: Record<string, unknown>): Promise<{ pixel?: WebPixel; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation WebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) { webPixelUpdate(id: $id, webPixel: $webPixel) { webPixel { id settings } userErrors { field message code } } }`, { id, webPixel: { settings: JSON.stringify(settings) } });
  return unwrap(res, (d) => ({ pixel: d.webPixelUpdate.webPixel ?? undefined, userErrors: userErrors(d.webPixelUpdate) }));
}
export async function deleteWebPixel(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation WebPixelDelete($id: ID!) { webPixelDelete(id: $id) { deletedWebPixelId userErrors { field message code } } }`, { id });
  return unwrap(res, (d) => ({ deletedId: d.webPixelDelete.deletedWebPixelId ?? undefined, userErrors: userErrors(d.webPixelDelete) }));
}

export interface ScriptTag {
  id: string;
  src: string;
  displayScope: string;
  cache?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
export async function listScriptTags(client: AdminClient, opts: { first?: number; after?: string } = {}): Promise<{ items: ScriptTag[]; hasNextPage: boolean; endCursor?: string }> {
  const res = await client.query(/* GraphQL */ `query ScriptTagsList($first: Int!, $after: String) { scriptTags(first: $first, after: $after) { nodes { id src displayScope cache createdAt updatedAt } pageInfo { hasNextPage endCursor } } }`, { first: opts.first ?? 100, after: opts.after });
  return unwrap(res, (d) => ({ items: d.scriptTags?.nodes ?? [], hasNextPage: d.scriptTags?.pageInfo?.hasNextPage ?? false, endCursor: d.scriptTags?.pageInfo?.endCursor ?? undefined }));
}
export async function deleteScriptTag(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation ScriptTagDelete($id: ID!) { scriptTagDelete(id: $id) { deletedScriptTagId userErrors { field message } } }`, { id });
  return unwrap(res, (d) => ({ deletedId: d.scriptTagDelete.deletedScriptTagId ?? undefined, userErrors: userErrors(d.scriptTagDelete) }));
}

// ---------------------------------------------------------------------------
// ShopifyQL
// ---------------------------------------------------------------------------
export interface ShopifyqlResult {
  columns: Array<{ name: string; dataType: string; displayName?: string }>;
  rows: Array<Record<string, unknown>>;
  parseErrors: Array<{ code?: string; message: string; range?: unknown }>;
}
/** Live fact (2026-07, 2026-09-12): shopifyqlQuery returns { tableData { columns { name dataType displayName } rows } parseErrors } where parseErrors is [String]. */
export async function runShopifyql(client: AdminClient, query: string): Promise<ShopifyqlResult> {
  const res = await client.query(/* GraphQL */ `query ShopifyqlQuery($query: String!) { shopifyqlQuery(query: $query) { tableData { columns { name dataType displayName } rows } parseErrors } }`, { query });
  return unwrap(res, (d) => {
    const r = d.shopifyqlQuery ?? {};
    const columns = r.tableData?.columns ?? [];
    const rows = (r.tableData?.rows ?? r.tableData?.rowData ?? []).map((row: unknown) => (Array.isArray(row) ? Object.fromEntries(columns.map((c: { name: string }, i: number) => [c.name, row[i]])) : (row as Record<string, unknown>)));
    const parseErrors = (r.parseErrors ?? []).map((e: unknown) => (typeof e === "string" ? { message: e } : (e as { message: string })));
    return { columns, rows, parseErrors };
  });
}

// ---------------------------------------------------------------------------
// Shopify Functions
// ---------------------------------------------------------------------------
export interface ShopifyFunctionInfo {
  id: string;
  title: string;
  apiType: string;
  apiVersion?: string;
  appTitle?: string;
  useCreationUi?: boolean;
}
export async function listShopifyFunctions(client: AdminClient, opts: { apiType?: string; first?: number } = {}): Promise<ShopifyFunctionInfo[]> {
  const res = await client.query(/* GraphQL */ `query ShopifyFunctionsList($first: Int!, $apiType: String) { shopifyFunctions(first: $first, apiType: $apiType) { nodes { id title apiType apiVersion useCreationUi app { title } } } }`, { first: opts.first ?? 50, apiType: opts.apiType });
  return unwrap(res, (d) => (d.shopifyFunctions?.nodes ?? []).map((f: any) => ({ id: f.id, title: f.title, apiType: f.apiType, apiVersion: f.apiVersion, appTitle: f.app?.title, useCreationUi: f.useCreationUi })));
}
export async function createAppDiscount(client: AdminClient, input: { title: string; functionId: string; startsAt?: string; endsAt?: string; discountClasses?: Array<"PRODUCT" | "ORDER" | "SHIPPING">; combinesWith?: { orderDiscounts?: boolean; productDiscounts?: boolean; shippingDiscounts?: boolean }; configuration?: Record<string, unknown> }): Promise<{ id?: string; userErrors: UserError[] }> {
  const automaticAppDiscount = { title: input.title, functionId: input.functionId, startsAt: input.startsAt ?? new Date().toISOString(), endsAt: input.endsAt, discountClasses: input.discountClasses, combinesWith: input.combinesWith, metafields: input.configuration ? [{ namespace: "$app:default", key: "function-configuration", type: "json", value: JSON.stringify(input.configuration) }] : undefined };
  const res = await client.mutate(/* GraphQL */ `mutation DiscountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message code } } }`, { automaticAppDiscount });
  return unwrap(res, (d) => ({ id: d.discountAutomaticAppCreate.automaticAppDiscount?.discountId, userErrors: userErrors(d.discountAutomaticAppCreate) }));
}
export async function createCartTransform(client: AdminClient, functionId: string, blockOnFailure = false): Promise<{ id?: string; userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation CartTransformCreate($functionId: String!, $blockOnFailure: Boolean) { cartTransformCreate(functionId: $functionId, blockOnFailure: $blockOnFailure) { cartTransform { id functionId blockOnFailure } userErrors { field message code } } }`, { functionId, blockOnFailure });
  return unwrap(res, (d) => ({ id: d.cartTransformCreate.cartTransform?.id, userErrors: userErrors(d.cartTransformCreate) }));
}
export async function createValidation(client: AdminClient, input: { functionId: string; title: string; enable?: boolean; blockOnFailure?: boolean; configuration?: Record<string, unknown> }): Promise<{ id?: string; userErrors: UserError[] }> {
  const validation = { functionId: input.functionId, title: input.title, enable: input.enable ?? true, blockOnFailure: input.blockOnFailure ?? false, metafields: input.configuration ? [{ namespace: "$app:default", key: "function-configuration", type: "json", value: JSON.stringify(input.configuration) }] : undefined };
  const res = await client.mutate(/* GraphQL */ `mutation ValidationCreate($validation: ValidationCreateInput!) { validationCreate(validation: $validation) { validation { id title enabled } userErrors { field message code } } }`, { validation });
  return unwrap(res, (d) => ({ id: d.validationCreate.validation?.id, userErrors: userErrors(d.validationCreate) }));
}
export async function createCustomization(client: AdminClient, kind: "delivery" | "payment", input: { functionId: string; title: string; enabled?: boolean; configuration?: Record<string, unknown> }): Promise<{ id?: string; userErrors: UserError[] }> {
  const mutation = kind === "delivery" ? "deliveryCustomizationCreate" : "paymentCustomizationCreate";
  const typeName = kind === "delivery" ? "DeliveryCustomizationInput" : "PaymentCustomizationInput";
  const field = kind === "delivery" ? "deliveryCustomization" : "paymentCustomization";
  const payload = { functionId: input.functionId, title: input.title, enabled: input.enabled ?? true, metafields: input.configuration ? [{ namespace: "$app:default", key: "function-configuration", type: "json", value: JSON.stringify(input.configuration) }] : undefined };
  const res = await client.mutate(/* GraphQL */ `mutation ${mutation[0]!.toUpperCase()}${mutation.slice(1)}($input: ${typeName}!) { ${mutation}(${field}: $input) { ${field} { id title enabled } userErrors { field message code } } }`, { input: payload });
  return unwrap(res, (d) => ({ id: d[mutation][field]?.id, userErrors: userErrors(d[mutation]) }));
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
export interface CheckoutProfile {
  id: string;
  name?: string;
  isPublished: boolean;
  typOspPagesActive?: boolean;
  editedAt?: string;
}
export async function listCheckoutProfiles(client: AdminClient): Promise<CheckoutProfile[]> {
  const res = await client.query(/* GraphQL */ `query CheckoutProfilesList { checkoutProfiles(first: 20) { nodes { id name isPublished typOspPagesActive editedAt } } }`);
  return unwrap(res, (d) => d.checkoutProfiles?.nodes ?? []);
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
export async function flowTriggerReceive(client: AdminClient, handle: string, payload: Record<string, unknown>): Promise<{ userErrors: UserError[] }> {
  const res = await client.mutate(/* GraphQL */ `mutation FlowTriggerReceive($handle: String!, $payload: JSON!) { flowTriggerReceive(handle: $handle, payload: $payload) { userErrors { field message } } }`, { handle, payload });
  return unwrap(res, (d) => ({ userErrors: userErrors(d.flowTriggerReceive) }));
}
